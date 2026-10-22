import { ANALYSIS_JOB_NAME, ANALYSIS_QUEUE_NAME } from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalysisJobProcessor } from './analysis-worker.js';

const { workerConstructorMock } = vi.hoisted(() => ({
  workerConstructorMock: vi.fn(),
}));

vi.mock('bullmq', () => {
  function Worker(...args: unknown[]) {
    workerConstructorMock(...args);
  }

  return {
    Worker,
  };
});

import { createAnalysisWorker } from './analysis-worker.js';

describe('createAnalysisWorker', () => {
  beforeEach(() => {
    workerConstructorMock.mockClear();
  });

  it('creates a worker for the shared analysis queue', () => {
    const redis = {} as Redis;

    const processor: AnalysisJobProcessor = vi.fn();

    createAnalysisWorker(redis, processor);

    expect(workerConstructorMock).toHaveBeenCalledTimes(1);

    expect(workerConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,
      processor,
      expect.any(Object),
    );
  });

  it('uses the supplied Redis connection', () => {
    const redis = {} as Redis;

    const processor: AnalysisJobProcessor = vi.fn();

    createAnalysisWorker(redis, processor);

    expect(workerConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,
      processor,
      expect.objectContaining({
        connection: redis,
      }),
    );
  });

  it('processes one repository analysis at a time', () => {
    const redis = {} as Redis;

    const processor: AnalysisJobProcessor = vi.fn();

    createAnalysisWorker(redis, processor);

    expect(workerConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,
      processor,
      expect.objectContaining({
        concurrency: 1,
      }),
    );
  });

  it('does not autorun before startup hooks are attached', () => {
    const redis = {} as Redis;

    const processor: AnalysisJobProcessor = vi.fn();

    createAnalysisWorker(redis, processor);

    expect(workerConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,
      processor,
      expect.objectContaining({
        autorun: false,
      }),
    );
  });

  it('uses the shared analysis job name contract', () => {
    expect(ANALYSIS_JOB_NAME).toBe('analyze-repository');
  });
});
