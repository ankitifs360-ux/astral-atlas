import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  analyses,
  analysisResults,
  createDatabase,
  eq,
  files,
  newcomerChangeGuidanceRecommendations,
  repositories,
} from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import { AnalysisResultsStore } from './analysis-results-store.js';

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

const describeDatabase = runDatabaseIntegrationTests ? describe : describe.skip;

let databaseClient: ReturnType<typeof createDatabase> | undefined;

function requireDatabase(): Database {
  if (databaseClient === undefined) {
    throw new Error('Integration-test database has not been initialized.');
  }

  return databaseClient.db;
}

function createRevision(value: string): string {
  return value.replaceAll('-', '').padEnd(64, '0').slice(0, 64);
}

async function createRepository(): Promise<string> {
  const rows = await requireDatabase()
    .insert(repositories)
    .values({
      sourceType: 'zip',

      sourceKey: `zip:b15-7-guidance:${crypto.randomUUID()}`,
    })
    .returning({
      id: repositories.id,
    });

  const row = rows[0];

  if (row === undefined) {
    throw new Error('Failed to create newcomer-guidance integration-test repository.');
  }

  return row.id;
}

async function createAnalysis(
  repositoryId: string,
  status: 'running' | 'completed',
): Promise<string> {
  const rows = await requireDatabase()
    .insert(analyses)
    .values({
      repositoryId,

      commitSha: createRevision(crypto.randomUUID()),

      status,

      completedAt: status === 'completed' ? new Date() : null,

      fileCount: status === 'completed' ? 2 : 0,
    })
    .returning({
      id: analyses.id,
    });

  const row = rows[0];

  if (row === undefined) {
    throw new Error('Failed to create newcomer-guidance integration-test analysis.');
  }

  return row.id;
}

async function seedGuidance(analysisId: string): Promise<void> {
  const db = requireDatabase();

  const fileRows = await db
    .insert(files)
    .values([
      {
        analysisId,

        path: 'src/server.ts',

        language: 'typescript',

        sizeBytes: 120,

        contentHash: 'a'.repeat(64),

        isSupported: true,

        parseStatus: 'analyzed',
      },

      {
        analysisId,

        path: 'src/service.ts',

        language: 'typescript',

        sizeBytes: 180,

        contentHash: 'b'.repeat(64),

        isSupported: true,

        parseStatus: 'analyzed',
      },
    ])
    .returning({
      id: files.id,

      path: files.path,
    });

  const fileIdByPath = new Map(fileRows.map((row) => [row.path, row.id]));

  const serverFileId = fileIdByPath.get('src/server.ts');

  const serviceFileId = fileIdByPath.get('src/service.ts');

  if (serverFileId === undefined || serviceFileId === undefined) {
    throw new Error('Failed to seed newcomer-guidance integration-test files.');
  }

  await db.insert(analysisResults).values({
    analysisId,

    repositorySummary: {
      fileCount: 2,
    },

    healthScore: 100,

    healthRating: 'excellent',

    healthDimensions: [],

    onboardingConsideredFileCount: 2,

    onboardingMaxSteps: 10,

    newcomerChangeGuidanceConsideredFileCount: 2,

    newcomerChangeGuidanceMaxRecommendations: 5,
  });

  /*
   * Insert rank 2 before rank 1.
   *
   * The public API store must still return deterministic
   * recommendation-rank ordering.
   */
  await db.insert(newcomerChangeGuidanceRecommendations).values([
    {
      analysisId,

      recommendationRank: 2,

      fileId: serviceFileId,

      safetyScore: 65,

      riskLevel: 'medium',

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

    {
      analysisId,

      recommendationRank: 1,

      fileId: serverFileId,

      safetyScore: 100,

      riskLevel: 'low',

      blastRadius: 0,

      blastMaxDistance: 0,

      reviewFilePaths: [],

      signals: [],
    },
  ]);
}

async function deleteRepository(repositoryId: string): Promise<void> {
  await requireDatabase().delete(repositories).where(eq(repositories.id, repositoryId));
}

describeDatabase('AnalysisResultsStore newcomer change guidance PostgreSQL integration', () => {
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

  it('reconstructs persisted newcomer change guidance as the public API response', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'completed');

      await seedGuidance(analysisId);

      const store = new AnalysisResultsStore(requireDatabase());

      const guidance = await store.getNewcomerChangeGuidance(analysisId);

      expect(guidance).toEqual({
        analysisId,

        consideredFileCount: 2,

        maxRecommendations: 5,

        recommendations: [
          {
            filePath: 'src/server.ts',

            safetyScore: 100,

            riskLevel: 'low',

            blastRadius: 0,

            blastMaxDistance: 0,

            reviewFilePaths: [],

            signals: [],
          },

          {
            filePath: 'src/service.ts',

            safetyScore: 65,

            riskLevel: 'medium',

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
      });
    } finally {
      await deleteRepository(repositoryId);
    }
  });

  it('returns null for an analysis that is not completed', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'running');

      const store = new AnalysisResultsStore(requireDatabase());

      await expect(store.getNewcomerChangeGuidance(analysisId)).resolves.toBeNull();
    } finally {
      await deleteRepository(repositoryId);
    }
  });
});
