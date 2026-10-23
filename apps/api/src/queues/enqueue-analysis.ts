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

/**
 * Requeues an analysis that previously reached a terminal BullMQ state.
 *
 * BullMQ keeps completed and failed jobs according to the queue retention
 * policy. While one of those retained jobs still exists, adding another job
 * with the same jobId is treated as a duplicate.
 *
 * We therefore remove only a terminal job before reusing the stable
 * analysisId. Active/waiting/delayed jobs are never removed because doing so
 * could create duplicate analysis work.
 */
export async function requeueAnalysisJob(queue: AnalysisQueue, data: AnalysisJobData) {
  const existingJob = await queue.getJob(data.analysisId);

  if (existingJob !== undefined) {
    const state = await existingJob.getState();

    if (state !== 'completed' && state !== 'failed') {
      throw new Error(
        `Cannot requeue analysis "${data.analysisId}" because its BullMQ job is still "${state}".`,
      );
    }

    await existingJob.remove();
  }

  return enqueueAnalysisJob(queue, data);
}
