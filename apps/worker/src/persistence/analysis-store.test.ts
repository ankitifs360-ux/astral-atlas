import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { AnalysisStore } from './analysis-store.js';

import { persistCompletedAnalysis } from './completed-analysis-persistence.js';

import type { PersistCompletedAnalysisInput } from './types.js';

vi.mock('./completed-analysis-persistence.js', () => ({
  persistCompletedAnalysis: vi.fn(),
}));

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

const REPOSITORY_ID = '22222222-2222-2222-2222-222222222222';

const SERVER_FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const SERVICE_FILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const SERVER_SYMBOL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const SERVICE_SYMBOL_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

interface FakeDatabaseResult {
  database: Database;

  selectSpy: ReturnType<typeof vi.fn>;
}

function createSelectBuilder(response: readonly unknown[]) {
  const builder: {
    from: ReturnType<typeof vi.fn>;

    leftJoin: ReturnType<typeof vi.fn>;

    innerJoin: ReturnType<typeof vi.fn>;

    where: ReturnType<typeof vi.fn>;

    limit: ReturnType<typeof vi.fn>;

    then: Promise<readonly unknown[]>['then'];
  } = {
    from: vi.fn(() => builder),

    leftJoin: vi.fn(() => builder),

    innerJoin: vi.fn(() => builder),

    where: vi.fn(() => builder),

    limit: vi.fn(() => builder),

    then: (onFulfilled, onRejected) => Promise.resolve(response).then(onFulfilled, onRejected),
  };

  return builder;
}

function createFakeDatabase(selectResponses: readonly (readonly unknown[])[]): FakeDatabaseResult {
  let selectIndex = 0;

  const selectSpy = vi.fn(() => {
    const response = selectResponses[selectIndex];

    selectIndex += 1;

    if (response === undefined) {
      throw new Error(`Unexpected database select call ${selectIndex}`);
    }

    return createSelectBuilder(response);
  });

  const database = {
    select: selectSpy,
  } as unknown as Database;

  return {
    database,
    selectSpy,
  };
}

function createCompletedAnalysisRow() {
  return {
    id: ANALYSIS_ID,

    repositoryId: REPOSITORY_ID,

    commitSha: 'a'.repeat(40),

    status: 'completed' as const,

    warningCount: 1,

    fileCount: 2,

    createdAt: new Date('2026-10-22T10:00:00.000Z'),

    startedAt: new Date('2026-10-22T10:01:00.000Z'),

    completedAt: new Date('2026-10-22T10:02:00.000Z'),
  };
}

function createRepositorySummary() {
  return {
    fileCount: 2,

    internalDependencyCount: 1,

    externalImportCount: 0,

    unresolvedImportCount: 0,

    cyclicComponentCount: 0,

    cyclicFileCount: 0,

    totalCyclomaticComplexity: 5,

    averageCyclomaticComplexity: 2.5,

    maxCyclomaticComplexity: 3,

    historyAvailable: true,

    totalChangedCommitCount: 7,

    averageChangedCommitCount: 3.5,

    maxChangedCommitCount: 5,
  };
}

function createHealthDimensions() {
  return [
    {
      dimension: 'maintainability' as const,

      maxScore: 25,

      score: 22,

      deductedPoints: 3,

      deductions: [],
    },

    {
      dimension: 'change-risk' as const,

      maxScore: 20,

      score: 18,

      deductedPoints: 2,

      deductions: [],
    },

    {
      dimension: 'dependency-health' as const,

      maxScore: 25,

      score: 23,

      deductedPoints: 2,

      deductions: [],
    },

    {
      dimension: 'coupling' as const,

      maxScore: 20,

      score: 17,

      deductedPoints: 3,

      deductions: [],
    },

    {
      dimension: 'resolution-quality' as const,

      maxScore: 10,

      score: 8,

      deductedPoints: 2,

      deductions: [],
    },
  ];
}

describe('AnalysisStore', () => {
  beforeEach(() => {
    vi.mocked(persistCompletedAnalysis).mockReset();
  });

  describe('put', () => {
    it('delegates completed analysis persistence to the atomic writer', async () => {
      const { database } = createFakeDatabase([]);

      const store = new AnalysisStore(database);

      const input = {
        analysisId: ANALYSIS_ID,
      } as PersistCompletedAnalysisInput;

      vi.mocked(persistCompletedAnalysis).mockResolvedValue({
        analysisId: ANALYSIS_ID,

        persistedFileCount: 2,

        persistedSymbolCount: 0,

        persistedEdgeCount: 1,

        persistedFindingCount: 1,

        persistedOnboardingStepCount: 2,

        alreadyCompleted: false,
      });

      const result = await store.put(input);

      expect(persistCompletedAnalysis).toHaveBeenCalledTimes(1);

      expect(persistCompletedAnalysis).toHaveBeenCalledWith(database, input);

      expect(result).toEqual({
        analysisId: ANALYSIS_ID,

        persistedFileCount: 2,

        persistedSymbolCount: 0,

        persistedEdgeCount: 1,

        persistedFindingCount: 1,

        persistedOnboardingStepCount: 2,

        alreadyCompleted: false,
      });
    });
  });

  describe('getCompletedById', () => {
    it('returns null when the analysis does not exist', async () => {
      const { database, selectSpy } = createFakeDatabase([[]]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).resolves.toBeNull();

      expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null when the analysis is still running', async () => {
      const runningRow = {
        ...createCompletedAnalysisRow(),

        status: 'running' as const,

        completedAt: null,
      };

      const { database, selectSpy } = createFakeDatabase([[runningRow]]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).resolves.toBeNull();

      /*
       * A running analysis must stop here.
       *
       * We should not read result tables for
       * something that is not yet complete.
       */
      expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null when the analysis failed', async () => {
      const failedRow = {
        ...createCompletedAnalysisRow(),

        status: 'failed' as const,

        completedAt: null,
      };

      const { database } = createFakeDatabase([[failedRow]]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).resolves.toBeNull();
    });

    it('rejects a completed analysis without a completedAt timestamp', async () => {
      const invalidRow = {
        ...createCompletedAnalysisRow(),

        completedAt: null,
      };

      const { database, selectSpy } = createFakeDatabase([[invalidRow]]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).rejects.toThrow(
        `Completed analysis "${ANALYSIS_ID}" has no completedAt timestamp`,
      );

      expect(selectSpy).toHaveBeenCalledTimes(1);
    });

    it('rejects a completed analysis whose repository result is missing', async () => {
      const { database, selectSpy } = createFakeDatabase([[createCompletedAnalysisRow()], []]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).rejects.toThrow(
        `Completed analysis "${ANALYSIS_ID}" is missing its analysis result`,
      );

      expect(selectSpy).toHaveBeenCalledTimes(2);
    });

    it('reconstructs a complete persisted analysis', async () => {
      const analysisRow = createCompletedAnalysisRow();

      const repositorySummary = createRepositorySummary();

      const healthDimensions = createHealthDimensions();

      const resultRow = {
        repositorySummary,

        healthScore: 88,

        healthRating: 'good' as const,

        healthDimensions,

        onboardingConsideredFileCount: 2,

        onboardingMaxSteps: 10,
      };

      /*
       * Intentionally return service.ts first.
       *
       * The store should normalize file ordering
       * lexically by path.
       */
      const fileRows = [
        {
          id: SERVICE_FILE_ID,

          path: 'src/service.ts',

          language: 'typescript',

          sizeBytes: 80,

          contentHash: 'b'.repeat(64),

          sourceContent: 'export class Service {}\n',

          isSupported: true,

          parseStatus: 'analyzed' as const,

          metricFileId: SERVICE_FILE_ID,

          loc: null,

          tokenCount: null,

          cyclomaticComplexity: 3,

          churnAdditions: null,

          churnDeletions: null,

          churnCommits: 5,

          importCount: 0,

          functionCount: 2,

          classCount: 0,

          hasSyntaxErrors: false,

          fanIn: 1,

          fanOut: 0,

          transitiveDependencyCount: 0,

          blastRadius: 1,

          blastMaxDistance: 1,

          inDependencyCycle: false,

          cyclicComponentSize: 0,

          riskScore: null,
        },

        {
          id: SERVER_FILE_ID,

          path: 'src/server.ts',

          language: 'typescript',

          sizeBytes: 120,

          contentHash: 'a'.repeat(64),

          sourceContent:
            "import { Service } from './service.js';\nexport function startServer() {}\n",

          isSupported: true,

          parseStatus: 'analyzed' as const,

          metricFileId: SERVER_FILE_ID,

          loc: null,

          tokenCount: null,

          cyclomaticComplexity: 2,

          churnAdditions: null,

          churnDeletions: null,

          churnCommits: 2,

          importCount: 1,

          functionCount: 1,

          classCount: 0,

          hasSyntaxErrors: false,

          fanIn: 0,

          fanOut: 1,

          transitiveDependencyCount: 1,

          blastRadius: 0,

          blastMaxDistance: 0,

          inDependencyCycle: false,

          cyclicComponentSize: 0,

          riskScore: null,
        },
      ];

      /*
       * Intentionally return service.ts first.
       *
       * Symbols should be sorted deterministically
       * by file path and then source location.
       */
      const symbolRows = [
        {
          id: SERVICE_SYMBOL_ID,

          fileId: SERVICE_FILE_ID,

          kind: 'class' as const,

          name: 'Service',

          qualifiedName: 'Service',

          startLine: 1,

          startColumn: 0,

          endLine: 20,

          endColumn: 1,

          isExported: true,

          complexity: 3,
        },

        {
          id: SERVER_SYMBOL_ID,

          fileId: SERVER_FILE_ID,

          kind: 'function' as const,

          name: 'startServer',

          qualifiedName: 'startServer',

          startLine: 5,

          startColumn: 0,

          endLine: 12,

          endColumn: 1,

          isExported: true,

          complexity: 2,
        },
      ];

      const edgeRows = [
        {
          id: '33333333-3333-3333-3333-333333333333',

          fromFileId: SERVER_FILE_ID,

          toFileId: SERVICE_FILE_ID,

          fromSymbolId: null,

          toSymbolId: null,

          type: 'import' as const,

          weight: 2,

          isDynamic: false,
        },
      ];

      const findingRows = [
        {
          id: '44444444-4444-4444-4444-444444444444',

          findingKey: 'finding:high-fan-in',

          kind: 'high-fan-in' as const,

          severity: 'medium' as const,

          title: 'High fan-in',

          description: 'The service is shared by other files.',

          evidence: [
            {
              metric: 'fanIn',

              value: 1,

              threshold: 1,
            },
          ],
        },
      ];

      const findingFileRows = [
        {
          findingId: '44444444-4444-4444-4444-444444444444',

          fileId: SERVICE_FILE_ID,
        },
      ];

      /*
       * Intentionally reversed to verify that
       * the store sorts onboarding by order.
       */
      const onboardingRows = [
        {
          order: 2,

          fileId: SERVICE_FILE_ID,

          score: 35,

          signals: [
            {
              kind: 'dependency-of-previous' as const,

              weight: 15,

              description: 'Direct dependency of the previous file.',
            },
          ],
        },

        {
          order: 1,

          fileId: SERVER_FILE_ID,

          score: 50,

          signals: [
            {
              kind: 'entry-point' as const,

              weight: 50,

              description: 'Likely repository entry point.',
            },
          ],
        },
      ];

      const { database, selectSpy } = createFakeDatabase([
        [analysisRow],

        [resultRow],

        fileRows,

        symbolRows,

        edgeRows,

        findingRows,

        findingFileRows,

        onboardingRows,
      ]);

      const store = new AnalysisStore(database);

      const stored = await store.getCompletedById(ANALYSIS_ID);

      expect(selectSpy).toHaveBeenCalledTimes(8);

      expect(stored).not.toBeNull();

      expect(stored?.analysis).toEqual({
        id: ANALYSIS_ID,

        repositoryId: REPOSITORY_ID,

        commitSha: 'a'.repeat(40),

        status: 'completed',

        warningCount: 1,

        fileCount: 2,

        createdAt: analysisRow.createdAt,

        startedAt: analysisRow.startedAt,

        completedAt: analysisRow.completedAt,
      });

      expect(stored?.repositorySummary).toEqual(repositorySummary);

      expect(stored?.healthScore).toEqual({
        score: 88,

        rating: 'good',

        dimensions: healthDimensions,

        analyzedFileCount: 2,
      });

      expect(stored?.files.map((file) => file.path)).toEqual(['src/server.ts', 'src/service.ts']);

      expect(stored?.files[0]).toEqual(
        expect.objectContaining({
          id: SERVER_FILE_ID,

          path: 'src/server.ts',

          sourceContent:
            "import { Service } from './service.js';\nexport function startServer() {}\n",

          metrics: expect.objectContaining({
            cyclomaticComplexity: 2,

            importCount: 1,

            functionCount: 1,

            fanIn: 0,

            fanOut: 1,

            transitiveDependencyCount: 1,

            blastRadius: 0,
          }),
        }),
      );

      expect(stored?.files[1]).toEqual(
        expect.objectContaining({
          id: SERVICE_FILE_ID,

          path: 'src/service.ts',

          sourceContent: 'export class Service {}\n',

          metrics: expect.objectContaining({
            cyclomaticComplexity: 3,

            churnCommits: 5,

            functionCount: 2,

            fanIn: 1,

            fanOut: 0,

            blastRadius: 1,

            blastMaxDistance: 1,
          }),
        }),
      );

      expect(stored?.symbols).toEqual([
        {
          id: SERVER_SYMBOL_ID,

          fileId: SERVER_FILE_ID,

          filePath: 'src/server.ts',

          kind: 'function',

          name: 'startServer',

          qualifiedName: 'startServer',

          startLine: 5,

          startColumn: 0,

          endLine: 12,

          endColumn: 1,

          isExported: true,

          complexity: 2,
        },

        {
          id: SERVICE_SYMBOL_ID,

          fileId: SERVICE_FILE_ID,

          filePath: 'src/service.ts',

          kind: 'class',

          name: 'Service',

          qualifiedName: 'Service',

          startLine: 1,

          startColumn: 0,

          endLine: 20,

          endColumn: 1,

          isExported: true,

          complexity: 3,
        },
      ]);

      expect(stored?.edges).toEqual([
        {
          id: '33333333-3333-3333-3333-333333333333',

          sourceFileId: SERVER_FILE_ID,

          sourcePath: 'src/server.ts',

          targetFileId: SERVICE_FILE_ID,

          targetPath: 'src/service.ts',

          fromSymbolId: null,

          toSymbolId: null,

          type: 'import',

          weight: 2,

          isDynamic: false,
        },
      ]);

      expect(stored?.findings).toEqual([
        {
          id: 'finding:high-fan-in',

          kind: 'high-fan-in',

          severity: 'medium',

          title: 'High fan-in',

          description: 'The service is shared by other files.',

          filePaths: ['src/service.ts'],

          evidence: [
            {
              metric: 'fanIn',

              value: 1,

              threshold: 1,
            },
          ],
        },
      ]);

      expect(stored?.onboarding).toEqual({
        consideredFileCount: 2,

        maxSteps: 10,

        steps: [
          {
            order: 1,

            filePath: 'src/server.ts',

            score: 50,

            signals: [
              {
                kind: 'entry-point',

                weight: 50,

                description: 'Likely repository entry point.',
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

                description: 'Direct dependency of the previous file.',
              },
            ],
          },
        ],
      });
    });

    it('supports files without a persisted metric row', async () => {
      const analysisRow = createCompletedAnalysisRow();

      const repositorySummary = createRepositorySummary();

      const { database } = createFakeDatabase([
        [
          {
            ...analysisRow,

            fileCount: 1,
          },
        ],

        [
          {
            repositorySummary: {
              ...repositorySummary,

              fileCount: 1,
            },

            healthScore: 100,

            healthRating: 'excellent',

            healthDimensions: createHealthDimensions(),

            onboardingConsideredFileCount: 1,

            onboardingMaxSteps: 10,
          },
        ],

        [
          {
            id: SERVER_FILE_ID,

            path: 'src/server.ts',

            language: 'typescript',

            sizeBytes: 120,

            contentHash: null,

            sourceContent: null,

            isSupported: true,

            parseStatus: 'partial',

            metricFileId: null,

            loc: null,

            tokenCount: null,

            cyclomaticComplexity: null,

            churnAdditions: null,

            churnDeletions: null,

            churnCommits: null,

            importCount: null,

            functionCount: null,

            classCount: null,

            hasSyntaxErrors: null,

            fanIn: null,

            fanOut: null,

            transitiveDependencyCount: null,

            blastRadius: null,

            blastMaxDistance: null,

            inDependencyCycle: null,

            cyclicComponentSize: null,

            riskScore: null,
          },
        ],

        [],

        [],

        [],

        [],

        [],
      ]);

      const store = new AnalysisStore(database);

      const stored = await store.getCompletedById(ANALYSIS_ID);

      expect(stored?.files).toEqual([
        expect.objectContaining({
          id: SERVER_FILE_ID,

          path: 'src/server.ts',

          sourceContent: null,

          metrics: null,
        }),
      ]);

      expect(stored?.symbols).toEqual([]);
    });

    it('rejects a symbol that references a file outside the stored analysis', async () => {
      const unknownFileId = '99999999-9999-9999-9999-999999999999';

      const { database } = createFakeDatabase([
        [createCompletedAnalysisRow()],

        [
          {
            repositorySummary: createRepositorySummary(),

            healthScore: 88,

            healthRating: 'good',

            healthDimensions: createHealthDimensions(),

            onboardingConsideredFileCount: 2,

            onboardingMaxSteps: 10,
          },
        ],

        [
          {
            id: SERVER_FILE_ID,

            path: 'src/server.ts',

            language: 'typescript',

            sizeBytes: 120,

            contentHash: null,

            sourceContent: null,

            isSupported: true,

            parseStatus: 'analyzed',

            metricFileId: null,

            loc: null,

            tokenCount: null,

            cyclomaticComplexity: null,

            churnAdditions: null,

            churnDeletions: null,

            churnCommits: null,

            importCount: null,

            functionCount: null,

            classCount: null,

            hasSyntaxErrors: null,

            fanIn: null,

            fanOut: null,

            transitiveDependencyCount: null,

            blastRadius: null,

            blastMaxDistance: null,

            inDependencyCycle: null,

            cyclicComponentSize: null,

            riskScore: null,
          },
        ],

        [
          {
            id: SERVER_SYMBOL_ID,

            fileId: unknownFileId,

            kind: 'function',

            name: 'orphanSymbol',

            qualifiedName: 'orphanSymbol',

            startLine: 1,

            startColumn: 0,

            endLine: 1,

            endColumn: 10,

            isExported: false,

            complexity: null,
          },
        ],
      ]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).rejects.toThrow(
        `Symbol references unknown persisted file "${unknownFileId}"`,
      );
    });

    it('rejects a graph edge that references a file outside the stored analysis', async () => {
      const unknownFileId = '99999999-9999-9999-9999-999999999999';

      const { database } = createFakeDatabase([
        [createCompletedAnalysisRow()],

        [
          {
            repositorySummary: createRepositorySummary(),

            healthScore: 88,

            healthRating: 'good',

            healthDimensions: createHealthDimensions(),

            onboardingConsideredFileCount: 2,

            onboardingMaxSteps: 10,
          },
        ],

        [
          {
            id: SERVER_FILE_ID,

            path: 'src/server.ts',

            language: 'typescript',

            sizeBytes: 120,

            contentHash: null,

            sourceContent: null,

            isSupported: true,

            parseStatus: 'analyzed',

            metricFileId: null,

            loc: null,

            tokenCount: null,

            cyclomaticComplexity: null,

            churnAdditions: null,

            churnDeletions: null,

            churnCommits: null,

            importCount: null,

            functionCount: null,

            classCount: null,

            hasSyntaxErrors: null,

            fanIn: null,

            fanOut: null,

            transitiveDependencyCount: null,

            blastRadius: null,

            blastMaxDistance: null,

            inDependencyCycle: null,

            cyclicComponentSize: null,

            riskScore: null,
          },
        ],

        [],

        [
          {
            id: '33333333-3333-3333-3333-333333333333',

            fromFileId: SERVER_FILE_ID,

            toFileId: unknownFileId,

            fromSymbolId: null,

            toSymbolId: null,

            type: 'import',

            weight: 1,

            isDynamic: false,
          },
        ],
      ]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById(ANALYSIS_ID)).rejects.toThrow(
        `Graph edge references unknown persisted file "${unknownFileId}"`,
      );
    });

    it('rejects an empty analysis ID before querying PostgreSQL', async () => {
      const { database, selectSpy } = createFakeDatabase([]);

      const store = new AnalysisStore(database);

      await expect(store.getCompletedById('   ')).rejects.toThrow('analysisId cannot be empty');

      expect(selectSpy).not.toHaveBeenCalled();
    });
  });
});
