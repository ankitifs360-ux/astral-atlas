import { describe, expect, it } from 'vitest';

import type { RedisConnectionConfig } from '@astral-atlas/shared';

import { createRedisOptions } from './redis.js';

function createRedisConfig(overrides: Partial<RedisConnectionConfig> = {}): RedisConnectionConfig {
  return {
    host: '127.0.0.1',

    port: 6379,

    database: 0,

    useTls: false,

    ...overrides,
  };
}

describe('createRedisOptions', () => {
  it('creates Redis options for local development', () => {
    const options = createRedisOptions(createRedisConfig());

    expect(options).toMatchObject({
      host: '127.0.0.1',

      port: 6379,

      db: 0,

      maxRetriesPerRequest: 1,

      enableOfflineQueue: false,

      enableReadyCheck: true,

      connectTimeout: 10_000,

      protocol: 3,

      replyMapping: 'legacy',
    });
  });

  it('does not add credentials when they are not configured', () => {
    const options = createRedisOptions(createRedisConfig());

    expect('username' in options).toBe(false);

    expect('password' in options).toBe(false);
  });

  it('adds Redis credentials when configured', () => {
    const options = createRedisOptions(
      createRedisConfig({
        username: 'astral-atlas',

        password: 'test-secret',
      }),
    );

    expect(options).toMatchObject({
      username: 'astral-atlas',

      password: 'test-secret',
    });
  });

  it('enables TLS only when configured', () => {
    const withoutTls = createRedisOptions(
      createRedisConfig({
        useTls: false,
      }),
    );

    expect('tls' in withoutTls).toBe(false);

    const withTls = createRedisOptions(
      createRedisConfig({
        useTls: true,
      }),
    );

    expect(withTls.tls).toEqual({});
  });
});
