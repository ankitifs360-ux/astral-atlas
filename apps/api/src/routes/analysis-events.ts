import type { ServerResponse } from 'node:http';

import { Type } from 'typebox';

import type { FastifyInstance } from 'fastify';

import type { AnalysisEventHub, AnalysisStreamEvent } from '../queues/analysis-event-hub.js';

const AnalysisEventsParamsSchema = Type.Object({
  analysisId: Type.String({
    format: 'uuid',
  }),
});

interface AnalysisEventsParams {
  analysisId: string;
}

function writeSseEvent(response: ServerResponse, eventName: string, data: unknown): void {
  response.write(`event: ${eventName}\n`);

  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerAnalysisEventsRoute(
  app: FastifyInstance,
  eventHub: AnalysisEventHub,
): void {
  app.get<{
    Params: AnalysisEventsParams;
  }>(
    '/api/analyses/:analysisId/events',
    {
      schema: {
        params: AnalysisEventsParamsSchema,
      },
    },
    (request, reply) => {
      const { analysisId } = request.params;

      reply.hijack();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',

        'Cache-Control': 'no-cache, no-transform',

        Connection: 'keep-alive',

        'X-Accel-Buffering': 'no',
      });

      writeSseEvent(reply.raw, 'connected', {
        analysisId,
      });

      let closed = false;

      /*
       * Function declarations allow cleanup()
       * and handleEvent() to reference each
       * other safely without empty placeholder
       * functions.
       */
      function cleanup(): void {
        if (closed) {
          return;
        }

        closed = true;

        unsubscribe();

        clearInterval(heartbeat);
      }

      function handleEvent(event: AnalysisStreamEvent): void {
        if (closed) {
          return;
        }

        writeSseEvent(reply.raw, event.type, event.data);

        if (event.type === 'completed' || event.type === 'failed') {
          cleanup();

          reply.raw.end();
        }
      }

      /*
       * BullMQ jobId = analysisId.
       */
      const unsubscribe = eventHub.subscribe(analysisId, handleEvent);

      /*
       * SSE heartbeat prevents proxies from
       * treating the connection as idle.
       */
      const heartbeat = setInterval(() => {
        if (closed || reply.raw.destroyed) {
          return;
        }

        reply.raw.write(': heartbeat\n\n');
      }, 15_000);

      heartbeat.unref();

      /*
       * Browser closed the tab or network
       * connection disappeared.
       */
      reply.raw.once('close', cleanup);
    },
  );
}
