import { ANALYSIS_JOB_NAME, ANALYSIS_QUEUE_NAME } from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueConstructorMock } = vi.hoisted(() => {
  return {
    queueConstructorMock: vi.fn(),
  };
});

vi.mock('bullmq', () => {
  function Queue(...args: unknown[]) {
    queueConstructorMock(...args);
  }

  return {
    Queue,
  };
});

import { createAnalysisQueue } from './analysis-queue.js';

describe('createAnalysisQueue', () => {
  beforeEach(() => {
    queueConstructorMock.mockClear();
  });

  it('creates the correct analysis queue', () => {
    const redis = {} as Redis;

    createAnalysisQueue(redis);

    expect(queueConstructorMock).toHaveBeenCalledTimes(1);

    expect(queueConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        connection: redis,
      }),
    );
  });

  it('configures three attempts with exponential backoff', () => {
    const redis = {} as Redis;

    createAnalysisQueue(redis);

    expect(queueConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 3,

          backoff: {
            type: 'exponential',

            delay: 2_000,
          },
        }),
      }),
    );
  });

  it('configures bounded completed-job retention', () => {
    const redis = {} as Redis;

    createAnalysisQueue(redis);

    expect(queueConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnComplete: {
            age: 60 * 60,

            count: 1_000,
          },
        }),
      }),
    );
  });

  it('retains failed jobs longer for debugging', () => {
    const redis = {} as Redis;

    createAnalysisQueue(redis);

    expect(queueConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnFail: {
            age: 7 * 24 * 60 * 60,

            count: 5_000,
          },
        }),
      }),
    );
  });

  it('uses the shared analysis job name', () => {
    expect(ANALYSIS_JOB_NAME).toBe('analyze-repository');
  });
});
