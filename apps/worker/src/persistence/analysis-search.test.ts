import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { AnalysisSearchStore } from './analysis-search.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

interface FakeSelectBuilder {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

interface FakeDatabaseResult {
  database: Database;
  selectSpy: ReturnType<typeof vi.fn>;
  builders: FakeSelectBuilder[];
}

function createSelectBuilder(response: readonly unknown[]): FakeSelectBuilder {
  const builder = {} as FakeSelectBuilder;

  builder.from = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn(async () => response);

  return builder;
}

function createFakeDatabase(selectResponses: readonly (readonly unknown[])[]): FakeDatabaseResult {
  const builders: FakeSelectBuilder[] = [];
  let selectIndex = 0;

  const selectSpy = vi.fn(() => {
    const response = selectResponses[selectIndex];

    if (response === undefined) {
      throw new Error(`Unexpected database select call ${selectIndex + 1}`);
    }

    selectIndex += 1;

    const builder = createSelectBuilder(response);
    builders.push(builder);

    return builder;
  });

  const database = {
    select: selectSpy,
  } as unknown as Database;

  return {
    database,
    selectSpy,
    builders,
  };
}

describe('AnalysisSearchStore', () => {
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

  it('rejects a search query longer than 200 characters', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'a'.repeat(201))).rejects.toThrow(
      'Search query cannot exceed 200 characters',
    );

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-integer search limit', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'server', 1.5)).rejects.toThrow(
      'Search limit must be an integer',
    );

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('rejects search limits outside the allowed range', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'server', 0)).rejects.toThrow(
      'Search limit must be between 1 and 100',
    );

    await expect(store.search(ANALYSIS_ID, 'server', 101)).rejects.toThrow(
      'Search limit must be between 1 and 100',
    );

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('returns null when the analysis is not completed', async () => {
    const { database, selectSpy, builders } = createFakeDatabase([[]]);

    const store = new AnalysisSearchStore(database);

    await expect(store.search(ANALYSIS_ID, 'server')).resolves.toBeNull();

    expect(selectSpy).toHaveBeenCalledTimes(1);
    expect(builders).toHaveLength(1);
    expect(builders[0]?.limit).toHaveBeenCalledWith(1);
  });

  it('returns matching files and symbols for a completed analysis', async () => {
    const { database, selectSpy, builders } = createFakeDatabase([
      [
        {
          id: ANALYSIS_ID,
        },
      ],
      [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          path: 'src/server.ts',
          language: 'typescript',
          isSupported: true,
          parseStatus: 'analyzed',
        },
      ],
      [
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          filePath: 'src/server.ts',
          kind: 'function',
          name: 'startServer',
          qualifiedName: 'startServer',
          startLine: 10,
          startColumn: 0,
          endLine: 20,
          endColumn: 1,
          isExported: true,
          complexity: 3,
        },
      ],
    ]);

    const store = new AnalysisSearchStore(database);

    const result = await store.search(`  ${ANALYSIS_ID}  `, '  server  ');

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,
      query: 'server',

      files: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          path: 'src/server.ts',
          language: 'typescript',
          isSupported: true,
          parseStatus: 'analyzed',
        },
      ],

      symbols: [
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          filePath: 'src/server.ts',
          kind: 'function',
          name: 'startServer',
          qualifiedName: 'startServer',
          startLine: 10,
          startColumn: 0,
          endLine: 20,
          endColumn: 1,
          isExported: true,
          complexity: 3,
        },
      ],
    });

    expect(selectSpy).toHaveBeenCalledTimes(3);
    expect(builders).toHaveLength(3);

    expect(builders[0]?.limit).toHaveBeenCalledWith(1);

    expect(builders[1]?.orderBy).toHaveBeenCalledTimes(1);
    expect(builders[1]?.limit).toHaveBeenCalledWith(20);

    expect(builders[2]?.innerJoin).toHaveBeenCalledTimes(1);
    expect(builders[2]?.orderBy).toHaveBeenCalledTimes(1);
    expect(builders[2]?.limit).toHaveBeenCalledWith(20);
  });

  it('applies the requested limit to both file and symbol searches', async () => {
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

    const result = await store.search(ANALYSIS_ID, 'service', 7);

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,
      query: 'service',
      files: [],
      symbols: [],
    });

    expect(builders[1]?.limit).toHaveBeenCalledWith(7);
    expect(builders[2]?.limit).toHaveBeenCalledWith(7);
  });

  it('returns empty result arrays when a completed analysis has no matches', async () => {
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

    await expect(store.search(ANALYSIS_ID, 'missing')).resolves.toEqual({
      analysisId: ANALYSIS_ID,
      query: 'missing',
      files: [],
      symbols: [],
    });
  });
});
