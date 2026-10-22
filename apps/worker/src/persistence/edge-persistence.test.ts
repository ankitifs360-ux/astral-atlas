import { describe, expect, it, vi } from 'vitest';

import { edges } from '@astral-atlas/database';

import { persistGraphEdges } from './edge-persistence.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

interface CapturedInsert {
  table: unknown;

  values: unknown;
}

function createGraphAnalysis(
  graphEdges: {
    source: string;

    target: string;
  }[] = [],
): RepositoryGraphAnalysis {
  const filePaths = [...new Set(graphEdges.flatMap((edge) => [edge.source, edge.target]))];

  return {
    graph: {
      nodes: filePaths.map((filePath) => ({
        id: filePath,

        kind: 'file',

        filePath,

        language: 'typescript',

        hasSyntaxErrors: false,
      })),

      edges: graphEdges.map((edge, index) => ({
        id: `edge:${index}`,

        kind: 'imports',

        source: edge.source,

        target: edge.target,

        specifier: `./dependency-${index}`,

        range: {
          start: {
            row: index,

            column: 0,
          },

          end: {
            row: index,

            column: 1,
          },
        },
      })),
    },

    graphIndex: {} as RepositoryGraphAnalysis['graphIndex'],

    resolvedImports: [],

    cycles: [],
  };
}

function createTransaction(): {
  transaction: DatabaseTransaction;

  inserts: CapturedInsert[];

  insertSpy: ReturnType<typeof vi.fn>;
} {
  const inserts: CapturedInsert[] = [];

  const insertSpy = vi.fn((table: unknown) => {
    if (table !== edges) {
      throw new Error('Unexpected table insert');
    }

    return {
      values: vi.fn(async (values: unknown) => {
        inserts.push({
          table,
          values,
        });
      }),
    };
  });

  const transaction = {
    insert: insertSpy,
  } as unknown as DatabaseTransaction;

  return {
    transaction,
    inserts,
    insertSpy,
  };
}

function createFileIdByPath(entries: [string, string][]): FileIdByPath {
  return new Map(entries);
}

describe('persistGraphEdges', () => {
  it('persists a file-level import edge', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/server.ts',

        target: 'src/routes.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/server.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/routes.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts).toHaveLength(1);

    expect(inserts[0]?.values).toEqual([
      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        fromSymbolId: null,

        toSymbolId: null,

        type: 'import',

        weight: 1,

        isDynamic: false,
      },
    ]);
  });

  it('maps source to fromFileId and target to toFileId', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/a.ts',

        target: 'src/b.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/a.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/b.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts[0]?.values).toEqual([
      expect.objectContaining({
        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      }),
    ]);
  });

  it('persists multiple graph edges', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/server.ts',

        target: 'src/routes.ts',
      },

      {
        source: 'src/routes.ts',

        target: 'src/service.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/server.ts', 'cccccccc-cccc-cccc-cccc-cccccccccccc'],

      ['src/routes.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],

      ['src/service.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts[0]?.values).toHaveLength(2);
  });

  it('sorts persisted rows deterministically by source and target file IDs', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/z.ts',

        target: 'src/c.ts',
      },

      {
        source: 'src/a.ts',

        target: 'src/b.ts',
      },

      {
        source: 'src/a.ts',

        target: 'src/c.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/z.ts', 'dddddddd-dddd-dddd-dddd-dddddddddddd'],

      ['src/a.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/b.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],

      ['src/c.ts', 'cccccccc-cccc-cccc-cccc-cccccccccccc'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts[0]?.values).toEqual([
      expect.objectContaining({
        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      }),

      expect.objectContaining({
        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }),

      expect.objectContaining({
        fromFileId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',

        toFileId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      }),
    ]);
  });

  it('persists self-loop import edges', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/self.ts',

        target: 'src/self.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/self.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts[0]?.values).toEqual([
      expect.objectContaining({
        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      }),
    ]);
  });

  it('persists both directions of a dependency cycle', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/a.ts',

        target: 'src/b.ts',
      },

      {
        source: 'src/b.ts',

        target: 'src/a.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/a.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/b.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, inserts } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      graphAnalysis,
      fileIdByPath,
    );

    expect(inserts[0]?.values).toHaveLength(2);
  });

  it('rejects an edge whose source file was not persisted', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/missing.ts',

        target: 'src/routes.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/routes.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGraphEdges(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        graphAnalysis,
        fileIdByPath,
      ),
    ).rejects.toThrow('Graph edge references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an edge whose target file was not persisted', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/server.ts',

        target: 'src/missing.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/server.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGraphEdges(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        graphAnalysis,
        fileIdByPath,
      ),
    ).rejects.toThrow('Graph edge references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('validates every edge before writing any rows', async () => {
    const graphAnalysis = createGraphAnalysis([
      {
        source: 'src/server.ts',

        target: 'src/routes.ts',
      },

      {
        source: 'src/routes.ts',

        target: 'src/missing.ts',
      },
    ]);

    const fileIdByPath = createFileIdByPath([
      ['src/server.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/routes.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGraphEdges(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        graphAnalysis,
        fileIdByPath,
      ),
    ).rejects.toThrow('Graph edge references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('does not insert anything for an empty graph', async () => {
    const { transaction, insertSpy } = createTransaction();

    await persistGraphEdges(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      createGraphAnalysis(),
      createFileIdByPath([]),
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });
});

it('collapses duplicate file relationships and stores their import count as weight', async () => {
  const graphAnalysis = createGraphAnalysis([
    {
      source: 'src/a.ts',

      target: 'src/b.ts',
    },

    {
      source: 'src/a.ts',

      target: 'src/b.ts',
    },

    {
      source: 'src/a.ts',

      target: 'src/b.ts',
    },
  ]);

  const fileIdByPath = createFileIdByPath([
    ['src/a.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

    ['src/b.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
  ]);

  const { transaction, inserts } = createTransaction();

  await persistGraphEdges(
    transaction,
    '11111111-1111-1111-1111-111111111111',
    graphAnalysis,
    fileIdByPath,
  );

  expect(inserts).toHaveLength(1);

  expect(inserts[0]?.values).toEqual([
    expect.objectContaining({
      fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

      toFileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

      type: 'import',

      weight: 3,
    }),
  ]);
});
