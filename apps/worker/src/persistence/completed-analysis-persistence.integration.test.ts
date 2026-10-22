import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyses,
  analysisFindings,
  analysisResults,
  createDatabase,
  edges,
  eq,
  files,
  metrics,
  onboardingSteps,
  repositories,
  symbols,
} from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import { AnalysisStore } from './analysis-store.js';
import { persistCompletedAnalysis } from './completed-analysis-persistence.js';

import type { PersistCompletedAnalysisInput } from './types.js';

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

const describeDatabase = runDatabaseIntegrationTests ? describe : describe.skip;

let databaseClient: ReturnType<typeof createDatabase> | undefined;

function requireDatabase(): Database {
  if (databaseClient === undefined) {
    throw new Error('Integration-test database has not been initialized.');
  }

  return databaseClient.db;
}

function createCommitSha(value: string): string {
  /*
   * This is not intended to be a real Git SHA.
   *
   * The schema accepts up to 64 characters, and
   * this gives every test repository a unique,
   * deterministic-looking revision identifier.
   */
  return value.replaceAll('-', '').padEnd(64, '0').slice(0, 64);
}

async function createRunningAnalysis(): Promise<{
  repositoryId: string;

  analysisId: string;

  sourceKey: string;

  revision: string;
}> {
  const db = requireDatabase();

  const uniqueId = crypto.randomUUID();

  const sourceKey = `zip:b12-integration:${uniqueId}`;

  const revision = createCommitSha(uniqueId);

  const repositoryRows = await db
    .insert(repositories)
    .values({
      sourceType: 'zip',

      sourceKey,
    })
    .returning({
      id: repositories.id,
    });

  const repositoryRow = repositoryRows[0];

  if (repositoryRow === undefined) {
    throw new Error('Failed to create integration-test repository.');
  }

  const analysisRows = await db
    .insert(analyses)
    .values({
      repositoryId: repositoryRow.id,

      commitSha: revision,

      status: 'running',
    })
    .returning({
      id: analyses.id,
    });

  const analysisRow = analysisRows[0];

  if (analysisRow === undefined) {
    throw new Error('Failed to create integration-test analysis.');
  }

  return {
    repositoryId: repositoryRow.id,

    analysisId: analysisRow.id,

    sourceKey,

    revision,
  };
}

async function deleteTestRepository(repositoryId: string): Promise<void> {
  const db = requireDatabase();

  /*
   * repositories → analyses → all analysis data
   * use cascading foreign keys, so deleting the
   * repository cleans up the entire fixture.
   */
  await db.delete(repositories).where(eq(repositories.id, repositoryId));
}

function createInput(analysisId: string): PersistCompletedAnalysisInput {
  return {
    analysisId,

    files: [
      {
        filePath: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 120,

        contentHash: 'a'.repeat(64),

        isSupported: true,

        parseStatus: 'analyzed',
      },

      {
        filePath: 'src/service.ts',

        language: 'typescript',

        sizeBytes: 80,

        contentHash: 'b'.repeat(64),

        isSupported: true,

        parseStatus: 'analyzed',
      },
    ],

    symbols: [
      {
        filePath: 'src/server.ts',

        kind: 'function',

        name: 'startServer',

        qualifiedName: 'startServer',

        startLine: 1,

        startColumn: 0,

        endLine: 10,

        endColumn: 1,

        isExported: true,

        complexity: 2,
      },

      {
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
    ],

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
            id: 'edge:server-service',

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

        totalCyclomaticComplexity: 5,

        averageCyclomaticComplexity: 2.5,

        maxCyclomaticComplexity: 3,

        historyAvailable: true,

        totalChangedCommitCount: 7,

        averageChangedCommitCount: 3.5,

        maxChangedCommitCount: 5,
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

            cyclomaticComplexity: 2,

            hasSyntaxErrors: false,
          },

          churn: {
            changedCommitCount: 2,
          },
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

            functionCount: 2,

            classCount: 0,

            cyclomaticComplexity: 3,

            hasSyntaxErrors: false,
          },

          churn: {
            changedCommitCount: 5,
          },
        },
      ],
    },

    findings: [
      {
        id: 'finding:integration-high-fan-in',

        kind: 'high-fan-in',

        severity: 'medium',

        title: 'Shared dependency',

        description: 'The service file is imported by another analyzed file.',

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

      consideredFileCount: 2,

      maxSteps: 10,
    },
  };
}

async function readAnalysisRows(analysisId: string) {
  const db = requireDatabase();

  return db
    .select({
      id: analyses.id,

      status: analyses.status,

      fileCount: analyses.fileCount,

      completedAt: analyses.completedAt,
    })
    .from(analyses)
    .where(eq(analyses.id, analysisId));
}

async function readPersistedCounts(analysisId: string): Promise<{
  files: number;

  metrics: number;

  symbols: number;

  edges: number;

  findings: number;

  results: number;

  onboarding: number;
}> {
  const db = requireDatabase();

  const fileRows = await db
    .select({
      id: files.id,
    })
    .from(files)
    .where(eq(files.analysisId, analysisId));

  /*
   * Metrics are keyed by file ID rather than
   * analysis ID, so count metric rows belonging
   * to the files from this analysis.
   */
  const metricRows = await db
    .select({
      id: metrics.fileId,
    })
    .from(metrics)
    .innerJoin(files, eq(metrics.fileId, files.id))
    .where(eq(files.analysisId, analysisId));

  const symbolRows = await db
    .select({
      id: symbols.id,
    })
    .from(symbols)
    .innerJoin(files, eq(symbols.fileId, files.id))
    .where(eq(files.analysisId, analysisId));

  const edgeRows = await db
    .select({
      id: edges.id,
    })
    .from(edges)
    .where(eq(edges.analysisId, analysisId));

  const findingRows = await db
    .select({
      id: analysisFindings.id,
    })
    .from(analysisFindings)
    .where(eq(analysisFindings.analysisId, analysisId));

  const resultRows = await db
    .select({
      analysisId: analysisResults.analysisId,
    })
    .from(analysisResults)
    .where(eq(analysisResults.analysisId, analysisId));

  const onboardingRows = await db
    .select({
      stepOrder: onboardingSteps.stepOrder,
    })
    .from(onboardingSteps)
    .where(eq(onboardingSteps.analysisId, analysisId));

  return {
    files: fileRows.length,

    metrics: metricRows.length,

    symbols: symbolRows.length,

    edges: edgeRows.length,

    findings: findingRows.length,

    results: resultRows.length,

    onboarding: onboardingRows.length,
  };
}

describeDatabase('persistCompletedAnalysis PostgreSQL integration', () => {
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;

    if (connectionString === undefined || connectionString.trim().length === 0) {
      throw new Error('DATABASE_URL must be set when RUN_DB_INTEGRATION_TESTS=true.');
    }

    databaseClient = createDatabase(connectionString, {
      maxConnections: 2,

      connectionTimeoutMs: 5_000,
    });

    await databaseClient.ping();
  });

  afterAll(async () => {
    if (databaseClient !== undefined) {
      await databaseClient.close();

      databaseClient = undefined;
    }
  });

  it('commits and reconstructs the complete persisted analysis', async () => {
    const { repositoryId, analysisId, sourceKey, revision } = await createRunningAnalysis();

    try {
      const result = await persistCompletedAnalysis(requireDatabase(), createInput(analysisId));

      expect(result).toEqual({
        analysisId,

        persistedFileCount: 2,

        persistedSymbolCount: 2,

        persistedEdgeCount: 1,

        persistedFindingCount: 1,

        persistedOnboardingStepCount: 2,

        alreadyCompleted: false,
      });

      const analysisRows = await readAnalysisRows(analysisId);

      expect(analysisRows).toHaveLength(1);

      expect(analysisRows[0]).toEqual(
        expect.objectContaining({
          status: 'completed',

          fileCount: 2,

          completedAt: expect.any(Date),
        }),
      );

      await expect(readPersistedCounts(analysisId)).resolves.toEqual({
        files: 2,

        metrics: 2,

        symbols: 2,

        edges: 1,

        findings: 1,

        results: 1,

        onboarding: 2,
      });

      /*
       * Prove the read model can reconstruct what
       * the write model persisted.
       */
      const store = new AnalysisStore(requireDatabase());

      const storedById = await store.getCompletedById(analysisId);

      expect(storedById).not.toBeNull();

      expect(storedById?.analysis.id).toBe(analysisId);

      expect(storedById?.files.map((file) => file.path)).toEqual([
        'src/server.ts',
        'src/service.ts',
      ]);

      expect(
        storedById?.symbols.map((symbol) => ({
          filePath: symbol.filePath,
          kind: symbol.kind,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          complexity: symbol.complexity,
        })),
      ).toEqual([
        {
          filePath: 'src/server.ts',
          kind: 'function',
          name: 'startServer',
          qualifiedName: 'startServer',
          complexity: 2,
        },
        {
          filePath: 'src/service.ts',
          kind: 'class',
          name: 'Service',
          qualifiedName: 'Service',
          complexity: 3,
        },
      ]);

      expect(storedById?.edges).toHaveLength(1);

      expect(storedById?.findings).toHaveLength(1);

      expect(storedById?.onboarding.steps).toHaveLength(2);

      /*
       * Prove the completed-analysis cache lookup
       * finds the same persisted analysis by its
       * repository source identity + exact revision.
       */
      const storedBySourceRevision = await store.getCompletedBySourceRevision(sourceKey, revision);

      expect(storedBySourceRevision?.analysis.id).toBe(analysisId);

      expect(storedBySourceRevision?.symbols).toHaveLength(2);
    } finally {
      await deleteTestRepository(repositoryId);
    }
  });

  it('rolls back files, metrics, symbols, edges and findings when a late persistence stage fails', async () => {
    const { repositoryId, analysisId } = await createRunningAnalysis();

    try {
      const input = createInput(analysisId);

      /*
       * This failure occurs in B11 validation.
       *
       * By the time persistAnalysisResult() is
       * called, the transaction has already
       * inserted:
       *
       * files
       * metrics
       * symbols
       * edges
       * findings
       * finding-file links
       *
       * Therefore this is a genuine test of
       * PostgreSQL rollback, not merely early
       * input validation.
       */
      input.onboarding = {
        ...input.onboarding,

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

            filePath: 'src/does-not-exist.ts',

            score: 35,

            signals: [
              {
                kind: 'dependency-of-previous',

                weight: 15,

                description: 'Simulated invalid onboarding dependency.',
              },
            ],
          },
        ],
      };

      await expect(persistCompletedAnalysis(requireDatabase(), input)).rejects.toThrow(
        'Onboarding step references unknown persisted file "src/does-not-exist.ts"',
      );

      /*
       * The analysis fixture itself was created
       * BEFORE persistCompletedAnalysis(), so it
       * must remain.
       *
       * But its completed state must not leak out.
       */
      const analysisRows = await readAnalysisRows(analysisId);

      expect(analysisRows).toEqual([
        {
          id: analysisId,

          status: 'running',

          fileCount: 0,

          completedAt: null,
        },
      ]);

      /*
       * These rows were inserted earlier inside
       * the failed transaction. PostgreSQL must
       * have removed every one of them.
       */
      await expect(readPersistedCounts(analysisId)).resolves.toEqual({
        files: 0,

        metrics: 0,

        symbols: 0,

        edges: 0,

        findings: 0,

        results: 0,

        onboarding: 0,
      });
    } finally {
      await deleteTestRepository(repositoryId);
    }
  });
});
