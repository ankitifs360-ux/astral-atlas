import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import { describe, expect, it, vi } from 'vitest';

import { enqueueAnalysisJob, requeueAnalysisJob } from './enqueue-analysis.js';

import type { AnalysisQueue } from './analysis-queue.js';

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

describe('enqueueAnalysisJob', () => {
  it('adds the shared analysis job to BullMQ', async () => {
    const add = vi.fn(async () => ({
      id: 'job-id',
    }));

    const queue = {
      add,
    } as unknown as AnalysisQueue;

    const data = createJobData();

    await enqueueAnalysisJob(queue, data);

    expect(add).toHaveBeenCalledTimes(1);

    expect(add).toHaveBeenCalledWith(ANALYSIS_JOB_NAME, data, expect.any(Object));
  });

  it('uses analysisId as the BullMQ jobId', async () => {
    const add = vi.fn(async () => ({
      id: 'job-id',
    }));

    const queue = {
      add,
    } as unknown as AnalysisQueue;

    const data = createJobData();

    await enqueueAnalysisJob(queue, data);

    expect(add).toHaveBeenCalledWith(ANALYSIS_JOB_NAME, data, {
      jobId: data.analysisId,
    });
  });

  it('returns the BullMQ job created by the queue', async () => {
    const createdJob = {
      id: 'created-job',
    };

    const add = vi.fn(async () => createdJob);

    const queue = {
      add,
    } as unknown as AnalysisQueue;

    const data = createJobData();

    const result = await enqueueAnalysisJob(queue, data);

    expect(result).toBe(createdJob);
  });
});

describe('requeueAnalysisJob', () => {
  it.each(['completed', 'failed'] as const)(
    'removes an existing %s job before adding the retry',
    async (state) => {
      const remove = vi.fn(async () => undefined);

      const existingJob = {
        getState: vi.fn(async () => state),
        remove,
      };

      const getJob = vi.fn(async () => existingJob);

      const createdJob = {
        id: 'retried-job',
      };

      const add = vi.fn(async () => createdJob);

      const queue = {
        getJob,
        add,
      } as unknown as AnalysisQueue;

      const data = createJobData();

      const result = await requeueAnalysisJob(queue, data);

      expect(getJob).toHaveBeenCalledTimes(1);

      expect(getJob).toHaveBeenCalledWith(data.analysisId);

      expect(existingJob.getState).toHaveBeenCalledTimes(1);

      expect(remove).toHaveBeenCalledTimes(1);

      expect(add).toHaveBeenCalledTimes(1);

      expect(add).toHaveBeenCalledWith(ANALYSIS_JOB_NAME, data, {
        jobId: data.analysisId,
      });

      expect(result).toBe(createdJob);
    },
  );

  it('adds the retry when the old BullMQ job has already been removed', async () => {
    const getJob = vi.fn(async () => undefined);

    const createdJob = {
      id: 'retried-job',
    };

    const add = vi.fn(async () => createdJob);

    const queue = {
      getJob,
      add,
    } as unknown as AnalysisQueue;

    const data = createJobData();

    const result = await requeueAnalysisJob(queue, data);

    expect(getJob).toHaveBeenCalledWith(data.analysisId);

    expect(add).toHaveBeenCalledWith(ANALYSIS_JOB_NAME, data, {
      jobId: data.analysisId,
    });

    expect(result).toBe(createdJob);
  });

  it.each(['active', 'waiting', 'delayed', 'prioritized', 'waiting-children', 'unknown'] as const)(
    'refuses to remove and duplicate a non-terminal %s job',
    async (state) => {
      const remove = vi.fn(async () => undefined);

      const existingJob = {
        getState: vi.fn(async () => state),
        remove,
      };

      const getJob = vi.fn(async () => existingJob);

      const add = vi.fn();

      const queue = {
        getJob,
        add,
      } as unknown as AnalysisQueue;

      const data = createJobData();

      await expect(requeueAnalysisJob(queue, data)).rejects.toThrow(
        `Cannot requeue analysis "${data.analysisId}" because its BullMQ job is still "${state}".`,
      );

      expect(remove).not.toHaveBeenCalled();

      expect(add).not.toHaveBeenCalled();
    },
  );

  it('does not add the replacement job when removing the terminal job fails', async () => {
    const removeError = new Error('BullMQ remove failed');

    const existingJob = {
      getState: vi.fn(async () => 'failed'),
      remove: vi.fn(async () => {
        throw removeError;
      }),
    };

    const queue = {
      getJob: vi.fn(async () => existingJob),
      add: vi.fn(),
    } as unknown as AnalysisQueue;

    const data = createJobData();

    await expect(requeueAnalysisJob(queue, data)).rejects.toBe(removeError);

    expect(queue.add).not.toHaveBeenCalled();
  });
});
