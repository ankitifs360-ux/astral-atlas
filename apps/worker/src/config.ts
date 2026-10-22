import {
  DEFAULT_REDIS_DATABASE,
  DEFAULT_REDIS_HOST,
  DEFAULT_REDIS_PORT,
  type RedisConnectionConfig,
} from '@astral-atlas/shared';

import { z } from 'zod';

const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  REDIS_HOST: z.string().min(1).default(DEFAULT_REDIS_HOST),

  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_REDIS_PORT),

  REDIS_DATABASE: z.coerce.number().int().min(0).max(15).default(DEFAULT_REDIS_DATABASE),

  REDIS_USERNAME: z.string().optional(),

  REDIS_PASSWORD: z.string().optional(),

  REDIS_TLS: z.enum(['true', 'false']).default('false'),
});

export interface WorkerConfig {
  nodeEnv: 'development' | 'test' | 'production';

  redis: RedisConnectionConfig;
}

function parseOptionalEnvironmentValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseWorkerConfig(source: NodeJS.ProcessEnv): WorkerConfig {
  const result = workerEnvironmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'environment';

        return `${field}: ${issue.message}`;
      })
      .join('; ');

    throw new Error(`Invalid worker configuration: ${details}`);
  }

  const redisUsername = parseOptionalEnvironmentValue(result.data.REDIS_USERNAME);

  const redisPassword = parseOptionalEnvironmentValue(result.data.REDIS_PASSWORD);

  const redis: RedisConnectionConfig = {
    host: result.data.REDIS_HOST,

    port: result.data.REDIS_PORT,

    database: result.data.REDIS_DATABASE,

    useTls: result.data.REDIS_TLS === 'true',

    ...(redisUsername !== undefined
      ? {
          username: redisUsername,
        }
      : {}),

    ...(redisPassword !== undefined
      ? {
          password: redisPassword,
        }
      : {}),
  };

  return {
    nodeEnv: result.data.NODE_ENV,

    redis,
  };
}
