import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobData,
  type AnalysisJobResult,
} from '@astral-atlas/shared';

import { Queue, Worker } from 'bullmq';

import { Redis } from 'ioredis';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AnalysisEventHub,
  connectAnalysisQueueEvents,
  type AnalysisStreamEvent,
} from './analysis-event-hub.js';

import { createAnalysisQueueEvents, type AnalysisQueueEvents } from './analysis-events.js';

type TestQueue = Queue<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

type TestWorker = Worker<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

/*
 * Use a different Redis database from our other
 * integration tests so they cannot interfere
 * with each other.
 */
const TEST_REDIS_DATABASE = 14;

const TEST_REDIS_CONFIG = {
  host: '127.0.0.1',

  port: 6379,

  database: TEST_REDIS_DATABASE,

  useTls: false,
} as const;

function createTestRedis(): Redis {
  return new Redis({
    host: TEST_REDIS_CONFIG.host,

    port: TEST_REDIS_CONFIG.port,

    db: TEST_REDIS_CONFIG.database,

    /*
     * BullMQ workers need persistent Redis
     * retry behavior.
     */
    maxRetriesPerRequest: null,
  });
}

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

describe('Analysis QueueEvents integration', () => {
  let producerRedis: Redis | undefined;

  let workerRedis: Redis | undefined;

  let queue: TestQueue | undefined;

  let worker: TestWorker | undefined;

  let queueEvents: AnalysisQueueEvents | undefined;

  let disconnectQueueEvents: (() => void) | undefined;

  let eventHub: AnalysisEventHub;

  beforeAll(async () => {
    producerRedis = createTestRedis();

    workerRedis = createTestRedis();

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
     * Start this test with an empty queue.
     */
    await queue.obliterate({
      force: true,
    });

    eventHub = new AnalysisEventHub();

    /*
     * This QueueEvents instance uses its
     * own dedicated Redis connection.
     */
    queueEvents = createAnalysisQueueEvents(TEST_REDIS_CONFIG);

    queueEvents.on('error', () => {
      /*
       * Prevent EventEmitter connection
       * errors from becoming unhandled
       * during test teardown.
       */
    });

    await queueEvents.waitUntilReady();

    disconnectQueueEvents = connectAnalysisQueueEvents(queueEvents, eventHub);

    /*
     * This is a real BullMQ Worker.
     *
     * We intentionally use a very small test
     * processor here. Worker analysis logic is
     * already tested separately in apps/worker.
     *
     * This integration test is specifically
     * proving the Redis QueueEvents bridge.
     */
    worker = new Worker<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>(
      ANALYSIS_QUEUE_NAME,

      async (job) => {
        await job.updateProgress({
          analysisId: job.data.analysisId,

          stage: 'ingesting',

          percent: 25,

          message: 'Integration worker progress',

          timestamp: new Date().toISOString(),
        });

        return {
          analysisId: job.data.analysisId,

          status: 'partial',
        };
      },

      {
        connection: workerRedis,

        concurrency: 1,
      },
    );

    /*
     * BullMQ recommends listening for worker
     * errors because Worker is an EventEmitter.
     */
    worker.on('error', () => {
      /*
       * The actual failure will surface
       * through the test timeout/assertions.
       */
    });

    await worker.waitUntilReady();
  }, 15_000);

  afterAll(async () => {
    if (worker) {
      await worker.close().catch(() => undefined);
    }

    disconnectQueueEvents?.();

    if (queueEvents) {
      await queueEvents.close().catch(() => undefined);
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
  }, 15_000);

  it('forwards worker progress and completion through QueueEvents to the event hub', async () => {
    if (!queue) {
      throw new Error('Integration queue was not initialized.');
    }

    const activeQueue = queue;

    const analysisId = randomUUID();

    const repositoryId = randomUUID();

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

    const receivedEvents: AnalysisStreamEvent[] = [];

    /*
     * Subscribe BEFORE queue.add().
     *
     * Otherwise the worker could process a
     * tiny test job before our listener is
     * attached.
     */
    const completed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();

        reject(new Error('Timed out waiting for QueueEvents completion.'));
      }, 10_000);

      const unsubscribe = eventHub.subscribe(analysisId, (event) => {
        receivedEvents.push(event);

        if (event.type === 'completed') {
          clearTimeout(timeout);

          unsubscribe();

          resolve();
        }

        if (event.type === 'failed') {
          clearTimeout(timeout);

          unsubscribe();

          reject(new Error(event.data.reason));
        }
      });
    });

    /*
     * IMPORTANT:
     *
     * jobId = analysisId
     *
     * This is the same identity convention
     * used by enqueueAnalysisJob().
     */
    await activeQueue.add(ANALYSIS_JOB_NAME, jobData, {
      jobId: analysisId,
    });

    await completed;

    const progressEvent = receivedEvents.find((event) => event.type === 'progress');

    expect(progressEvent).toEqual({
      type: 'progress',

      jobId: analysisId,

      data: {
        analysisId,

        stage: 'ingesting',

        percent: 25,

        message: 'Integration worker progress',

        timestamp: expect.any(String),
      },
    });

    const completedEvent = receivedEvents.find((event) => event.type === 'completed');

    expect(completedEvent).toEqual({
      type: 'completed',

      jobId: analysisId,

      data: {
        analysisId,

        status: 'partial',
      },
    });

    /*
     * Progress must arrive before completion.
     */
    expect(receivedEvents.map((event) => event.type)).toEqual(['progress', 'completed']);
  }, 15_000);
});
