import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import { describe, expect, it, vi } from 'vitest';

import { enqueueAnalysisJob } from './enqueue-analysis.js';

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
