import type { RedisConnectionConfig } from '@astral-atlas/shared';

import { Redis, type RedisOptions } from 'ioredis';

export function createWorkerRedisOptions(config: RedisConnectionConfig) {
  const options = {
    host: config.host,

    port: config.port,

    db: config.database,

    /*
     * IMPORTANT:
     *
     * Workers are long-running background processes.
     * If Redis disappears temporarily, the worker
     * should keep trying rather than permanently fail.
     *
     * BullMQ requires this to be null when an
     * existing ioredis connection is given to Worker.
     */
    maxRetriesPerRequest: null,

    /*
     * Unlike the HTTP API, a worker may safely buffer
     * commands temporarily while Redis reconnects.
     */
    enableOfflineQueue: true,

    enableReadyCheck: true,

    connectTimeout: 10_000,

    protocol: 3 as const,

    replyMapping: 'legacy' as const,

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
  } satisfies RedisOptions;

  return options;
}

export function createWorkerRedisClient(config: RedisConnectionConfig): Redis {
  const options = createWorkerRedisOptions(config);

  return new Redis(options);
}
