import { type AnalysisJobResult, type AnalysisProgress } from '@astral-atlas/shared';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AnalysisEventHub,
  connectAnalysisQueueEvents,
  type AnalysisStreamEvent,
} from './analysis-event-hub.js';

import type { AnalysisQueueEvents } from './analysis-events.js';

type EventHandler = (payload: unknown) => void;

function createQueueEventsMock() {
  const handlers = new Map<string, Set<EventHandler>>();

  const queueEvents = {
    on: vi.fn((eventName: string, handler: EventHandler) => {
      let eventHandlers = handlers.get(eventName);

      if (!eventHandlers) {
        eventHandlers = new Set();

        handlers.set(eventName, eventHandlers);
      }

      eventHandlers.add(handler);

      return queueEvents;
    }),

    off: vi.fn((eventName: string, handler: EventHandler) => {
      handlers.get(eventName)?.delete(handler);

      return queueEvents;
    }),
  } as unknown as AnalysisQueueEvents;

  function emit(eventName: string, payload: unknown): void {
    for (const handler of [...(handlers.get(eventName) ?? [])]) {
      handler(payload);
    }
  }

  return {
    queueEvents,
    emit,
  };
}

describe('AnalysisEventHub', () => {
  let eventHub: AnalysisEventHub;

  beforeEach(() => {
    eventHub = new AnalysisEventHub();
  });

  it('publishes an event to subscribers for the matching job', () => {
    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    const event: AnalysisStreamEvent = {
      type: 'failed',

      jobId: 'analysis-1',

      data: {
        reason: 'Something failed',
      },
    };

    eventHub.publish(event);

    expect(listener).toHaveBeenCalledTimes(1);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('does not publish events to a different job subscriber', () => {
    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    eventHub.publish({
      type: 'failed',

      jobId: 'analysis-2',

      data: {
        reason: 'Failure',
      },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple subscribers for the same job', () => {
    const firstListener = vi.fn();

    const secondListener = vi.fn();

    eventHub.subscribe('analysis-1', firstListener);

    eventHub.subscribe('analysis-1', secondListener);

    expect(eventHub.subscriberCount('analysis-1')).toBe(2);

    const event: AnalysisStreamEvent = {
      type: 'failed',

      jobId: 'analysis-1',

      data: {
        reason: 'Failure',
      },
    };

    eventHub.publish(event);

    expect(firstListener).toHaveBeenCalledWith(event);

    expect(secondListener).toHaveBeenCalledWith(event);
  });

  it('removes a subscriber when unsubscribe is called', () => {
    const listener = vi.fn();

    const unsubscribe = eventHub.subscribe('analysis-1', listener);

    expect(eventHub.subscriberCount('analysis-1')).toBe(1);

    unsubscribe();

    expect(eventHub.subscriberCount('analysis-1')).toBe(0);

    eventHub.publish({
      type: 'failed',

      jobId: 'analysis-1',

      data: {
        reason: 'Failure',
      },
    });

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('connectAnalysisQueueEvents', () => {
  it('forwards valid progress events to the event hub', () => {
    const { queueEvents, emit } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    connectAnalysisQueueEvents(queueEvents, eventHub);

    const progress: AnalysisProgress = {
      analysisId: 'analysis-1',

      stage: 'ingesting',

      percent: 5,

      message: 'Worker accepted the analysis job.',

      timestamp: new Date().toISOString(),
    };

    emit('progress', {
      jobId: 'analysis-1',

      data: progress,
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'progress',

      jobId: 'analysis-1',

      data: progress,
    });
  });

  it('ignores malformed progress events', () => {
    const { queueEvents, emit } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    connectAnalysisQueueEvents(queueEvents, eventHub);

    emit('progress', {
      jobId: 'analysis-1',

      data: {
        analysisId: 'analysis-1',

        stage: 'not-a-real-stage',

        percent: 500,
      },
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards valid completed events', () => {
    const { queueEvents, emit } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    connectAnalysisQueueEvents(queueEvents, eventHub);

    const result: AnalysisJobResult = {
      analysisId: 'analysis-1',

      status: 'partial',
    };

    emit('completed', {
      jobId: 'analysis-1',

      returnvalue: JSON.stringify(result),
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'completed',

      jobId: 'analysis-1',

      data: result,
    });
  });

  it('ignores invalid completed return values', () => {
    const { queueEvents, emit } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    connectAnalysisQueueEvents(queueEvents, eventHub);

    emit('completed', {
      jobId: 'analysis-1',

      returnvalue: 'not-json',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('forwards failed events', () => {
    const { queueEvents, emit } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const listener = vi.fn();

    eventHub.subscribe('analysis-1', listener);

    connectAnalysisQueueEvents(queueEvents, eventHub);

    emit('failed', {
      jobId: 'analysis-1',

      failedReason: 'Repository clone failed',
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'failed',

      jobId: 'analysis-1',

      data: {
        reason: 'Repository clone failed',
      },
    });
  });

  it('disconnects all QueueEvents listeners', () => {
    const { queueEvents } = createQueueEventsMock();

    const eventHub = new AnalysisEventHub();

    const disconnect = connectAnalysisQueueEvents(queueEvents, eventHub);

    disconnect();

    expect(queueEvents.off).toHaveBeenCalledTimes(3);

    expect(queueEvents.off).toHaveBeenCalledWith('progress', expect.any(Function));

    expect(queueEvents.off).toHaveBeenCalledWith('completed', expect.any(Function));

    expect(queueEvents.off).toHaveBeenCalledWith('failed', expect.any(Function));
  });
});
