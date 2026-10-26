import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  analyses,
  analysisResults,
  createDatabase,
  eq,
  files,
  goodFirstTaskRecommendations,
  metrics,
  newcomerChangeGuidanceRecommendations,
  onboardingSteps,
  repositories,
  symbols,
  type Database,
} from '@astral-atlas/database';
import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
  type AnalysisProgress,
} from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAnalysisJobProcessor } from './analysis-processor.js';
import type { AnalysisJob } from './analysis-worker.js';
import { AnalysisStore } from './persistence/analysis-store.js';
import { createWorkerRedisClient } from './redis.js';

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

const describeIntegration = runDatabaseIntegrationTests ? describe : describe.skip;

const TEST_REDIS_CONFIG = {
  host: '127.0.0.1',
  port: 6379,
  database: 14,
  useTls: false,
} as const;

let databaseClient: ReturnType<typeof createDatabase> | undefined;

let redis: Redis | undefined;

function requireDatabase(): Database {
  if (databaseClient === undefined) {
    throw new Error('Integration-test database has not been initialized.');
  }

  return databaseClient.db;
}

function requireRedis(): Redis {
  if (redis === undefined) {
    throw new Error('Integration-test Redis client has not been initialized.');
  }

  return redis;
}

async function closeRedis(client: Redis | undefined): Promise<void> {
  if (client === undefined) {
    return;
  }

  if (client.status === 'ready') {
    await client.quit().catch(() => {
      client.disconnect();
    });

    return;
  }

  client.disconnect();
}

function createRevision(value: string): string {
  return value.replaceAll('-', '').padEnd(64, '0').slice(0, 64);
}

async function createRunningAnalysis(): Promise<{
  repositoryId: string;
  analysisId: string;
  sourceKey: string;
  revision: string;
}> {
  const db = requireDatabase();

  const uniqueId = randomUUID();

  const sourceKey = `zip:b15-8-e2e:${uniqueId}`;

  const revision = createRevision(uniqueId);

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
    throw new Error('Failed to create E2E repository fixture.');
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
    throw new Error('Failed to create E2E analysis fixture.');
  }

  return {
    repositoryId: repositoryRow.id,
    analysisId: analysisRow.id,
    sourceKey,
    revision,
  };
}

async function deleteTestRepository(repositoryId: string): Promise<void> {
  await requireDatabase().delete(repositories).where(eq(repositories.id, repositoryId));
}

async function createTestRepository(): Promise<{
  repositoryDirectory: string;
  cleanup: () => Promise<void>;
}> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-b15-8-'));

  const repositoryDirectory = join(temporaryDirectory, 'repository');

  const sourceDirectory = join(repositoryDirectory, 'src');

  await mkdir(sourceDirectory, {
    recursive: true,
  });

  await writeFile(
    join(sourceDirectory, 'math.ts'),
    [
      'export function add(left: number, right: number): number {',
      '  return left + right;',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(sourceDirectory, 'index.ts'),
    [
      "import { add } from './math.js';",
      '',
      'export function calculate(): number {',
      '  return add(20, 22);',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  return {
    repositoryDirectory,

    cleanup: async () => {
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    },
  };
}

describeIntegration('analysis processor end-to-end integration', () => {
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

    redis = createWorkerRedisClient(TEST_REDIS_CONFIG);

    await expect(redis.ping()).resolves.toBe('PONG');
  });

  afterAll(async () => {
    await closeRedis(redis);

    redis = undefined;

    if (databaseClient !== undefined) {
      await databaseClient.close();

      databaseClient = undefined;
    }
  });

  it('runs the real analysis pipeline and persists completed results', async () => {
    const fixture = await createRunningAnalysis();

    const localRepository = await createTestRepository();

    const progressUpdates: AnalysisProgress[] = [];

    let sourceCleanupCalled = false;

    try {
      const analysisStore = new AnalysisStore(requireDatabase());

      const jobData: AnalysisJobData = {
        schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

        analysisId: fixture.analysisId,

        repositoryId: fixture.repositoryId,

        source: {
          sourceType: 'zip',

          sourceKey: fixture.sourceKey,

          contentSha256: fixture.revision,

          archivePath: '/integration-test/staged.zip',
        },
      };

      const sourcePreparer = {
        prepare: async (source: AnalysisJobData['source']) => {
          if (source.sourceType !== 'zip') {
            throw new Error('E2E source preparer expected a ZIP analysis source.');
          }

          return {
            sourceType: 'zip' as const,

            sourceKey: source.sourceKey,

            revision: source.contentSha256,

            repositoryDirectory: localRepository.repositoryDirectory,

            cleanup: async () => {
              sourceCleanupCalled = true;

              await localRepository.cleanup();
            },
          };
        },
      };

      const processor = createAnalysisJobProcessor(requireRedis(), {
        sourcePreparer,

        analysisStore,
      });

      const job = {
        id: `b15-8-e2e-${randomUUID()}`,

        name: ANALYSIS_JOB_NAME,

        data: jobData,

        updateProgress: async (progress: AnalysisProgress) => {
          progressUpdates.push(progress);
        },
      } as unknown as AnalysisJob;

      const result = await processor(job);

      expect(result).toEqual({
        analysisId: fixture.analysisId,

        status: 'completed',
      });

      expect(sourceCleanupCalled).toBe(true);

      expect(progressUpdates).toContainEqual(
        expect.objectContaining({
          analysisId: fixture.analysisId,

          stage: 'ingesting',

          percent: 5,

          message: 'Worker accepted the analysis job.',
        }),
      );

      const analysisRows = await requireDatabase()
        .select({
          status: analyses.status,

          fileCount: analyses.fileCount,

          completedAt: analyses.completedAt,
        })
        .from(analyses)
        .where(eq(analyses.id, fixture.analysisId));

      expect(analysisRows).toEqual([
        expect.objectContaining({
          status: 'completed',

          fileCount: 2,

          completedAt: expect.any(Date),
        }),
      ]);

      const persistedFiles = await requireDatabase()
        .select({
          id: files.id,
        })
        .from(files)
        .where(eq(files.analysisId, fixture.analysisId));

      const persistedMetrics = await requireDatabase()
        .select({
          fileId: metrics.fileId,
        })
        .from(metrics)
        .innerJoin(files, eq(metrics.fileId, files.id))
        .where(eq(files.analysisId, fixture.analysisId));

      const persistedSymbols = await requireDatabase()
        .select({
          id: symbols.id,
        })
        .from(symbols)
        .innerJoin(files, eq(symbols.fileId, files.id))
        .where(eq(files.analysisId, fixture.analysisId));

      const persistedResults = await requireDatabase()
        .select({
          analysisId: analysisResults.analysisId,
        })
        .from(analysisResults)
        .where(eq(analysisResults.analysisId, fixture.analysisId));

      const persistedOnboarding = await requireDatabase()
        .select({
          analysisId: onboardingSteps.analysisId,
        })
        .from(onboardingSteps)
        .where(eq(onboardingSteps.analysisId, fixture.analysisId));

      const persistedGoodFirstTasks = await requireDatabase()
        .select({
          analysisId: goodFirstTaskRecommendations.analysisId,
        })
        .from(goodFirstTaskRecommendations)
        .where(eq(goodFirstTaskRecommendations.analysisId, fixture.analysisId));

      const persistedNewcomerGuidance = await requireDatabase()
        .select({
          analysisId: newcomerChangeGuidanceRecommendations.analysisId,
        })
        .from(newcomerChangeGuidanceRecommendations)
        .where(eq(newcomerChangeGuidanceRecommendations.analysisId, fixture.analysisId));

      expect(persistedFiles).toHaveLength(2);

      expect(persistedMetrics).toHaveLength(2);

      expect(persistedSymbols.length).toBeGreaterThanOrEqual(2);

      expect(persistedResults).toHaveLength(1);

      expect(persistedOnboarding.length).toBeGreaterThan(0);

      expect(persistedGoodFirstTasks.length).toBeGreaterThan(0);

      expect(persistedNewcomerGuidance.length).toBeGreaterThan(0);
    } finally {
      await localRepository.cleanup().catch(() => undefined);

      await deleteTestRepository(fixture.repositoryId);
    }
  }, 30_000);
});
