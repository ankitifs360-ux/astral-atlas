import type { RedisConnectionConfig } from '@astral-atlas/shared';

import { Redis, type RedisOptions } from 'ioredis';

export function createRedisOptions(config: RedisConnectionConfig) {
  const options = {
    host: config.host,

    port: config.port,

    db: config.database,

    /*
     * The API should fail reasonably quickly
     * when Redis is unavailable.
     */
    maxRetriesPerRequest: 1,

    /*
     * Do not keep API commands buffered while
     * Redis is offline.
     */
    enableOfflineQueue: false,

    enableReadyCheck: true,

    connectTimeout: 10_000,

    /*
     * ioredis v6 uses RESP3 by default.
     *
     * "legacy" keeps normal RESP2-compatible
     * JavaScript response shapes.
     */
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

export function createRedisClient(config: RedisConnectionConfig): Redis {
  const options = createRedisOptions(config);

  return new Redis(options);
}
