import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobData,
  type AnalysisJobResult,
} from '@astral-atlas/shared';

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAnalysisWorker, type AnalysisWorker } from './analysis-worker.js';

import { processAnalysisJob } from './analysis-processor.js';

import { createWorkerRedisClient } from './redis.js';

type TestAnalysisQueue = Queue<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

const TEST_REDIS_CONFIG = {
  host: '127.0.0.1',
  port: 6379,
  database: 15,
  useTls: false,
} as const;

async function closeRedis(redis: Redis | undefined): Promise<void> {
  if (!redis) {
    return;
  }

  if (redis.status === 'ready') {
    await redis.quit().catch(() => {
      redis.disconnect();
    });

    return;
  }

  redis.disconnect();
}

describe('Analysis worker integration', () => {
  let producerRedis: Redis | undefined;

  let workerRedis: Redis | undefined;

  let queue: TestAnalysisQueue | undefined;

  let worker: AnalysisWorker | undefined;

  beforeAll(async () => {
    /*
     * Redis DB 15 is reserved for integration
     * tests so development queue data in DB 0
     * remains untouched.
     */
    producerRedis = createWorkerRedisClient(TEST_REDIS_CONFIG);

    workerRedis = createWorkerRedisClient(TEST_REDIS_CONFIG);

    /*
     * Confirm both real Redis connections work.
     */
    const [producerPong, workerPong] = await Promise.all([
      producerRedis.ping(),
      workerRedis.ping(),
    ]);

    expect(producerPong).toBe('PONG');

    expect(workerPong).toBe('PONG');

    queue = new Queue<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>(
      ANALYSIS_QUEUE_NAME,
      {
        connection: producerRedis,
      },
    );

    await queue.waitUntilReady();

    /*
     * Start with a completely clean queue.
     */
    await queue.obliterate({
      force: true,
    });

    worker = createAnalysisWorker(workerRedis, processAnalysisJob);

    /*
     * analysis-worker.ts uses autorun:false,
     * so this explicitly begins consumption.
     *
     * run() remains active until worker.close(),
     * therefore we intentionally do not await it.
     */
    void worker.run();
  });

  afterAll(async () => {
    /*
     * Stop the consumer before destroying
     * queue data or Redis connections.
     */
    if (worker) {
      await worker.close().catch(() => undefined);
    }

    if (queue) {
      await queue
        .obliterate({
          force: true,
        })
        .catch(() => undefined);

      await queue.close().catch(() => undefined);
    }

    await closeRedis(workerRedis);

    await closeRedis(producerRedis);
  });

  it('moves an analysis job from Redis through the worker processor', async () => {
    if (!queue || !worker) {
      throw new Error('Integration test infrastructure was not initialized.');
    }

    /*
     * Capture the narrowed values into local constants.
     *
     * queue and worker are outer mutable variables, so
     * TypeScript cannot safely assume they remain defined
     * inside nested callbacks.
     */
    const activeQueue = queue;

    const activeWorker = worker;

    const analysisId = randomUUID();

    const repositoryId = randomUUID();

    const jobId = `worker-integration-${randomUUID()}`;

    const jobData: AnalysisJobData = {
      schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

      analysisId,

      repositoryId,

      source: {
        sourceType: 'github',

        owner: 'facebook',

        repo: 'react',

        canonicalUrl: 'https://github.com/facebook/react',

        sourceKey: 'github:facebook/react',

        commitSha: 'a'.repeat(40),
      },
    };

    /*
     * Register completion/failure listeners
     * BEFORE adding the job.
     *
     * Otherwise a very fast worker could finish
     * the job before this test starts listening.
     */
    const completedResult = new Promise<AnalysisJobResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();

        reject(new Error('Timed out waiting for analysis job completion.'));
      }, 10_000);

      const cleanup = () => {
        clearTimeout(timeout);

        activeWorker.off('completed', handleCompleted);

        activeWorker.off('failed', handleFailed);
      };

      const handleCompleted = (
        completedJob: {
          id?: string;
        },
        result: AnalysisJobResult,
      ) => {
        if (completedJob.id !== jobId) {
          return;
        }

        cleanup();

        resolve(result);
      };

      const handleFailed = (
        failedJob:
          | {
              id?: string;
            }
          | undefined,
        error: Error,
      ) => {
        if (failedJob?.id !== jobId) {
          return;
        }

        cleanup();

        reject(error);
      };

      activeWorker.on('completed', handleCompleted);

      activeWorker.on('failed', handleFailed);
    });

    /*
     * Producer side:
     *
     * Queue.add()
     *     ↓
     * Redis DB 15
     */
    const queuedJob = await activeQueue.add(ANALYSIS_JOB_NAME, jobData, {
      jobId,
    });

    expect(queuedJob.id).toBe(jobId);

    /*
     * Consumer side:
     *
     * Redis
     *   ↓
     * BullMQ Worker
     *   ↓
     * processAnalysisJob()
     */
    const result = await completedResult;

    expect(result).toEqual({
      analysisId,

      status: 'partial',
    });

    /*
     * Read the same job back from Redis.
     */
    const storedJob = await activeQueue.getJob(jobId);

    expect(storedJob).not.toBeNull();

    expect(await storedJob?.getState()).toBe('completed');

    /*
     * The processor called updateProgress()
     * before completing.
     */
    expect(storedJob?.progress).toEqual(
      expect.objectContaining({
        analysisId,

        stage: 'ingesting',

        percent: 5,

        message: 'Worker accepted the analysis job.',

        timestamp: expect.any(String),
      }),
    );

    expect(storedJob?.returnvalue).toEqual({
      analysisId,

      status: 'partial',
    });
  });
});
