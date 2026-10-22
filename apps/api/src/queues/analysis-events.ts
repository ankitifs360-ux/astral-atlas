import { ANALYSIS_QUEUE_NAME, type RedisConnectionConfig } from '@astral-atlas/shared';

import { QueueEvents, type ConnectionOptions } from 'bullmq';

function createQueueEventsConnection(config: RedisConnectionConfig): ConnectionOptions {
  return {
    host: config.host,

    port: config.port,

    db: config.database,

    /*
     * QueueEvents is a long-running background
     * listener, unlike an HTTP producer request.
     *
     * It should survive temporary Redis outages.
     */
    maxRetriesPerRequest: null,

    enableOfflineQueue: true,

    ...(config.username !== undefined
      ? {
          username: config.username,
        }
      : {}),

    ...(config.password !== undefined
      ? {
          password: config.password,
        }
      : {}),

    ...(config.useTls
      ? {
          tls: {},
        }
      : {}),
  };
}

export type AnalysisQueueEvents = QueueEvents;

export function createAnalysisQueueEvents(config: RedisConnectionConfig): AnalysisQueueEvents {
  return new QueueEvents(ANALYSIS_QUEUE_NAME, {
    connection: createQueueEventsConnection(config),
  });
}
