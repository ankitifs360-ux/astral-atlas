import { ANALYSIS_JOB_NAME, type AnalysisJobData } from '@astral-atlas/shared';

import type { AnalysisQueue } from './analysis-queue.js';

export function enqueueAnalysisJob(queue: AnalysisQueue, data: AnalysisJobData) {
  /*
   * We deliberately use:
   *
   * BullMQ jobId = analysisId
   *
   * This gives the whole system one stable ID:
   *
   * PostgreSQL analysis
   *        =
   * BullMQ job
   *        =
   * SSE subscription
   */
  return queue.add(ANALYSIS_JOB_NAME, data, {
    jobId: data.analysisId,
  });
}
