import type { AnalysisSource } from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

import { describe, expect, it, vi } from 'vitest';

import {
  acquireAnalysisLock,
  ANALYSIS_LOCK_TTL_MS,
  createAnalysisLockKey,
} from './analysis-lock.js';

function createGitHubSource(): AnalysisSource {
  return {
    sourceType: 'github',

    owner: 'facebook',

    repo: 'react',

    canonicalUrl: 'https://github.com/facebook/react',

    sourceKey: 'github:facebook/react',

    commitSha: 'a'.repeat(40),
  };
}

function createZipSource(): AnalysisSource {
  return {
    sourceType: 'zip',

    sourceKey: 'zip:example',

    contentSha256: 'b'.repeat(64),

    archivePath: '/tmp/example.zip',
  };
}

describe('createAnalysisLockKey', () => {
  it('creates a deterministic GitHub revision lock key', () => {
    const source = createGitHubSource();

    expect(createAnalysisLockKey(source)).toBe(
      ['astral-atlas', 'analysis-lock', 'github:facebook/react', 'a'.repeat(40)].join(':'),
    );
  });

  it('uses the ZIP content hash as the revision identifier', () => {
    const source = createZipSource();

    expect(createAnalysisLockKey(source)).toBe(
      ['astral-atlas', 'analysis-lock', 'zip:example', 'b'.repeat(64)].join(':'),
    );
  });
});

describe('acquireAnalysisLock', () => {
  it('acquires the lock with NX and PX', async () => {
    const set = vi.fn(async () => 'OK' as const);

    const redis = {
      set,
      eval: vi.fn(),
    } as unknown as Redis;

    const source = createGitHubSource();

    const lock = await acquireAnalysisLock(redis, source);

    expect(lock).not.toBeNull();

    expect(set).toHaveBeenCalledTimes(1);

    expect(set).toHaveBeenCalledWith(
      createAnalysisLockKey(source),
      expect.any(String),
      'PX',
      ANALYSIS_LOCK_TTL_MS,
      'NX',
    );

    expect(lock?.token).toEqual(expect.any(String));
  });

  it('returns null when another worker already owns the lock', async () => {
    const redis = {
      set: vi.fn(async () => null),

      eval: vi.fn(),
    } as unknown as Redis;

    const lock = await acquireAnalysisLock(redis, createGitHubSource());

    expect(lock).toBeNull();
  });

  it('rejects an invalid TTL', async () => {
    const redis = {
      set: vi.fn(),

      eval: vi.fn(),
    } as unknown as Redis;

    await expect(acquireAnalysisLock(redis, createGitHubSource(), 0)).rejects.toThrow(
      'Analysis lock TTL must be a positive integer.',
    );

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('releases the lock only through the ownership-check script', async () => {
    const set = vi.fn(async () => 'OK' as const);

    const evalMock = vi.fn(async () => 1);

    const redis = {
      set,

      eval: evalMock,
    } as unknown as Redis;

    const lock = await acquireAnalysisLock(redis, createGitHubSource());

    expect(lock).not.toBeNull();

    const released = await lock?.release();

    expect(released).toBe(true);

    expect(evalMock).toHaveBeenCalledTimes(1);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1])'),
      1,
      lock?.key,
      lock?.token,
    );
  });

  it('reports false when the lock is no longer owned during release', async () => {
    const redis = {
      set: vi.fn(async () => 'OK' as const),

      eval: vi.fn(async () => 0),
    } as unknown as Redis;

    const lock = await acquireAnalysisLock(redis, createGitHubSource());

    expect(lock).not.toBeNull();

    expect(await lock?.release()).toBe(false);
  });

  it('extends the lock only while the token still owns it', async () => {
    const evalMock = vi.fn(async () => 1);

    const redis = {
      set: vi.fn(async () => 'OK' as const),

      eval: evalMock,
    } as unknown as Redis;

    const customTtl = 60_000;

    const lock = await acquireAnalysisLock(redis, createGitHubSource(), customTtl);

    expect(lock).not.toBeNull();

    const extended = await lock?.extend();

    expect(extended).toBe(true);

    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("pexpire", KEYS[1], ARGV[2])'),
      1,
      lock?.key,
      lock?.token,
      String(customTtl),
    );
  });

  it('reports false when renewal discovers that ownership was lost', async () => {
    const redis = {
      set: vi.fn(async () => 'OK' as const),

      eval: vi.fn(async () => 0),
    } as unknown as Redis;

    const lock = await acquireAnalysisLock(redis, createGitHubSource());

    expect(lock).not.toBeNull();

    expect(await lock?.extend()).toBe(false);
  });
});
