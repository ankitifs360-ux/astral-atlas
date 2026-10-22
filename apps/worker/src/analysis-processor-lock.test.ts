import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { describe, expect, it, vi } from 'vitest';

import { createAnalysisJobProcessor } from './analysis-processor.js';

import type { AnalysisJob } from './analysis-worker.js';

function createJobData(): AnalysisJobData {
  return {
    schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

    analysisId: randomUUID(),

    repositoryId: randomUUID(),

    source: {
      sourceType: 'github',

      owner: 'facebook',

      repo: 'react',

      canonicalUrl: 'https://github.com/facebook/react',

      sourceKey: 'github:facebook/react',

      commitSha: 'a'.repeat(40),
    },
  };
}

function createJob(data: AnalysisJobData): AnalysisJob {
  return {
    name: ANALYSIS_JOB_NAME,

    data,

    updateProgress: vi.fn(async () => undefined),
  } as unknown as AnalysisJob;
}

describe('createAnalysisJobProcessor', () => {
  it('acquires the revision lock, processes the job, and releases the lock', async () => {
    const set = vi.fn(async () => 'OK' as const);

    /*
     * The processor will call eval() when
     * releasing the lock.
     *
     * Returning 1 means:
     *
     * "the lock token still belonged to
     * this worker and the release succeeded."
     */
    const evalMock = vi.fn(async () => 1);

    const redis = {
      set,
      eval: evalMock,
    } as unknown as Redis;

    const processor = createAnalysisJobProcessor(redis);

    const data = createJobData();

    const job = createJob(data);

    const result = await processor(job);

    expect(result).toEqual({
      analysisId: data.analysisId,

      status: 'partial',
    });

    /*
     * Lock acquisition:
     *
     * SET key token PX ttl NX
     */
    expect(set).toHaveBeenCalledTimes(1);

    expect(set).toHaveBeenCalledWith(
      expect.stringContaining('astral-atlas:analysis-lock:'),
      expect.any(String),
      'PX',
      expect.any(Number),
      'NX',
    );

    /*
     * The normal processor logic still ran.
     */
    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: data.analysisId,

        stage: 'ingesting',

        percent: 5,
      }),
    );

    /*
     * The lock is released in finally,
     * even after normal completion.
     */
    expect(evalMock).toHaveBeenCalledTimes(1);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      expect.any(String),
      expect.any(String),
    );
  });

  it('does not process when another worker already owns the revision lock', async () => {
    const redis = {
      /*
       * SET ... NX returns null when the
       * key already exists.
       */
      set: vi.fn(async () => null),

      eval: vi.fn(),
    } as unknown as Redis;

    const processor = createAnalysisJobProcessor(redis);

    const data = createJobData();

    const job = createJob(data);

    await expect(processor(job)).rejects.toThrow('Analysis revision is already being processed');

    /*
     * Expensive analysis never starts.
     */
    expect(job.updateProgress).not.toHaveBeenCalled();

    /*
     * We never acquired the lock, so there
     * is nothing for us to release.
     */
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('releases the lock when analysis processing throws', async () => {
    const set = vi.fn(async () => 'OK' as const);

    const evalMock = vi.fn(async () => 1);

    const redis = {
      set,
      eval: evalMock,
    } as unknown as Redis;

    const processor = createAnalysisJobProcessor(redis);

    const data = createJobData();

    const job = {
      name: ANALYSIS_JOB_NAME,

      data,

      /*
       * Force analysis processing to fail
       * after the lock has been acquired.
       */
      updateProgress: vi.fn(async () => {
        throw new Error('Progress storage failed');
      }),
    } as unknown as AnalysisJob;

    await expect(processor(job)).rejects.toThrow('Progress storage failed');

    /*
     * finally must still release the lock.
     */
    expect(evalMock).toHaveBeenCalledTimes(1);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      expect.any(String),
      expect.any(String),
    );
  });
});
