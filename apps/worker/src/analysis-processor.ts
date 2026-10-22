import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
  type AnalysisJobResult,
  type AnalysisProgress,
} from '@astral-atlas/shared';

import { UnrecoverableError } from 'bullmq';

import type { Redis } from 'ioredis';

import { z } from 'zod';

import { acquireAnalysisLock, ANALYSIS_LOCK_RENEW_INTERVAL_MS } from './analysis-lock.js';

import type { AnalysisJob, AnalysisJobProcessor } from './analysis-worker.js';

const GitHubAnalysisSourceSchema = z
  .object({
    sourceType: z.literal('github'),

    owner: z.string().min(1).max(39),

    repo: z.string().min(1).max(100),

    canonicalUrl: z.string().url(),

    sourceKey: z.string().min(1),

    commitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/i, 'Git commit SHA must contain exactly 40 hexadecimal characters.'),
  })
  .strict();

const ZipAnalysisSourceSchema = z
  .object({
    sourceType: z.literal('zip'),

    sourceKey: z.string().min(1),

    contentSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'ZIP SHA-256 must contain exactly 64 hexadecimal characters.'),

    archivePath: z.string().min(1),
  })
  .strict();

const AnalysisJobDataSchema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_JOB_SCHEMA_VERSION),

    analysisId: z.string().uuid(),

    repositoryId: z.string().uuid(),

    source: z.discriminatedUnion('sourceType', [
      GitHubAnalysisSourceSchema,
      ZipAnalysisSourceSchema,
    ]),
  })
  .strict();

function validateJobData(data: unknown): AnalysisJobData {
  const result = AnalysisJobDataSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'job';

        return `${field}: ${issue.message}`;
      })
      .join('; ');

    throw new UnrecoverableError(`Invalid analysis job data: ${details}`);
  }

  return result.data;
}

function validateAnalysisJob(job: AnalysisJob): AnalysisJobData {
  /*
   * The queue should contain only one job type.
   *
   * If some malformed or old producer inserts a
   * different job name, retrying will not fix it.
   */
  if (job.name !== ANALYSIS_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported analysis job name: ${job.name}`);
  }

  return validateJobData(job.data);
}

async function reportProgress(job: AnalysisJob, progress: AnalysisProgress): Promise<void> {
  await job.updateProgress(progress);
}

async function processValidatedAnalysisJob(
  job: AnalysisJob,
  data: AnalysisJobData,
): Promise<AnalysisJobResult> {
  await reportProgress(job, {
    analysisId: data.analysisId,

    stage: 'ingesting',

    percent: 5,

    message: 'Worker accepted the analysis job.',

    timestamp: new Date().toISOString(),
  });

  /*
   * Real repository parsing/graph analysis is
   * introduced in later backend stages.
   *
   * B4 therefore reports partial rather than
   * pretending the repository is fully analyzed.
   */
  return {
    analysisId: data.analysisId,

    status: 'partial',
  };
}

/*
 * Pure processor used by our unit tests.
 *
 * It validates runtime queue data but does not
 * require Redis locking.
 */
export const processAnalysisJob: AnalysisJobProcessor = async (job): Promise<AnalysisJobResult> => {
  const data = validateAnalysisJob(job);

  return processValidatedAnalysisJob(job, data);
};

/*
 * Production processor.
 *
 * This adds revision-level distributed locking
 * around the actual analysis logic.
 */
export function createAnalysisJobProcessor(redis: Redis): AnalysisJobProcessor {
  return async (job): Promise<AnalysisJobResult> => {
    /*
     * Validate BEFORE touching the lock.
     *
     * We must not trust arbitrary Redis queue
     * data simply because TypeScript says it has
     * an AnalysisJobData type.
     */
    const data = validateAnalysisJob(job);

    const lock = await acquireAnalysisLock(redis, data.source);

    if (!lock) {
      /*
       * This is not unrecoverable.
       *
       * Another worker is currently processing
       * the same exact repository revision.
       *
       * Throwing a normal Error allows BullMQ's
       * retry policy to handle a temporary race.
       */
      throw new Error(`Analysis revision is already being processed: ${data.source.sourceKey}`);
    }

    let renewalFailure: Error | undefined;

    let renewalPromise: Promise<void> | undefined;

    const renewLock = () => {
      /*
       * Never start two renewal operations at
       * the same time.
       */
      if (renewalPromise) {
        return;
      }

      renewalPromise = lock
        .extend()
        .then((extended) => {
          if (!extended) {
            renewalFailure = new Error(`Analysis lock ownership was lost: ${lock.key}`);
          }
        })
        .catch((error: unknown) => {
          renewalFailure = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          renewalPromise = undefined;
        });
    };

    const renewalTimer = setInterval(renewLock, ANALYSIS_LOCK_RENEW_INTERVAL_MS);

    /*
     * The renewal timer should not keep the
     * entire Node process alive by itself.
     */
    renewalTimer.unref();

    try {
      const result = await processValidatedAnalysisJob(job, data);

      /*
       * If a renewal is currently running,
       * wait for it before deciding whether the
       * analysis completed while still owning
       * its lock.
       */
      if (renewalPromise) {
        await renewalPromise;
      }

      if (renewalFailure) {
        throw renewalFailure;
      }

      return result;
    } finally {
      clearInterval(renewalTimer);

      /*
       * If renewal happened to already be in
       * progress when analysis finished, allow
       * that Redis operation to settle before
       * releasing the lock.
       */
      if (renewalPromise) {
        await renewalPromise.catch(() => undefined);
      }

      /*
       * release() checks the ownership token.
       *
       * If ownership was lost, it safely returns
       * false instead of deleting somebody
       * else's lock.
       *
       * If Redis itself is unavailable, the TTL
       * remains our final safety mechanism.
       */
      await lock.release().catch(() => false);
    }
  };
}
