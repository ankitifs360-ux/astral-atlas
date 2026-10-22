import {
  ANALYSIS_QUEUE_NAME,
  type ANALYSIS_JOB_NAME,
  type AnalysisJobData,
  type AnalysisJobResult,
} from '@astral-atlas/shared';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export type AnalysisQueue = Queue<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

export function createAnalysisQueue(redis: Redis): AnalysisQueue {
  return new Queue<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>(
    ANALYSIS_QUEUE_NAME,
    {
      connection: redis,

      defaultJobOptions: {
        /*
         * One initial attempt + two retries.
         */
        attempts: 3,

        /*
         * Temporary failures wait progressively
         * longer before being retried.
         */
        backoff: {
          type: 'exponential',
          delay: 2_000,
        },

        /*
         * Completed jobs do not need to remain
         * permanently in Redis because PostgreSQL
         * will store our permanent analysis data.
         */
        removeOnComplete: {
          age: 60 * 60,
          count: 1_000,
        },

        /*
         * Keep failed jobs longer because they are
         * useful for debugging production failures.
         */
        removeOnFail: {
          age: 7 * 24 * 60 * 60,
          count: 5_000,
        },
      },
    },
  );
}
