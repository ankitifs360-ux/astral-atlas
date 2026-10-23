import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { AnalysisSearchStore } from './analysis-search-store.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

const FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const SYMBOL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface FakeDatabaseResult {
  database: Database;

  selectSpy: ReturnType<typeof vi.fn>;

  builders: ReturnType<typeof createSelectBuilder>[];
}

function createSelectBuilder(response: readonly unknown[]) {
  let builder: {
    from: ReturnType<typeof vi.fn>;

    innerJoin: ReturnType<typeof vi.fn>;

    where: ReturnType<typeof vi.fn>;

    orderBy: ReturnType<typeof vi.fn>;

    limit: ReturnType<typeof vi.fn>;

    then: Promise<readonly unknown[]>['then'];
  };

  builder = {
    from: vi.fn(() => builder),

    innerJoin: vi.fn(() => builder),

    where: vi.fn(() => builder),

    orderBy: vi.fn(() => builder),

    limit: vi.fn(() => builder),

    then: (onFulfilled, onRejected) => Promise.resolve(response).then(onFulfilled, onRejected),
  };

  return builder;
}

function createFakeDatabase(selectResponses: readonly (readonly unknown[])[]): FakeDatabaseResult {
  let selectIndex = 0;

  const builders: ReturnType<typeof createSelectBuilder>[] = [];

  const selectSpy = vi.fn(() => {
    const response = selectResponses[selectIndex];

    selectIndex += 1;

    if (response === undefined) {
      throw new Error(`Unexpected database select call ${selectIndex}`);
    }

    const builder = createSelectBuilder(response);

    builders.push(builder);

    return builder;
  });

  return {
    database: {
      select: selectSpy,
    } as unknown as Database,

    selectSpy,

    builders,
  };
}

describe('AnalysisSearchStore', () => {
  it('maps file and symbol matches into the public API response shape', async () => {
    const fileRows = [
      {
        id: FILE_ID,

        path: 'src/server.ts',

        language: 'typescript',

        isSupported: true,

        parseStatus: 'analyzed' as const,
      },
    ];

    const symbolRows = [
      {
        id: SYMBOL_ID,

        fileId: FILE_ID,

        filePath: 'src/server.ts',

        kind: 'function' as const,

        name: 'startServer',

        qualifiedName: 'startServer',

        startLine: 5,

        startColumn: 0,

        endLine: 12,

        endColumn: 1,

        isExported: true,

        complexity: 3,
      },
    ];

    const { database, selectSpy, builders } = createFakeDatabase([
      [
        {
          id: ANALYSIS_ID,
        },
      ],

      fileRows,

      symbolRows,
    ]);

    const store = new AnalysisSearchStore(database);

    const result = await store.search(ANALYSIS_ID, '  Server  ', 25);

    expect(selectSpy).toHaveBeenCalledTimes(3);

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,

      query: 'Server',

      files: [
        {
          type: 'file',

          fileId: FILE_ID,

          path: 'src/server.ts',

          language: 'typescript',

          isSupported: true,

          parseStatus: 'analyzed',
        },
      ],

      symbols: [
        {
          type: 'symbol',

          symbolId: SYMBOL_ID,

          fileId: FILE_ID,

          filePath: 'src/server.ts',

          kind: 'function',

          name: 'startServer',

          qualifiedName: 'startServer',

          startLine: 5,

          startColumn: 0,

          endLine: 12,

          endColumn: 1,

          isExported: true,

          complexity: 3,
        },
      ],
    });

    /*
     * Query 1 checks whether the analysis is completed.
     *
     * Queries 2 and 3 are file + symbol searches and
     * should both use the caller-provided limit.
     */
    expect(builders[1]?.limit).toHaveBeenCalledWith(25);

    expect(builders[2]?.limit).toHaveBeenCalledWith(25);
  });

  it('uses the default result limit when none is supplied', async () => {
    const { database, builders } = createFakeDatabase([
      [
        {
          id: ANALYSIS_ID,
        },
      ],

      [],

      [],
    ]);

    const store = new AnalysisSearchStore(database);

    const result = await store.search(ANALYSIS_ID, 'server');

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,

      query: 'server',

      files: [],

      symbols: [],
    });

    expect(builders[1]?.limit).toHaveBeenCalledWith(20);

    expect(builders[2]?.limit).toHaveBeenCalledWith(20);
  });

  it('returns null when the analysis is not completed', async () => {
    const { database, selectSpy } = createFakeDatabase([[]]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'server')).resolves.toBeNull();

    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('allows literal wildcard-like characters in the search query', async () => {
    const { database } = createFakeDatabase([
      [
        {
          id: ANALYSIS_ID,
        },
      ],

      [],

      [],
    ]);

    const store = new AnalysisSearchStore(database);

    const result = await store.search(ANALYSIS_ID, '%server_');

    /*
     * The store does not reject "%" or "_".
     *
     * PostgreSQL receives them through parameterized
     * position(lower(query) in lower(column)) expressions,
     * so they are ordinary characters rather than ILIKE
     * wildcards.
     */
    expect(result?.query).toBe('%server_');
  });

  it('rejects an empty analysis ID before querying PostgreSQL', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search('   ', 'server')).rejects.toThrow('analysisId cannot be empty');

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty search query before querying PostgreSQL', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, '   ')).rejects.toThrow('Search query cannot be empty');

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('rejects search queries longer than 200 characters', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'a'.repeat(201))).rejects.toThrow(
      'Search query cannot exceed 200 characters',
    );

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'zero',

      limit: 0,

      expectedMessage: 'Search limit must be between 1 and 100',
    },

    {
      label: 'too large',

      limit: 101,

      expectedMessage: 'Search limit must be between 1 and 100',
    },

    {
      label: 'fractional',

      limit: 1.5,

      expectedMessage: 'Search limit must be an integer',
    },
  ])(
    'rejects a $label result limit before querying PostgreSQL',
    async ({ limit, expectedMessage }) => {
      const { database, selectSpy } = createFakeDatabase([]);

      const store = new AnalysisSearchStore(database);

      await expect(store.search(ANALYSIS_ID, 'server', limit)).rejects.toThrow(expectedMessage);

      expect(selectSpy).not.toHaveBeenCalled();
    },
  );
});
