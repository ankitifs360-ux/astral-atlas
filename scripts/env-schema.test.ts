import { describe, expect, it } from 'vitest';

import { validateEnv } from './env-schema.js';

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',

  POSTGRES_DB: 'astral_atlas',
  POSTGRES_USER: 'astral',
  POSTGRES_PASSWORD: 'astral_local_dev_only',
  POSTGRES_PORT: '5432',
  DATABASE_URL: 'postgresql://astral:astral_local_dev_only@127.0.0.1:5432/astral_atlas',

  REDIS_PORT: '6379',
  REDIS_URL: 'redis://127.0.0.1:6379',

  API_HOST: '127.0.0.1',
  API_PORT: '3000',

  LOG_LEVEL: 'info',
};

describe('validateEnv', () => {
  it('accepts a valid development environment', () => {
    const env = validateEnv(validEnvironment);

    expect(env.POSTGRES_PORT).toBe(5432);
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.API_PORT).toBe(3000);
  });

  it('rejects an invalid PostgreSQL port', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        POSTGRES_PORT: '70000',
      }),
    ).toThrow('POSTGRES_PORT');
  });

  it('rejects a non-PostgreSQL database URL', () => {
    expect(() =>
      validateEnv({
        ...validEnvironment,
        DATABASE_URL: 'https://example.com/database',
      }),
    ).toThrow('DATABASE_URL');
  });
});
