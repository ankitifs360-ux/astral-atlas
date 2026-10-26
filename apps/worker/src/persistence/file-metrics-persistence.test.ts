import { describe, expect, it, vi } from 'vitest';

import { files, metrics } from '@astral-atlas/database';

import { persistFilesAndMetrics } from './file-metrics-persistence.js';

import type { DatabaseTransaction } from './file-metrics-persistence.js';

import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

import type { PersistCompletedAnalysisInput } from './types.js';

interface CapturedInsert {
  table: unknown;

  values: unknown;
}

function createFileMetrics(filePath: string): FileMetrics {
  return {
    filePath,

    dependencies: {
      fanIn: 2,

      fanOut: 3,

      transitiveDependencyCount: 5,
    },

    blastRadius: {
      affectedFileCount: 7,

      maxDistance: 4,
    },

    cycles: {
      inDependencyCycle: true,

      cyclicComponentSize: 2,
    },

    structure: {
      importCount: 3,

      functionCount: 2,

      classCount: 1,

      cyclomaticComplexity: 6,

      hasSyntaxErrors: false,
    },

    churn: {
      changedCommitCount: 9,
    },
  };
}

function createRepositoryMetrics(metricFiles: FileMetrics[]): RepositoryMetrics {
  return {
    summary: {
      fileCount: metricFiles.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: metricFiles.reduce(
        (total, file) => total + file.structure.cyclomaticComplexity,
        0,
      ),

      averageCyclomaticComplexity:
        metricFiles.length === 0
          ? 0
          : metricFiles.reduce((total, file) => total + file.structure.cyclomaticComplexity, 0) /
            metricFiles.length,

      maxCyclomaticComplexity:
        metricFiles.length === 0
          ? 0
          : Math.max(...metricFiles.map((file) => file.structure.cyclomaticComplexity)),

      historyAvailable: true,

      totalChangedCommitCount: metricFiles.reduce(
        (total, file) => total + (file.churn?.changedCommitCount ?? 0),
        0,
      ),

      averageChangedCommitCount:
        metricFiles.length === 0
          ? 0
          : metricFiles.reduce((total, file) => total + (file.churn?.changedCommitCount ?? 0), 0) /
            metricFiles.length,

      maxChangedCommitCount:
        metricFiles.length === 0
          ? 0
          : Math.max(...metricFiles.map((file) => file.churn?.changedCommitCount ?? 0)),
    },

    files: metricFiles,
  };
}

function createInput(
  metricFiles: FileMetrics[] = [createFileMetrics('src/server.ts')],
): PersistCompletedAnalysisInput {
  return {
    analysisId: '11111111-1111-1111-1111-111111111111',

    files: metricFiles.map((metric) => ({
      filePath: metric.filePath,

      language: 'typescript',

      sizeBytes: 100,
    })),

    symbols: [],

    graphAnalysis: {
      graph: {
        nodes: [],

        edges: [],
      },

      graphIndex: {} as PersistCompletedAnalysisInput['graphAnalysis']['graphIndex'],

      resolvedImports: [],

      cycles: [],
    },

    metrics: createRepositoryMetrics(metricFiles),

    findings: [],

    healthScore: {
      score: 100,

      rating: 'excellent',

      dimensions: [],

      analyzedFileCount: metricFiles.length,
    },

    onboarding: {
      steps: [],

      consideredFileCount: metricFiles.length,

      maxSteps: 10,
    },

    goodFirstTasks: {
      recommendations: [],

      consideredFileCount: metricFiles.length,

      maxRecommendations: 5,
    },

    newcomerChangeGuidance: {
      recommendations: [],

      consideredFileCount: metricFiles.length,

      maxRecommendations: 5,
    },
  };
}

function createTransaction(
  insertedFileRows: {
    id: string;

    path: string;
  }[],
): {
  transaction: DatabaseTransaction;

  inserts: CapturedInsert[];

  insertSpy: ReturnType<typeof vi.fn>;
} {
  const inserts: CapturedInsert[] = [];

  const insertSpy = vi.fn((table: unknown) => {
    if (table === files) {
      return {
        values(values: unknown) {
          inserts.push({
            table,
            values,
          });

          return {
            returning: vi.fn(async () => insertedFileRows),
          };
        },
      };
    }

    if (table === metrics) {
      return {
        values: vi.fn(async (values: unknown) => {
          inserts.push({
            table,
            values,
          });
        }),
      };
    }

    throw new Error('Unexpected table insert');
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

describe('persistFilesAndMetrics', () => {
  it('persists files and returns a path-to-id map', async () => {
    const input = createInput([
      createFileMetrics('src/server.ts'),

      createFileMetrics('src/routes.ts'),
    ]);

    const { transaction } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },

      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        path: 'src/routes.ts',
      },
    ]);

    const result = await persistFilesAndMetrics(transaction, input);

    expect(result.get('src/server.ts')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

    expect(result.get('src/routes.ts')).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

    expect(result.size).toBe(2);
  });

  it('persists default file values', async () => {
    const input = createInput();

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },
    ]);

    await persistFilesAndMetrics(transaction, input);

    const fileInsert = inserts.find((insert) => insert.table === files);

    expect(fileInsert?.values).toEqual([
      {
        analysisId: input.analysisId,

        path: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 100,

        contentHash: null,

        sourceContent: null,

        isSupported: true,

        parseStatus: 'analyzed',
      },
    ]);
  });

  it('persists explicit file metadata and source content', async () => {
    const input = createInput();

    input.files = [
      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 250,

        contentHash: 'abc123',

        sourceContent: 'export const server = true;\n',

        isSupported: false,

        parseStatus: 'partial',
      },
    ];

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },
    ]);

    await persistFilesAndMetrics(transaction, input);

    const fileInsert = inserts.find((insert) => insert.table === files);

    expect(fileInsert?.values).toEqual([
      {
        analysisId: input.analysisId,

        path: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 250,

        contentHash: 'abc123',

        sourceContent: 'export const server = true;\n',

        isSupported: false,

        parseStatus: 'partial',
      },
    ]);
  });

  it('persists all B8 per-file metrics', async () => {
    const input = createInput();

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },
    ]);

    await persistFilesAndMetrics(transaction, input);

    const metricInsert = inserts.find((insert) => insert.table === metrics);

    expect(metricInsert?.values).toEqual([
      {
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        cyclomaticComplexity: 6,

        importCount: 3,

        functionCount: 2,

        classCount: 1,

        hasSyntaxErrors: false,

        churnCommits: 9,

        fanIn: 2,

        fanOut: 3,

        transitiveDependencyCount: 5,

        blastRadius: 7,

        blastMaxDistance: 4,

        inDependencyCycle: true,

        cyclicComponentSize: 2,

        riskScore: null,
      },
    ]);
  });

  it('persists the B15.4 architecture risk score', async () => {
    const input = createInput();

    input.architectureRiskScores = [
      {
        filePath: 'src/server.ts',

        riskScore: 84,
      },
    ];

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },
    ]);

    await persistFilesAndMetrics(transaction, input);

    const metricInsert = inserts.find((insert) => insert.table === metrics);

    expect(metricInsert?.values).toEqual([
      expect.objectContaining({
        riskScore: 84,
      }),
    ]);
  });

  it('stores null churn when Git history is unavailable for a file', async () => {
    const metric = createFileMetrics('src/server.ts');

    metric.churn = null;

    const input = createInput([metric]);

    input.metrics.summary.historyAvailable = false;

    input.metrics.summary.totalChangedCommitCount = null;

    input.metrics.summary.averageChangedCommitCount = null;

    input.metrics.summary.maxChangedCommitCount = null;

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },
    ]);

    await persistFilesAndMetrics(transaction, input);

    const metricInsert = inserts.find((insert) => insert.table === metrics);

    expect(metricInsert?.values).toEqual([
      expect.objectContaining({
        churnCommits: null,
      }),
    ]);
  });

  it('allows a persisted file without a B8 metrics row', async () => {
    const input = createInput();

    input.files = [
      ...input.files,

      {
        filePath: 'src/unsupported.txt',

        language: 'unknown',

        sizeBytes: 20,

        isSupported: false,

        parseStatus: 'unsupported',
      },
    ];

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/server.ts',
      },

      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        path: 'src/unsupported.txt',
      },
    ]);

    const result = await persistFilesAndMetrics(transaction, input);

    expect(result.size).toBe(2);

    const metricInsert = inserts.find((insert) => insert.table === metrics);

    expect(metricInsert?.values).toHaveLength(1);
  });

  it('uses returned database paths instead of relying on insertion order', async () => {
    const input = createInput([createFileMetrics('src/a.ts'), createFileMetrics('src/b.ts')]);

    const { transaction } = createTransaction([
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        path: 'src/b.ts',
      },

      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        path: 'src/a.ts',
      },
    ]);

    const result = await persistFilesAndMetrics(transaction, input);

    expect(result.get('src/a.ts')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

    expect(result.get('src/b.ts')).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('rejects duplicate persisted file paths', async () => {
    const input = createInput();

    input.files = [
      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 10,
      },

      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 20,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Duplicate persistence file path "src/server.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects negative file sizes before writing anything', async () => {
    const input = createInput();

    input.files = [
      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: -1,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'sizeBytes for "src/server.ts" must be a non-negative integer',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects metrics that reference an unknown persisted file', async () => {
    const input = createInput();

    input.files = [];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Metrics reference unknown persisted file "src/server.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a repository summary whose file count disagrees with per-file metrics', async () => {
    const input = createInput();

    input.metrics.summary.fileCount = 99;

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Repository metric summary fileCount does not match the number of per-file metrics',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate per-file metric paths', async () => {
    const metric = createFileMetrics('src/server.ts');

    const input = createInput();

    input.metrics.files = [metric, metric];

    input.metrics.summary.fileCount = 2;

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Duplicate file metrics for "src/server.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate architecture risk scores for the same file', async () => {
    const input = createInput();

    input.architectureRiskScores = [
      {
        filePath: 'src/server.ts',

        riskScore: 25,
      },

      {
        filePath: 'src/server.ts',

        riskScore: 60,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Duplicate architecture risk score for "src/server.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects architecture risk scores below zero', async () => {
    const input = createInput();

    input.architectureRiskScores = [
      {
        filePath: 'src/server.ts',

        riskScore: -1,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Architecture risk score for "src/server.ts" must be between 0 and 100',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects architecture risk scores above 100', async () => {
    const input = createInput();

    input.architectureRiskScores = [
      {
        filePath: 'src/server.ts',

        riskScore: 101,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Architecture risk score for "src/server.ts" must be between 0 and 100',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an architecture risk score for a file without persisted metrics', async () => {
    const input = createInput();

    input.files = [
      ...input.files,

      {
        filePath: 'src/unsupported.txt',

        language: 'unknown',

        sizeBytes: 20,

        isSupported: false,

        parseStatus: 'unsupported',
      },
    ];

    input.architectureRiskScores = [
      {
        filePath: 'src/unsupported.txt',

        riskScore: 25,
      },
    ];

    const { transaction, insertSpy } = createTransaction([]);

    await expect(persistFilesAndMetrics(transaction, input)).rejects.toThrow(
      'Architecture risk score references file without persisted metrics "src/unsupported.txt"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('does not issue inserts for a truly empty repository', async () => {
    const input = createInput([]);

    const { transaction, insertSpy } = createTransaction([]);

    const result = await persistFilesAndMetrics(transaction, input);

    expect(result.size).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
