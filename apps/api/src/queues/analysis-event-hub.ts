import {
  type AnalysisJobResult,
  type AnalysisProgress,
  type AnalysisProgressStage,
} from '@astral-atlas/shared';

import type { AnalysisQueueEvents } from './analysis-events.js';

const ANALYSIS_PROGRESS_STAGES = new Set<AnalysisProgressStage>([
  'queued',
  'ingesting',
  'parsing',
  'resolving-imports',
  'building-graph',
  'computing-metrics',
  'deep-analysis',
  'persisting',
  'completed',
]);

export type AnalysisStreamEvent =
  | {
      type: 'progress';
      jobId: string;
      data: AnalysisProgress;
    }
  | {
      type: 'completed';
      jobId: string;
      data: AnalysisJobResult;
    }
  | {
      type: 'failed';
      jobId: string;
      data: {
        reason: string;
      };
    };

export type AnalysisEventListener = (event: AnalysisStreamEvent) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnalysisProgressStage(value: unknown): value is AnalysisProgressStage {
  return typeof value === 'string' && ANALYSIS_PROGRESS_STAGES.has(value as AnalysisProgressStage);
}

function isAnalysisProgress(value: unknown): value is AnalysisProgress {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.analysisId === 'string' &&
    isAnalysisProgressStage(value.stage) &&
    typeof value.percent === 'number' &&
    Number.isFinite(value.percent) &&
    value.percent >= 0 &&
    value.percent <= 100 &&
    typeof value.message === 'string' &&
    typeof value.timestamp === 'string'
  );
}

function isAnalysisJobResult(value: unknown): value is AnalysisJobResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.analysisId === 'string' &&
    (value.status === 'completed' || value.status === 'partial')
  );
}

function parseCompletedResult(value: unknown): AnalysisJobResult | null {
  /*
   * BullMQ may already give us the completed
   * return value as a deserialized object.
   *
   * Example:
   *
   * {
   *   analysisId: "...",
   *   status: "partial"
   * }
   */
  if (isAnalysisJobResult(value)) {
    return value;
  }

  /*
   * Also support a JSON string.
   *
   * This keeps our adapter compatible with
   * event payloads where BullMQ exposes the
   * return value in serialized form.
   */
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!isAnalysisJobResult(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export class AnalysisEventHub {
  private readonly listeners = new Map<string, Set<AnalysisEventListener>>();

  public subscribe(jobId: string, listener: AnalysisEventListener): () => void {
    let jobListeners = this.listeners.get(jobId);

    if (!jobListeners) {
      jobListeners = new Set();

      this.listeners.set(jobId, jobListeners);
    }

    jobListeners.add(listener);

    /*
     * Return an unsubscribe function.
     *
     * SSE will call this when the browser
     * closes the connection.
     */
    return () => {
      const currentListeners = this.listeners.get(jobId);

      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener);

      /*
       * Remove the empty Set completely so
       * disconnected SSE clients do not leave
       * memory behind.
       */
      if (currentListeners.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }

  public publish(event: AnalysisStreamEvent): void {
    const jobListeners = this.listeners.get(event.jobId);

    if (!jobListeners) {
      return;
    }

    /*
     * Copy the Set before iteration.
     *
     * A listener is allowed to unsubscribe
     * itself while handling an event without
     * disturbing the current iteration.
     */
    for (const listener of [...jobListeners]) {
      listener(event);
    }
  }

  public subscriberCount(jobId: string): number {
    return this.listeners.get(jobId)?.size ?? 0;
  }
}

export function connectAnalysisQueueEvents(
  queueEvents: AnalysisQueueEvents,
  eventHub: AnalysisEventHub,
): () => void {
  const handleProgress = ({ jobId, data }: { jobId: string; data: unknown }) => {
    /*
     * BullMQ progress is runtime data coming
     * through Redis.
     *
     * Validate it before exposing it to
     * application/SSE clients.
     */
    if (!isAnalysisProgress(data)) {
      return;
    }

    eventHub.publish({
      type: 'progress',

      jobId,

      data,
    });
  };

  const handleCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: unknown }) => {
    /*
     * Depending on the BullMQ event form,
     * returnvalue may already be an object or
     * may be serialized JSON.
     *
     * parseCompletedResult() supports both.
     */
    const result = parseCompletedResult(returnvalue);

    if (!result) {
      return;
    }

    eventHub.publish({
      type: 'completed',

      jobId,

      data: result,
    });
  };

  const handleFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
    eventHub.publish({
      type: 'failed',

      jobId,

      data: {
        reason: failedReason,
      },
    });
  };

  queueEvents.on('progress', handleProgress);

  queueEvents.on('completed', handleCompleted);

  queueEvents.on('failed', handleFailed);

  /*
   * server.ts calls this during shutdown
   * before QueueEvents itself is closed.
   */
  return () => {
    queueEvents.off('progress', handleProgress);

    queueEvents.off('completed', handleCompleted);

    queueEvents.off('failed', handleFailed);
  };
}
