import { ANALYSIS_QUEUE_NAME, type RedisConnectionConfig } from '@astral-atlas/shared';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queueEventsConstructorMock } = vi.hoisted(() => ({
  queueEventsConstructorMock: vi.fn(),
}));

vi.mock('bullmq', () => {
  function QueueEvents(...args: unknown[]) {
    queueEventsConstructorMock(...args);
  }

  return {
    QueueEvents,
  };
});
import { createAnalysisQueueEvents } from './analysis-events.js';

function createRedisConfig(overrides: Partial<RedisConnectionConfig> = {}): RedisConnectionConfig {
  return {
    host: '127.0.0.1',

    port: 6379,

    database: 0,

    useTls: false,

    ...overrides,
  };
}

describe('createAnalysisQueueEvents', () => {
  beforeEach(() => {
    queueEventsConstructorMock.mockClear();
  });

  it('creates QueueEvents for the shared analysis queue', () => {
    createAnalysisQueueEvents(createRedisConfig());

    expect(queueEventsConstructorMock).toHaveBeenCalledTimes(1);

    expect(queueEventsConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,
      expect.any(Object),
    );
  });

  it('uses the configured Redis connection', () => {
    createAnalysisQueueEvents(
      createRedisConfig({
        host: 'redis.internal',

        port: 6380,

        database: 2,
      }),
    );

    expect(queueEventsConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        connection: expect.objectContaining({
          host: 'redis.internal',

          port: 6380,

          db: 2,
        }),
      }),
    );
  });

  it('uses persistent Redis behavior for long-running events', () => {
    createAnalysisQueueEvents(createRedisConfig());

    expect(queueEventsConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        connection: expect.objectContaining({
          maxRetriesPerRequest: null,

          enableOfflineQueue: true,
        }),
      }),
    );
  });

  it('adds credentials only when configured', () => {
    createAnalysisQueueEvents(
      createRedisConfig({
        username: 'astral-atlas',

        password: 'test-secret',
      }),
    );

    expect(queueEventsConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        connection: expect.objectContaining({
          username: 'astral-atlas',

          password: 'test-secret',
        }),
      }),
    );
  });

  it('enables TLS only when configured', () => {
    createAnalysisQueueEvents(
      createRedisConfig({
        useTls: true,
      }),
    );

    expect(queueEventsConstructorMock).toHaveBeenCalledWith(
      ANALYSIS_QUEUE_NAME,

      expect.objectContaining({
        connection: expect.objectContaining({
          tls: {},
        }),
      }),
    );
  });
});
