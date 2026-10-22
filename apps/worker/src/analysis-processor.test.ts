import { randomUUID } from 'node:crypto';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import { UnrecoverableError } from 'bullmq';

import { describe, expect, it, vi } from 'vitest';

import { processAnalysisJob } from './analysis-processor.js';

import type { AnalysisJob } from './analysis-worker.js';

function createValidJobData(): AnalysisJobData {
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

function createJob(
  options: {
    name?: string;
    data?: unknown;
  } = {},
): AnalysisJob {
  const updateProgress = vi.fn(async () => undefined);

  return {
    name: options.name ?? ANALYSIS_JOB_NAME,

    data: options.data ?? createValidJobData(),

    updateProgress,
  } as unknown as AnalysisJob;
}

describe('processAnalysisJob', () => {
  it('accepts a valid analysis job', async () => {
    const data = createValidJobData();

    const job = createJob({
      data,
    });

    const result = await processAnalysisJob(job);

    expect(result).toEqual({
      analysisId: data.analysisId,

      status: 'partial',
    });
  });

  it('reports structured ingestion progress', async () => {
    const data = createValidJobData();

    const job = createJob({
      data,
    });

    await processAnalysisJob(job);

    expect(job.updateProgress).toHaveBeenCalledTimes(1);

    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: data.analysisId,

        stage: 'ingesting',

        percent: 5,

        message: 'Worker accepted the analysis job.',
      }),
    );

    const updateProgressMock = vi.mocked(job.updateProgress);

    const progress = updateProgressMock.mock.calls[0]?.[0];

    expect(progress).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    );

    expect(
      Number.isNaN(
        Date.parse(
          (
            progress as {
              timestamp: string;
            }
          ).timestamp,
        ),
      ),
    ).toBe(false);
  });

  it('rejects an unsupported job name as unrecoverable', async () => {
    const job = createJob({
      name: 'something-else',
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('rejects an invalid commit SHA as unrecoverable', async () => {
    const validData = createValidJobData();

    const job = createJob({
      data: {
        ...validData,

        source: {
          ...validData.source,

          commitSha: 'not-a-valid-sha',
        },
      },
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('rejects an unsupported schema version as unrecoverable', async () => {
    const validData = createValidJobData();

    const job = createJob({
      data: {
        ...validData,

        schemaVersion: 999,
      },
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('accepts a valid ZIP analysis job', async () => {
    const analysisId = randomUUID();

    const job = createJob({
      data: {
        schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

        analysisId,

        repositoryId: randomUUID(),

        source: {
          sourceType: 'zip',

          sourceKey: `zip:${'b'.repeat(64)}`,

          contentSha256: 'b'.repeat(64),

          archivePath: '/tmp/astral-atlas-upload/example/repository.zip',
        },
      },
    });

    const result = await processAnalysisJob(job);

    expect(result).toEqual({
      analysisId,

      status: 'partial',
    });

    expect(job.updateProgress).toHaveBeenCalledTimes(1);
  });
});
