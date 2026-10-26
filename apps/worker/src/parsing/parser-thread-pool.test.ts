import { describe, expect, it, vi } from 'vitest';

import { ParserThreadPool } from './parser-thread-pool.js';

import type { ParseSourceRequest, ParseSourceResult } from './types.js';

interface Deferred<T> {
  promise: Promise<T>;

  resolve: (value: T) => void;

  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;

  let rejectPromise: ((error: Error) => void) | undefined;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;

    rejectPromise = reject;
  });

  if (!resolvePromise || !rejectPromise) {
    throw new Error('Failed to create deferred promise.');
  }

  return {
    promise,

    resolve: resolvePromise,

    reject: rejectPromise,
  };
}

function createRequest(filePath: string): ParseSourceRequest {
  return {
    filePath,

    language: 'typescript',

    source: 'function example() {}',
  };
}

function createResult(filePath: string): ParseSourceResult {
  return {
    filePath,

    language: 'typescript',

    imports: [],

    functions: [],

    classes: [],

    calls: [],

    hasSyntaxErrors: false,
  };
}

describe('ParserThreadPool', () => {
  it('rejects invalid pool sizes', () => {
    expect(() => new ParserThreadPool(0)).toThrow(
      'Parser thread pool size must be a positive integer.',
    );

    expect(() => new ParserThreadPool(-1)).toThrow(
      'Parser thread pool size must be a positive integer.',
    );

    expect(() => new ParserThreadPool(1.5)).toThrow(
      'Parser thread pool size must be a positive integer.',
    );
  });

  it('creates exactly the configured number of clients', async () => {
    const createdClients: {
      parse: ReturnType<typeof vi.fn>;

      close: ReturnType<typeof vi.fn>;
    }[] = [];

    const pool = new ParserThreadPool(3, () => {
      const client = {
        parse: vi.fn(async (request: ParseSourceRequest) => createResult(request.filePath)),

        close: vi.fn(async () => undefined),
      };

      createdClients.push(client);

      return client as never;
    });

    expect(pool.size).toBe(3);

    expect(createdClients).toHaveLength(3);

    await pool.close();
  });

  it('runs tasks concurrently up to the pool size', async () => {
    const deferredTasks: Deferred<ParseSourceResult>[] = [];

    const parseMocks: ReturnType<typeof vi.fn>[] = [];

    const pool = new ParserThreadPool(2, () => {
      const parse = vi.fn(() => {
        const deferred = createDeferred<ParseSourceResult>();

        deferredTasks.push(deferred);

        return deferred.promise;
      });
      parseMocks.push(parse);

      return {
        parse,

        close: vi.fn(async () => undefined),
      } as never;
    });

    const first = pool.parse(createRequest('src/first.ts'));

    const second = pool.parse(createRequest('src/second.ts'));

    const third = pool.parse(createRequest('src/third.ts'));

    expect(deferredTasks).toHaveLength(2);

    expect(parseMocks.reduce((total, parse) => total + parse.mock.calls.length, 0)).toBe(2);

    deferredTasks[0]?.resolve(createResult('src/first.ts'));

    await first;

    expect(deferredTasks).toHaveLength(3);

    deferredTasks[1]?.resolve(createResult('src/second.ts'));

    deferredTasks[2]?.resolve(createResult('src/third.ts'));

    await expect(Promise.all([second, third])).resolves.toHaveLength(2);

    await pool.close();
  });

  it('preserves input ordering in parseMany even when tasks finish out of order', async () => {
    const deferredByPath = new Map<string, Deferred<ParseSourceResult>>();

    const pool = new ParserThreadPool(
      3,
      () =>
        ({
          parse: (request: ParseSourceRequest) => {
            const deferred = createDeferred<ParseSourceResult>();

            deferredByPath.set(request.filePath, deferred);

            return deferred.promise;
          },

          close: vi.fn(async () => undefined),
        }) as never,
    );

    const resultPromise = pool.parseMany([
      createRequest('src/a.ts'),

      createRequest('src/b.ts'),

      createRequest('src/c.ts'),
    ]);

    deferredByPath.get('src/c.ts')?.resolve(createResult('src/c.ts'));

    deferredByPath.get('src/a.ts')?.resolve(createResult('src/a.ts'));

    deferredByPath.get('src/b.ts')?.resolve(createResult('src/b.ts'));

    const results = await resultPromise;

    expect(results.map((result) => result.filePath)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    await pool.close();
  });

  it('propagates parser client failures', async () => {
    const pool = new ParserThreadPool(
      1,
      () =>
        ({
          parse: vi.fn(async () => {
            throw new Error('Parser failed.');
          }),

          close: vi.fn(async () => undefined),
        }) as never,
    );

    await expect(pool.parse(createRequest('src/broken.ts'))).rejects.toThrow('Parser failed.');

    await pool.close();
  });

  it('rejects queued work when the pool closes', async () => {
    const activeDeferred = createDeferred<ParseSourceResult>();

    const close = vi.fn(async () => undefined);

    const pool = new ParserThreadPool(
      1,
      () =>
        ({
          parse: vi.fn(() => activeDeferred.promise),

          close,
        }) as never,
    );

    const active = pool.parse(createRequest('src/active.ts'));

    const queued = pool.parse(createRequest('src/queued.ts'));

    const closePromise = pool.close();

    await expect(active).rejects.toThrow('Parser thread pool was closed.');

    await expect(queued).rejects.toThrow('Parser thread pool was closed.');

    await closePromise;

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects new tasks after the pool has closed', async () => {
    const pool = new ParserThreadPool(
      1,
      () =>
        ({
          parse: vi.fn(),

          close: vi.fn(async () => undefined),
        }) as never,
    );

    await pool.close();

    await expect(pool.parse(createRequest('src/after-close.ts'))).rejects.toThrow(
      'Parser thread pool is closed.',
    );
  });
});
