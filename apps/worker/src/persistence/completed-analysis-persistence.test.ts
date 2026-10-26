import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { persistCompletedAnalysis } from './completed-analysis-persistence.js';

import { persistGraphEdges } from './edge-persistence.js';

import { persistAnalysisFindings } from './finding-persistence.js';

import { persistFilesAndMetrics } from './file-metrics-persistence.js';

import { persistFunctionCallEdges } from './function-call-edge-persistence.js';

import { persistGoodFirstTaskRecommendations } from './good-first-task-persistence.js';

import { persistNewcomerChangeGuidanceRecommendations } from './newcomer-change-guidance-persistence.js';

import { persistAnalysisResult } from './result-persistence.js';

import { persistAnalysisSymbols } from './symbol-persistence.js';

import type { PersistCompletedAnalysisInput } from './types.js';

vi.mock('./file-metrics-persistence.js', () => ({
  persistFilesAndMetrics: vi.fn(),
}));

vi.mock('./edge-persistence.js', () => ({
  persistGraphEdges: vi.fn(),
}));

vi.mock('./function-call-edge-persistence.js', () => ({
  persistFunctionCallEdges: vi.fn(),
}));

vi.mock('./finding-persistence.js', () => ({
  persistAnalysisFindings: vi.fn(),
}));

vi.mock('./good-first-task-persistence.js', () => ({
  persistGoodFirstTaskRecommendations: vi.fn(),
}));

vi.mock('./newcomer-change-guidance-persistence.js', () => ({
  persistNewcomerChangeGuidanceRecommendations: vi.fn(),
}));

vi.mock('./result-persistence.js', () => ({
  persistAnalysisResult: vi.fn(),
}));

vi.mock('./symbol-persistence.js', () => ({
  persistAnalysisSymbols: vi.fn(),
}));

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

const SERVER_FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const SERVICE_FILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

type AnalysisStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

interface FakeDatabaseOptions {
  analysisExists?: boolean;

  status?: AnalysisStatus;

  updatedRows?: {
    id: string;
  }[];

  order?: string[];
}

interface FakeDatabaseResult {
  database: Database;

  updateSpy: ReturnType<typeof vi.fn>;

  transactionSpy: ReturnType<typeof vi.fn>;

  getUpdateValues: () => unknown;
}

function createInput(): PersistCompletedAnalysisInput {
  return {
    analysisId: ANALYSIS_ID,

    files: [
      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 100,
      },

      {
        filePath: 'src/service.ts',

        language: 'typescript',

        sizeBytes: 80,
      },
    ],

    symbols: [],

    graphAnalysis: {
      graph: {
        nodes: [
          {
            id: 'src/server.ts',

            kind: 'file',

            filePath: 'src/server.ts',

            language: 'typescript',

            hasSyntaxErrors: false,
          },

          {
            id: 'src/service.ts',

            kind: 'file',

            filePath: 'src/service.ts',

            language: 'typescript',

            hasSyntaxErrors: false,
          },
        ],

        edges: [
          {
            id: 'edge:test',

            kind: 'imports',

            source: 'src/server.ts',

            target: 'src/service.ts',

            specifier: './service.js',

            range: {
              start: {
                row: 0,

                column: 0,
              },

              end: {
                row: 0,

                column: 10,
              },
            },
          },
        ],
      },

      graphIndex: {} as PersistCompletedAnalysisInput['graphAnalysis']['graphIndex'],

      resolvedImports: [],

      cycles: [],
    },

    metrics: {
      summary: {
        fileCount: 2,

        internalDependencyCount: 1,

        externalImportCount: 0,

        unresolvedImportCount: 0,

        cyclicComponentCount: 0,

        cyclicFileCount: 0,

        totalCyclomaticComplexity: 2,

        averageCyclomaticComplexity: 1,

        maxCyclomaticComplexity: 1,

        historyAvailable: false,

        totalChangedCommitCount: null,

        averageChangedCommitCount: null,

        maxChangedCommitCount: null,
      },

      files: [
        {
          filePath: 'src/server.ts',

          dependencies: {
            fanIn: 0,

            fanOut: 1,

            transitiveDependencyCount: 1,
          },

          blastRadius: {
            affectedFileCount: 0,

            maxDistance: 0,
          },

          cycles: {
            inDependencyCycle: false,

            cyclicComponentSize: 0,
          },

          structure: {
            importCount: 1,

            functionCount: 1,

            classCount: 0,

            cyclomaticComplexity: 1,

            hasSyntaxErrors: false,
          },

          churn: null,
        },

        {
          filePath: 'src/service.ts',

          dependencies: {
            fanIn: 1,

            fanOut: 0,

            transitiveDependencyCount: 0,
          },

          blastRadius: {
            affectedFileCount: 1,

            maxDistance: 1,
          },

          cycles: {
            inDependencyCycle: false,

            cyclicComponentSize: 0,
          },

          structure: {
            importCount: 0,

            functionCount: 1,

            classCount: 0,

            cyclomaticComplexity: 1,

            hasSyntaxErrors: false,
          },

          churn: null,
        },
      ],
    },

    findings: [
      {
        id: 'finding:test',

        kind: 'high-fan-in',

        severity: 'medium',

        title: 'High fan-in',

        description: 'Shared dependency.',

        filePaths: ['src/service.ts'],

        evidence: [
          {
            metric: 'fanIn',

            value: 1,

            threshold: 1,
          },
        ],
      },
    ],

    healthScore: {
      score: 100,

      rating: 'excellent',

      dimensions: [
        {
          dimension: 'maintainability',

          maxScore: 25,

          score: 25,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'change-risk',

          maxScore: 20,

          score: 20,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'dependency-health',

          maxScore: 25,

          score: 25,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'coupling',

          maxScore: 20,

          score: 20,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'resolution-quality',

          maxScore: 10,

          score: 10,

          deductedPoints: 0,

          deductions: [],
        },
      ],

      analyzedFileCount: 2,
    },

    onboarding: {
      steps: [
        {
          order: 1,

          filePath: 'src/server.ts',

          score: 50,

          signals: [
            {
              kind: 'entry-point',

              weight: 50,

              description: 'Repository entry point.',
            },
          ],
        },

        {
          order: 2,

          filePath: 'src/service.ts',

          score: 35,

          signals: [
            {
              kind: 'dependency-of-previous',

              weight: 15,

              description: 'Dependency of previous file.',
            },
          ],
        },
      ],

      consideredFileCount: 2,

      maxSteps: 10,
    },

    goodFirstTasks: {
      recommendations: [
        {
          filePath: 'src/service.ts',

          score: 85,

          architectureRiskScore: 25,

          signals: [],
        },
      ],

      consideredFileCount: 2,

      maxRecommendations: 5,
    },

    newcomerChangeGuidance: {
      recommendations: [
        {
          filePath: 'src/service.ts',

          safetyScore: 80,

          riskLevel: 'low',

          blastRadius: 1,

          blastMaxDistance: 1,

          reviewFilePaths: ['src/server.ts'],

          signals: [
            {
              kind: 'blast-radius',

              description: 'One dependent file should be reviewed before changing this file.',
            },
          ],
        },
      ],

      consideredFileCount: 2,

      maxRecommendations: 5,
    },
  };
}

function createFakeDatabase(options: FakeDatabaseOptions = {}): FakeDatabaseResult {
  const analysisExists = options.analysisExists ?? true;

  const status = options.status ?? 'running';

  const updatedRows = options.updatedRows ?? [
    {
      id: ANALYSIS_ID,
    },
  ];

  const order = options.order;

  let updateValues: unknown;

  const limitSpy = vi.fn(async () => {
    order?.push('select-analysis');

    return analysisExists
      ? [
          {
            id: ANALYSIS_ID,

            status,
          },
        ]
      : [];
  });

  const selectSpy = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: limitSpy,
      })),
    })),
  }));

  const returningSpy = vi.fn(async () => {
    order?.push('mark-completed');

    return updatedRows;
  });

  const setSpy = vi.fn((values: unknown) => {
    updateValues = values;

    return {
      where: vi.fn(() => ({
        returning: returningSpy,
      })),
    };
  });

  const updateSpy = vi.fn(() => ({
    set: setSpy,
  }));

  const transaction = {
    select: selectSpy,

    update: updateSpy,
  };

  /*
   * Important:
   *
   * Use "tx" as the callback parameter name.
   *
   * If we call it "transaction", TypeScript sees:
   *
   * transaction: typeof transaction
   *
   * as a self-referencing type because the
   * parameter shadows the outer variable.
   */
  const transactionSpy = vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
    callback(transaction),
  );

  const database = {
    transaction: transactionSpy,
  } as unknown as Database;

  return {
    database,

    updateSpy,

    transactionSpy,

    getUpdateValues: () => updateValues,
  };
}

describe('persistCompletedAnalysis', () => {
  beforeEach(() => {
    vi.mocked(persistFilesAndMetrics).mockReset();

    vi.mocked(persistGraphEdges).mockReset();

    vi.mocked(persistFunctionCallEdges).mockReset();

    vi.mocked(persistAnalysisFindings).mockReset();

    vi.mocked(persistGoodFirstTaskRecommendations).mockReset();

    vi.mocked(persistNewcomerChangeGuidanceRecommendations).mockReset();

    vi.mocked(persistAnalysisResult).mockReset();

    vi.mocked(persistAnalysisSymbols).mockReset();

    vi.mocked(persistFilesAndMetrics).mockResolvedValue(
      new Map([
        ['src/server.ts', SERVER_FILE_ID],

        ['src/service.ts', SERVICE_FILE_ID],
      ]),
    );

    vi.mocked(persistAnalysisSymbols).mockResolvedValue(new Map());

    vi.mocked(persistGraphEdges).mockResolvedValue(1);

    vi.mocked(persistFunctionCallEdges).mockResolvedValue(0);

    vi.mocked(persistAnalysisFindings).mockResolvedValue(
      new Map([['finding:test', 'cccccccc-cccc-cccc-cccc-cccccccccccc']]),
    );

    vi.mocked(persistAnalysisResult).mockResolvedValue();

    vi.mocked(persistGoodFirstTaskRecommendations).mockResolvedValue(1);

    vi.mocked(persistNewcomerChangeGuidanceRecommendations).mockResolvedValue(1);
  });

  it('persists every stage in the required order', async () => {
    const order: string[] = [];

    vi.mocked(persistFilesAndMetrics).mockImplementation(async () => {
      order.push('files-metrics');

      return new Map([
        ['src/server.ts', SERVER_FILE_ID],

        ['src/service.ts', SERVICE_FILE_ID],
      ]);
    });

    vi.mocked(persistAnalysisSymbols).mockImplementation(async () => {
      order.push('symbols');

      return new Map();
    });

    vi.mocked(persistGraphEdges).mockImplementation(async () => {
      order.push('edges');

      return 1;
    });

    vi.mocked(persistFunctionCallEdges).mockImplementation(async () => {
      order.push('call-edges');

      return 0;
    });

    vi.mocked(persistAnalysisFindings).mockImplementation(async () => {
      order.push('findings');

      return new Map();
    });

    vi.mocked(persistAnalysisResult).mockImplementation(async () => {
      order.push('result');
    });

    vi.mocked(persistGoodFirstTaskRecommendations).mockImplementation(async () => {
      order.push('good-first-tasks');

      return 1;
    });

    vi.mocked(persistNewcomerChangeGuidanceRecommendations).mockImplementation(async () => {
      order.push('newcomer-change-guidance');

      return 1;
    });

    const { database } = createFakeDatabase({
      order,
    });

    await persistCompletedAnalysis(database, createInput());

    expect(order).toEqual([
      'select-analysis',
      'files-metrics',
      'symbols',
      'edges',
      'call-edges',
      'findings',
      'result',
      'good-first-tasks',
      'newcomer-change-guidance',
      'mark-completed',
    ]);
  });

  it('returns persisted row counts after success', async () => {
    /*
     * Use a value that differs from graph.edges.length.
     *
     * This proves persistCompletedAnalysis() reports the
     * actual row count returned by persistGraphEdges(),
     * rather than the raw graph edge count.
     */
    vi.mocked(persistGraphEdges).mockResolvedValue(7);

    vi.mocked(persistFunctionCallEdges).mockResolvedValue(3);

    const { database } = createFakeDatabase();

    const result = await persistCompletedAnalysis(database, createInput());

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,

      persistedFileCount: 2,

      persistedSymbolCount: 0,

      persistedEdgeCount: 10,

      persistedFindingCount: 1,

      persistedOnboardingStepCount: 2,

      alreadyCompleted: false,
    });
  });

  it('passes the same path-to-file-ID map to later persistence stages', async () => {
    const { database } = createFakeDatabase();

    const input = createInput();

    await persistCompletedAnalysis(database, input);

    const fileMap = vi.mocked(persistFilesAndMetrics).mock.results[0]?.value;

    const symbolMap = vi.mocked(persistAnalysisSymbols).mock.results[0]?.value;

    expect(fileMap).toBeDefined();

    expect(symbolMap).toBeDefined();

    const symbolCall = vi.mocked(persistAnalysisSymbols).mock.calls[0];

    const edgeCall = vi.mocked(persistGraphEdges).mock.calls[0];

    const callEdgeCall = vi.mocked(persistFunctionCallEdges).mock.calls[0];

    const findingCall = vi.mocked(persistAnalysisFindings).mock.calls[0];

    const resultCall = vi.mocked(persistAnalysisResult).mock.calls[0];

    const resolvedMap = await fileMap;

    const resolvedSymbolMap = await symbolMap;

    expect(symbolCall?.[2]).toBe(resolvedMap);

    expect(edgeCall?.[3]).toBe(resolvedMap);

    expect(callEdgeCall?.[2]).toEqual([]);

    expect(callEdgeCall?.[3]).toBe(resolvedMap);

    expect(callEdgeCall?.[4]).toBe(resolvedSymbolMap);

    expect(findingCall?.[3]).toBe(resolvedMap);

    expect(resultCall?.[6]).toBe(resolvedMap);
  });

  it('marks the analysis completed only after all persistence stages succeed', async () => {
    const { database, updateSpy, getUpdateValues } = createFakeDatabase();

    const input = createInput();

    await persistCompletedAnalysis(database, input);

    expect(updateSpy).toHaveBeenCalledTimes(1);

    expect(getUpdateValues()).toEqual(
      expect.objectContaining({
        status: 'completed',

        fileCount: 2,

        errorCode: null,

        errorMessage: null,

        completedAt: expect.any(Date),
      }),
    );
  });

  it('rejects a missing analysis before persistence starts', async () => {
    const { database, updateSpy } = createFakeDatabase({
      analysisExists: false,
    });

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      `Analysis "${ANALYSIS_ID}" does not exist`,
    );

    expect(persistFilesAndMetrics).not.toHaveBeenCalled();

    expect(persistAnalysisSymbols).not.toHaveBeenCalled();

    expect(persistGraphEdges).not.toHaveBeenCalled();

    expect(persistFunctionCallEdges).not.toHaveBeenCalled();

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('treats an already-completed analysis as an idempotent success', async () => {
    const { database, updateSpy } = createFakeDatabase({
      status: 'completed',
    });

    const result = await persistCompletedAnalysis(database, createInput());

    expect(result).toEqual({
      analysisId: ANALYSIS_ID,

      persistedFileCount: 0,

      persistedSymbolCount: 0,

      persistedEdgeCount: 0,

      persistedFindingCount: 0,

      persistedOnboardingStepCount: 0,

      alreadyCompleted: true,
    });

    expect(persistFilesAndMetrics).not.toHaveBeenCalled();

    expect(persistAnalysisSymbols).not.toHaveBeenCalled();

    expect(persistGraphEdges).not.toHaveBeenCalled();

    expect(persistFunctionCallEdges).not.toHaveBeenCalled();

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not mark the analysis completed when file persistence fails', async () => {
    vi.mocked(persistFilesAndMetrics).mockRejectedValue(new Error('file persistence failed'));

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'file persistence failed',
    );

    expect(persistAnalysisSymbols).not.toHaveBeenCalled();

    expect(persistGraphEdges).not.toHaveBeenCalled();

    expect(persistFunctionCallEdges).not.toHaveBeenCalled();

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not continue after symbol persistence fails', async () => {
    vi.mocked(persistAnalysisSymbols).mockRejectedValue(new Error('symbol persistence failed'));

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'symbol persistence failed',
    );

    expect(persistGraphEdges).not.toHaveBeenCalled();

    expect(persistFunctionCallEdges).not.toHaveBeenCalled();

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not continue after edge persistence fails', async () => {
    vi.mocked(persistGraphEdges).mockRejectedValue(new Error('edge persistence failed'));

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'edge persistence failed',
    );

    expect(persistFunctionCallEdges).not.toHaveBeenCalled();

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not continue after function call edge persistence fails', async () => {
    vi.mocked(persistFunctionCallEdges).mockRejectedValue(
      new Error('function call edge persistence failed'),
    );

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'function call edge persistence failed',
    );

    expect(persistAnalysisFindings).not.toHaveBeenCalled();

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not continue after finding persistence fails', async () => {
    vi.mocked(persistAnalysisFindings).mockRejectedValue(new Error('finding persistence failed'));

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'finding persistence failed',
    );

    expect(persistAnalysisResult).not.toHaveBeenCalled();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not mark the analysis completed when result persistence fails', async () => {
    vi.mocked(persistAnalysisResult).mockRejectedValue(new Error('result persistence failed'));

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'result persistence failed',
    );

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not mark the analysis completed when good-first-task persistence fails', async () => {
    vi.mocked(persistGoodFirstTaskRecommendations).mockRejectedValue(
      new Error('good-first-task persistence failed'),
    );

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'good-first-task persistence failed',
    );

    expect(persistAnalysisResult).toHaveBeenCalledTimes(1);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('does not mark the analysis completed when newcomer change guidance persistence fails', async () => {
    vi.mocked(persistNewcomerChangeGuidanceRecommendations).mockRejectedValue(
      new Error('newcomer change guidance persistence failed'),
    );

    const { database, updateSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'newcomer change guidance persistence failed',
    );

    expect(persistGoodFirstTaskRecommendations).toHaveBeenCalledTimes(1);

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects when PostgreSQL does not update exactly one analysis row', async () => {
    const { database } = createFakeDatabase({
      updatedRows: [],
    });

    await expect(persistCompletedAnalysis(database, createInput())).rejects.toThrow(
      'Expected to mark one analysis completed but PostgreSQL updated 0',
    );
  });

  it('rejects an empty analysis ID before opening a transaction', async () => {
    const input = createInput();

    input.analysisId = '   ';

    const { database, transactionSpy } = createFakeDatabase();

    await expect(persistCompletedAnalysis(database, input)).rejects.toThrow(
      'analysisId cannot be empty',
    );

    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it('uses one database transaction for the entire persistence operation', async () => {
    const { database, transactionSpy } = createFakeDatabase();

    await persistCompletedAnalysis(database, createInput());

    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });
});
