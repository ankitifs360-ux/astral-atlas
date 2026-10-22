import {
  ANALYSIS_QUEUE_NAME,
  type ANALYSIS_JOB_NAME,
  type AnalysisJobData,
  type AnalysisJobResult,
} from '@astral-atlas/shared';
import { Worker, type Job } from 'bullmq';

import type { Redis } from 'ioredis';

export type AnalysisJob = Job<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

export type AnalysisJobProcessor = (job: AnalysisJob) => Promise<AnalysisJobResult>;

export type AnalysisWorker = Worker<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>;

export function createAnalysisWorker(
  redis: Redis,
  processor: AnalysisJobProcessor,
): AnalysisWorker {
  return new Worker<AnalysisJobData, AnalysisJobResult, typeof ANALYSIS_JOB_NAME>(
    ANALYSIS_QUEUE_NAME,
    processor,
    {
      /*
       * BullMQ Worker may reuse this connection,
       * and internally creates a duplicated
       * blocking connection as needed.
       */
      connection: redis,

      /*
       * Start with one repository analysis at
       * a time per worker process.
       *
       * Later the analysis itself will use
       * worker_threads for CPU-heavy parsing.
       */
      concurrency: 1,

      /*
       * Do not start consuming jobs immediately.
       *
       * Our worker entrypoint will:
       *
       * 1. create the worker
       * 2. attach logging/error listeners
       * 3. then call worker.run()
       *
       * That avoids processing a job before
       * startup hooks are ready.
       */
      autorun: false,
    },
  );
}
