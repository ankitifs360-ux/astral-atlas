import { randomUUID } from 'node:crypto';

import type { AnalysisSource } from '@astral-atlas/shared';

import type { Redis } from 'ioredis';

/*
 * The lock automatically expires if the worker
 * crashes and never gets a chance to release it.
 *
 * Later the processor will renew this lease while
 * long-running analysis is still active.
 */
export const ANALYSIS_LOCK_TTL_MS = 120_000;

export const ANALYSIS_LOCK_RENEW_INTERVAL_MS = 30_000;

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

const EXTEND_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export interface AnalysisLock {
  key: string;

  token: string;

  extend: () => Promise<boolean>;

  release: () => Promise<boolean>;
}

function getRevisionIdentifier(source: AnalysisSource): string {
  if (source.sourceType === 'github') {
    return source.commitSha;
  }

  return source.contentSha256;
}

export function createAnalysisLockKey(source: AnalysisSource): string {
  const revision = getRevisionIdentifier(source);

  return ['astral-atlas', 'analysis-lock', source.sourceKey, revision].join(':');
}

export async function acquireAnalysisLock(
  redis: Redis,
  source: AnalysisSource,
  ttlMs: number = ANALYSIS_LOCK_TTL_MS,
): Promise<AnalysisLock | null> {
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new Error('Analysis lock TTL must be a positive integer.');
  }

  const key = createAnalysisLockKey(source);

  /*
   * Every lock acquisition receives a unique
   * ownership token.
   *
   * This is important because the lock may expire
   * and another worker may later acquire the same
   * key.
   */
  const token = randomUUID();

  /*
   * SET key token PX ttl NX
   *
   * NX:
   * create only if the lock does not already exist.
   *
   * PX:
   * automatically expire after ttlMs milliseconds.
   */
  const result = await redis.set(key, token, 'PX', ttlMs, 'NX');

  if (result !== 'OK') {
    /*
     * Another worker already owns this revision.
     */
    return null;
  }

  return {
    key,

    token,

    extend: async () => {
      /*
       * Only extend the lock if we still own it.
       *
       * If our original lock expired and another
       * worker acquired the key, we must never
       * extend that worker's lock.
       */
      const extendResult = await redis.eval(EXTEND_LOCK_SCRIPT, 1, key, token, String(ttlMs));

      return Number(extendResult) === 1;
    },

    release: async () => {
      /*
       * Never use:
       *
       * DEL key
       *
       * directly.
       *
       * Our lock could have expired and another
       * worker could now own the same key.
       *
       * The Lua script deletes the lock only when
       * the stored token is still our token.
       */
      const releaseResult = await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);

      return Number(releaseResult) === 1;
    },
  };
}
