export interface RedisConfig {
  host: string;

  port: number;

  database: number;

  username?: string;

  password?: string;

  useTls: boolean;
}

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';

  databaseUrl: string;

  host: string;

  port: number;

  logLevel: string;

  corsOrigins: string[];

  rateLimitMax: number;

  trustProxy: boolean;

  redis: RedisConfig;

  /*
   * Optional in the TypeScript shape so our existing
   * app-level unit-test fixtures do not all need changing.
   *
   * parseApiConfig() still validates the real environment.
   */
  githubToken?: string;

  /*
   * API and worker must see the same directory.
   *
   * Local default:
   *   /tmp/astral-atlas/zip-staging
   *
   * Docker will later mount a shared volume here.
   */
  zipStagingDirectory?: string;
}

type Environment = NodeJS.ProcessEnv;

function getOptionalString(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}

function getRequiredString(environment: Environment, name: string): string {
  const value = getOptionalString(environment, name);

  if (value === undefined) {
    throw new Error(`Environment variable ${name} is required.`);
  }

  return value;
}

function parseInteger(
  value: string | undefined,
  options: {
    name: string;

    defaultValue: number;

    minimum: number;

    maximum: number;
  },
): number {
  if (value === undefined || value.trim().length === 0) {
    return options.defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < options.minimum || parsed > options.maximum) {
    throw new Error(
      `Environment variable ${options.name} must be an integer between ${options.minimum} and ${options.maximum}.`,
    );
  }

  return parsed;
}

function parseBoolean(
  value: string | undefined,
  options: {
    name: string;

    defaultValue: boolean;
  },
): boolean {
  if (value === undefined || value.trim().length === 0) {
    return options.defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  throw new Error(`Environment variable ${options.name} must be "true" or "false".`);
}

function parseNodeEnvironment(value: string | undefined): ApiConfig['nodeEnv'] {
  const normalized = value?.trim() || 'development';

  if (normalized !== 'development' && normalized !== 'test' && normalized !== 'production') {
    throw new Error('Environment variable NODE_ENV must be development, test, or production.');
  }

  return normalized;
}

function parseCorsOrigins(value: string | undefined): string[] {
  if (value === undefined || value.trim().length === 0) {
    return ['http://localhost:5173'];
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error('Environment variable CORS_ORIGINS must contain at least one origin.');
  }

  for (const origin of origins) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`CORS origin must use HTTP or HTTPS: ${origin}`);
    }
  }

  return origins;
}

function parseGithubToken(environment: Environment): string | undefined {
  const token = getOptionalString(environment, 'GITHUB_TOKEN');

  if (token === undefined) {
    /*
     * Public GitHub requests can work without authentication,
     * but GitHub applies a much smaller rate limit.
     *
     * Therefore the token remains optional for development
     * and tests. Production server wiring can still log or
     * enforce this more strongly later if desired.
     */
    return undefined;
  }

  if (token.length < 10) {
    throw new Error('Environment variable GITHUB_TOKEN is invalid.');
  }

  return token;
}

function parseZipStagingDirectory(environment: Environment): string {
  const configured = getOptionalString(environment, 'ZIP_STAGING_DIRECTORY');

  return configured ?? '/tmp/astral-atlas/zip-staging';
}

export function parseApiConfig(environment: Environment): ApiConfig {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);

  const databaseUrl = getRequiredString(environment, 'DATABASE_URL');

  const host = getOptionalString(environment, 'API_HOST') ?? '0.0.0.0';

  const port = parseInteger(environment.API_PORT, {
    name: 'API_PORT',

    defaultValue: 3000,

    minimum: 1,

    maximum: 65_535,
  });

  const logLevel = getOptionalString(environment, 'LOG_LEVEL') ?? 'info';

  const corsOrigins = parseCorsOrigins(environment.CORS_ORIGINS);

  const rateLimitMax = parseInteger(environment.RATE_LIMIT_MAX, {
    name: 'RATE_LIMIT_MAX',

    defaultValue: 100,

    minimum: 1,

    maximum: 100_000,
  });

  const trustProxy = parseBoolean(environment.TRUST_PROXY, {
    name: 'TRUST_PROXY',

    defaultValue: false,
  });

  const redisHost = getOptionalString(environment, 'REDIS_HOST') ?? '127.0.0.1';

  const redisPort = parseInteger(environment.REDIS_PORT, {
    name: 'REDIS_PORT',

    defaultValue: 6379,

    minimum: 1,

    maximum: 65_535,
  });

  const redisDatabase = parseInteger(environment.REDIS_DB, {
    name: 'REDIS_DB',

    defaultValue: 0,

    minimum: 0,

    maximum: 15,
  });

  const redisUseTls = parseBoolean(environment.REDIS_TLS, {
    name: 'REDIS_TLS',

    defaultValue: false,
  });

  const redisUsername = getOptionalString(environment, 'REDIS_USERNAME');

  const redisPassword = getOptionalString(environment, 'REDIS_PASSWORD');

  const githubToken = parseGithubToken(environment);

  const zipStagingDirectory = parseZipStagingDirectory(environment);

  return {
    nodeEnv,

    databaseUrl,

    host,

    port,

    logLevel,

    corsOrigins,

    rateLimitMax,

    trustProxy,

    redis: {
      host: redisHost,

      port: redisPort,

      database: redisDatabase,

      useTls: redisUseTls,

      ...(redisUsername === undefined
        ? {}
        : {
            username: redisUsername,
          }),

      ...(redisPassword === undefined
        ? {}
        : {
            password: redisPassword,
          }),
    },

    ...(githubToken === undefined
      ? {}
      : {
          githubToken,
        }),

    zipStagingDirectory,
  };
}
