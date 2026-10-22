import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAnalysisQueue, type AnalysisQueue } from './analysis-queue.js';

import { createRedisClient } from '../redis.js';

async function waitForRedisReady(redis: Redis, timeoutMs = 10_000): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();

      reject(new Error('Redis did not become ready within the timeout.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);

      redis.off('ready', handleReady);

      redis.off('error', handleError);

      redis.off('end', handleEnd);
    };

    const handleReady = () => {
      cleanup();
      resolve();
    };

    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const handleEnd = () => {
      cleanup();

      reject(new Error('Redis connection ended before becoming ready.'));
    };

    redis.once('ready', handleReady);

    redis.once('error', handleError);

    redis.once('end', handleEnd);

    /*
     * Avoid a small race where Redis becomes
     * ready between our first status check
     * and registering the event listeners.
     */
    if (redis.status === 'ready') {
      handleReady();
    }
  });
}

describe('Analysis queue integration', () => {
  let redis: Redis | undefined;

  let queue: AnalysisQueue | undefined;

  beforeAll(async () => {
    /*
     * Development uses Redis DB 0.
     *
     * Integration tests use DB 15 so they
     * cannot remove normal development jobs.
     */
    redis = createRedisClient({
      host: '127.0.0.1',

      port: 6379,

      database: 15,

      useTls: false,
    });

    /*
     * createRedisClient() begins connecting
     * automatically.
     *
     * Because enableOfflineQueue=false,
     * we must wait until ioredis emits "ready"
     * before issuing PING.
     */
    await waitForRedisReady(redis);

    const pong = await redis.ping();

    expect(pong).toBe('PONG');

    queue = createAnalysisQueue(redis);

    await queue.waitUntilReady();

    /*
     * DB 15 is reserved for this integration
     * test, so remove old test queue data.
     */
    await queue.obliterate({
      force: true,
    });
  });

  afterAll(async () => {
    if (queue) {
      await queue
        .obliterate({
          force: true,
        })
        .catch(() => undefined);

      /*
       * BullMQ must close before its shared
       * Redis connection.
       */
      await queue.close().catch(() => undefined);
    }

    if (redis) {
      /*
       * QUIT itself is a Redis command.
       *
       * If the connection never reached ready,
       * sending QUIT would produce the same
       * "stream isn't writeable" error.
       */
      if (redis.status === 'ready') {
        await redis.quit().catch(() => {
          redis?.disconnect();
        });
      } else {
        redis.disconnect();
      }
    }
  });

  it('stores an analysis job in Redis', async () => {
    if (!queue) {
      throw new Error('Analysis queue was not initialized.');
    }

    const analysisId = randomUUID();

    const repositoryId = randomUUID();

    const commitSha = 'a'.repeat(40);

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

        commitSha,
      },
    };

    const jobId = `integration-${randomUUID()}`;

    const job = await queue.add(ANALYSIS_JOB_NAME, jobData, {
      jobId,
    });

    expect(job.id).toBe(jobId);

    expect(job.name).toBe(ANALYSIS_JOB_NAME);

    expect(job.data).toEqual(jobData);

    /*
     * Read it back from Redis.
     *
     * This proves it was really persisted,
     * not merely returned from Queue.add().
     */
    const storedJob = await queue.getJob(jobId);

    expect(storedJob).not.toBeNull();

    expect(storedJob?.data).toEqual(jobData);

    expect(storedJob?.name).toBe(ANALYSIS_JOB_NAME);

    /*
     * No worker exists yet, so the job must
     * remain in the waiting state.
     */
    const state = await storedJob?.getState();

    expect(state).toBe('waiting');

    expect(await queue.getWaitingCount()).toBe(1);
  });
});
