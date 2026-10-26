import { EventEmitter } from 'node:events';

import type { Worker } from 'node:worker_threads';

import { describe, expect, it, vi } from 'vitest';

import { ParserThreadClient } from './parser-thread-client.js';

import type { ParserThreadRequest, ParserThreadResponse } from './thread-protocol.js';

import type { ParseSourceResult } from './types.js';

class FakeWorker extends EventEmitter {
  public readonly messages: ParserThreadRequest[] = [];

  public readonly terminate = vi.fn(async () => 0);

  public postMessage(message: ParserThreadRequest): void {
    this.messages.push(message);
  }

  public emitResponse(response: ParserThreadResponse): void {
    this.emit('message', response);
  }

  public emitWorkerError(error: Error): void {
    this.emit('error', error);
  }

  public emitExit(exitCode: number): void {
    this.emit('exit', exitCode);
  }
}

function createClient() {
  const fakeWorker = new FakeWorker();

  const client = new ParserThreadClient(fakeWorker as unknown as Worker);

  return {
    client,
    fakeWorker,
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

describe('ParserThreadClient', () => {
  it('sends a parse request and resolves the matching result', async () => {
    const { client, fakeWorker } = createClient();

    const promise = client.parse({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: 'function app() {}',
    });

    expect(fakeWorker.messages).toHaveLength(1);

    const message = fakeWorker.messages[0];

    expect(message).toEqual({
      id: expect.any(String),

      type: 'parse',

      payload: {
        filePath: 'src/app.ts',

        language: 'typescript',

        source: 'function app() {}',
      },
    });

    if (!message) {
      throw new Error('Expected parser request message.');
    }

    const result = createResult('src/app.ts');

    fakeWorker.emitResponse({
      id: message.id,

      type: 'result',

      result,
    });

    await expect(promise).resolves.toEqual(result);

    await client.close();
  });

  it('matches out-of-order responses to the correct promises', async () => {
    const { client, fakeWorker } = createClient();

    const firstPromise = client.parse({
      filePath: 'src/first.ts',

      language: 'typescript',

      source: 'function first() {}',
    });

    const secondPromise = client.parse({
      filePath: 'src/second.ts',

      language: 'typescript',

      source: 'function second() {}',
    });

    const firstMessage = fakeWorker.messages[0];

    const secondMessage = fakeWorker.messages[1];

    if (!firstMessage || !secondMessage) {
      throw new Error('Expected two parser request messages.');
    }

    /*
     * Deliberately answer the second request
     * before the first one.
     */
    fakeWorker.emitResponse({
      id: secondMessage.id,

      type: 'result',

      result: createResult('src/second.ts'),
    });

    fakeWorker.emitResponse({
      id: firstMessage.id,

      type: 'result',

      result: createResult('src/first.ts'),
    });

    await expect(firstPromise).resolves.toMatchObject({
      filePath: 'src/first.ts',
    });

    await expect(secondPromise).resolves.toMatchObject({
      filePath: 'src/second.ts',
    });

    await client.close();
  });

  it('rejects the matching request when the parser thread returns an error', async () => {
    const { client, fakeWorker } = createClient();

    const promise = client.parse({
      filePath: 'src/broken.ts',

      language: 'typescript',

      source: 'broken source',
    });

    const message = fakeWorker.messages[0];

    if (!message) {
      throw new Error('Expected parser request message.');
    }

    fakeWorker.emitResponse({
      id: message.id,

      type: 'error',

      error: {
        name: 'ParserError',

        message: 'Unable to parse source.',

        stack: 'ParserError: Unable to parse source.',
      },
    });

    await expect(promise).rejects.toMatchObject({
      name: 'ParserError',

      message: 'Unable to parse source.',
    });

    await client.close();
  });

  it('rejects all pending requests when the worker crashes', async () => {
    const { client, fakeWorker } = createClient();

    const firstPromise = client.parse({
      filePath: 'src/first.ts',

      language: 'typescript',

      source: 'function first() {}',
    });

    const secondPromise = client.parse({
      filePath: 'src/second.ts',

      language: 'typescript',

      source: 'function second() {}',
    });

    const workerError = new Error('Parser worker crashed.');

    fakeWorker.emitWorkerError(workerError);

    await expect(firstPromise).rejects.toThrow('Parser worker crashed.');

    await expect(secondPromise).rejects.toThrow('Parser worker crashed.');

    /*
     * Once a worker crashes, this client
     * must not accept more work.
     */
    await expect(
      client.parse({
        filePath: 'src/third.ts',

        language: 'typescript',

        source: 'function third() {}',
      }),
    ).rejects.toThrow('Parser thread client is closed.');
  });

  it('rejects pending work when the worker exits unexpectedly', async () => {
    const { client, fakeWorker } = createClient();

    const promise = client.parse({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: 'function app() {}',
    });

    fakeWorker.emitExit(1);

    await expect(promise).rejects.toThrow('Parser worker thread exited unexpectedly with code 1.');
  });

  it('closes the worker and rejects pending work', async () => {
    const { client, fakeWorker } = createClient();

    const pendingPromise = client.parse({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: 'function app() {}',
    });

    await client.close();

    await expect(pendingPromise).rejects.toThrow('Parser thread client was closed.');

    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);

    /*
     * close() is intentionally idempotent.
     */
    await client.close();

    expect(fakeWorker.terminate).toHaveBeenCalledTimes(1);

    await expect(
      client.parse({
        filePath: 'src/after-close.ts',

        language: 'typescript',

        source: 'function afterClose() {}',
      }),
    ).rejects.toThrow('Parser thread client is closed.');
  });
});
