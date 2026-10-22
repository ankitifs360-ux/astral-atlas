import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { describe, expect, it, vi } from 'vitest';

import { AnalysisEventHub } from '../queues/analysis-event-hub.js';

import { registerAnalysisEventsRoute } from './analysis-events.js';

class FakeRawResponse extends EventEmitter {
  public readonly chunks: string[] = [];

  public statusCode: number | undefined;

  public headers: Record<string, string> | undefined;

  public ended = false;

  public destroyed = false;

  public writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;

    this.headers = headers;

    return this;
  }

  public write(chunk: string): boolean {
    this.chunks.push(chunk);

    return true;
  }

  public end(): this {
    this.ended = true;

    /*
     * A real HTTP response eventually emits
     * "close" when the stream is finished.
     *
     * Emitting it here also lets us verify
     * that SSE cleanup is idempotent.
     */
    this.emit('close');

    return this;
  }

  public output(): string {
    return this.chunks.join('');
  }
}

interface TestRequest {
  params: {
    analysisId: string;
  };
}

interface TestReply {
  hijack: ReturnType<typeof vi.fn>;

  raw: FakeRawResponse;
}

type AnalysisEventsHandler = (request: TestRequest, reply: TestReply) => void;

function createRouteHarness() {
  const eventHub = new AnalysisEventHub();

  const get = vi.fn();

  const app = {
    get,
  } as unknown as FastifyInstance;

  registerAnalysisEventsRoute(app, eventHub);

  const handler = get.mock.calls[0]?.[2] as AnalysisEventsHandler | undefined;

  if (!handler) {
    throw new Error('Analysis SSE route handler was not registered.');
  }

  return {
    eventHub,
    get,
    handler,
  };
}

function createReply() {
  const raw = new FakeRawResponse();

  const hijack = vi.fn();

  const reply: TestReply = {
    hijack,
    raw,
  };

  return {
    reply,
    raw,
    hijack,
  };
}

describe('registerAnalysisEventsRoute', () => {
  it('registers the analysis SSE endpoint', () => {
    const { get } = createRouteHarness();

    expect(get).toHaveBeenCalledTimes(1);

    expect(get).toHaveBeenCalledWith(
      '/api/analyses/:analysisId/events',
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('opens an SSE connection and subscribes to the analysis', () => {
    const { eventHub, handler } = createRouteHarness();

    const { reply, raw, hijack } = createReply();

    const analysisId = randomUUID();

    handler(
      {
        params: {
          analysisId,
        },
      },
      reply,
    );

    expect(hijack).toHaveBeenCalledTimes(1);

    expect(raw.statusCode).toBe(200);

    expect(raw.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'text/event-stream; charset=utf-8',

        'Cache-Control': 'no-cache, no-transform',

        Connection: 'keep-alive',

        'X-Accel-Buffering': 'no',
      }),
    );

    expect(raw.output()).toContain('event: connected\n');

    expect(raw.output()).toContain(
      `data: ${JSON.stringify({
        analysisId,
      })}\n\n`,
    );

    expect(eventHub.subscriberCount(analysisId)).toBe(1);

    /*
     * Simulate the browser disconnecting so
     * the heartbeat timer and subscription
     * are both cleaned up.
     */
    raw.emit('close');

    expect(eventHub.subscriberCount(analysisId)).toBe(0);
  });

  it('streams progress events to the connected client', () => {
    const { eventHub, handler } = createRouteHarness();

    const { reply, raw } = createReply();

    const analysisId = randomUUID();

    handler(
      {
        params: {
          analysisId,
        },
      },
      reply,
    );

    eventHub.publish({
      type: 'progress',

      jobId: analysisId,

      data: {
        analysisId,

        stage: 'ingesting',

        percent: 5,

        message: 'Worker accepted the analysis job.',

        timestamp: '2026-10-22T08:00:00.000Z',
      },
    });

    expect(raw.output()).toContain('event: progress\n');

    expect(raw.output()).toContain('"stage":"ingesting"');

    expect(raw.output()).toContain('"percent":5');

    expect(raw.ended).toBe(false);

    raw.emit('close');
  });

  it('streams completed and closes the SSE connection', () => {
    const { eventHub, handler } = createRouteHarness();

    const { reply, raw } = createReply();

    const analysisId = randomUUID();

    handler(
      {
        params: {
          analysisId,
        },
      },
      reply,
    );

    expect(eventHub.subscriberCount(analysisId)).toBe(1);

    eventHub.publish({
      type: 'completed',

      jobId: analysisId,

      data: {
        analysisId,

        status: 'partial',
      },
    });

    expect(raw.output()).toContain('event: completed\n');

    expect(raw.output()).toContain('"status":"partial"');

    expect(raw.ended).toBe(true);

    expect(eventHub.subscriberCount(analysisId)).toBe(0);
  });

  it('streams failed and closes the SSE connection', () => {
    const { eventHub, handler } = createRouteHarness();

    const { reply, raw } = createReply();

    const analysisId = randomUUID();

    handler(
      {
        params: {
          analysisId,
        },
      },
      reply,
    );

    eventHub.publish({
      type: 'failed',

      jobId: analysisId,

      data: {
        reason: 'Repository clone failed',
      },
    });

    expect(raw.output()).toContain('event: failed\n');

    expect(raw.output()).toContain('"reason":"Repository clone failed"');

    expect(raw.ended).toBe(true);

    expect(eventHub.subscriberCount(analysisId)).toBe(0);
  });

  it('removes the subscription when the client disconnects', () => {
    const { eventHub, handler } = createRouteHarness();

    const { reply, raw } = createReply();

    const analysisId = randomUUID();

    handler(
      {
        params: {
          analysisId,
        },
      },
      reply,
    );

    expect(eventHub.subscriberCount(analysisId)).toBe(1);

    raw.emit('close');

    expect(eventHub.subscriberCount(analysisId)).toBe(0);

    /*
     * Publishing after disconnect must not
     * write any additional SSE data.
     */
    const outputBefore = raw.output();

    eventHub.publish({
      type: 'progress',

      jobId: analysisId,

      data: {
        analysisId,

        stage: 'parsing',

        percent: 25,

        message: 'Parsing files',

        timestamp: '2026-10-22T08:00:00.000Z',
      },
    });

    expect(raw.output()).toBe(outputBefore);
  });
});
