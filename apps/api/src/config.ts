import { z } from 'zod';

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),

  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must be a PostgreSQL URL',
    ),

  API_HOST: z.string().min(1),

  API_PORT: z.coerce.number().int().min(1).max(65535),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),

  CORS_ORIGINS: z.string().min(1),

  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000),

  TRUST_PROXY: z.enum(['true', 'false']),
});

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  corsOrigins: string[];
  rateLimitMax: number;
  trustProxy: boolean;
}

function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one origin.');
  }

  return origins.map((origin) => {
    const url = new URL(origin);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported CORS origin protocol: ${origin}`);
    }

    if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) {
      throw new Error(`CORS origin must not contain a path, query, or hash: ${origin}`);
    }

    return url.origin;
  });
}

export function parseApiConfig(source: NodeJS.ProcessEnv): ApiConfig {
  const result = apiEnvironmentSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'environment';

        return `${field}: ${issue.message}`;
      })
      .join('; ');

    throw new Error(`Invalid API configuration: ${details}`);
  }

  return {
    nodeEnv: result.data.NODE_ENV,
    databaseUrl: result.data.DATABASE_URL,
    host: result.data.API_HOST,
    port: result.data.API_PORT,
    logLevel: result.data.LOG_LEVEL,
    corsOrigins: parseCorsOrigins(result.data.CORS_ORIGINS),
    rateLimitMax: result.data.RATE_LIMIT_MAX,
    trustProxy: result.data.TRUST_PROXY === 'true',
  };
}
