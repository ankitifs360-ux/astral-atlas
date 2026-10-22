import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { ApiConfig } from './config.js';
import { AppError, createErrorResponse } from './errors.js';

import { INGESTION_LIMITS } from './modules/ingestion/limits.js';

import type { AnalysisEventHub } from './queues/analysis-event-hub.js';

import { registerAnalysisEventsRoute } from './routes/analysis-events.js';

import { registerHealthRoutes, type ReadinessProbe } from './routes/health.js';

export interface BuildAppOptions {
  config: ApiConfig;

  readinessProbe: ReadinessProbe;

  /*
   * The same AnalysisEventHub instance that
   * receives BullMQ QueueEvents in server.ts.
   *
   * The SSE route subscribes to this instance.
   */
  analysisEventHub: AnalysisEventHub;

  closeResources?: () => Promise<void>;

  logger?: boolean;
}

function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>(async (error, request, reply) => {
    if (error.validation) {
      const details = error.validation.map((issue) => ({
        field: issue.instancePath || issue.schemaPath || 'request',

        message: issue.message ?? 'Invalid value.',
      }));

      return reply
        .status(400)
        .send(
          createErrorResponse(
            'VALIDATION_ERROR',
            'Request validation failed.',
            request.id,
            details,
          ),
        );
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error(
          {
            err: error,
          },
          'Application error',
        );
      }

      return reply
        .status(error.statusCode)
        .send(createErrorResponse(error.code, error.message, request.id, error.details));
    }

    if (error.statusCode === 413) {
      return reply
        .status(413)
        .send(
          createErrorResponse('PAYLOAD_TOO_LARGE', 'Request payload is too large.', request.id),
        );
    }

    if (error.statusCode === 415) {
      return reply
        .status(415)
        .send(
          createErrorResponse(
            'UNSUPPORTED_MEDIA_TYPE',
            'Unsupported request content type.',
            request.id,
          ),
        );
    }

    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send(
          createErrorResponse('RATE_LIMITED', 'Too many requests. Try again later.', request.id),
        );
    }

    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send(createErrorResponse('BAD_REQUEST', error.message, request.id));
    }

    request.log.error(
      {
        err: error,
      },
      'Unhandled request error',
    );

    return reply
      .status(500)
      .send(
        createErrorResponse(
          'INTERNAL_SERVER_ERROR',
          'An unexpected internal error occurred.',
          request.id,
        ),
      );
  });

  app.setNotFoundHandler(
    {
      preHandler: app.rateLimit(),
    },
    async (request, reply) => {
      return reply
        .status(404)
        .send(createErrorResponse('NOT_FOUND', 'Route not found.', request.id));
    },
  );
}

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: options.config.logLevel,

            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },

    trustProxy: options.config.trustProxy,

    /*
     * Normal JSON requests remain limited
     * to 1 MiB.
     *
     * Multipart repository uploads use their
     * own independent limit below.
     */
    bodyLimit: 1_048_576,

    requestTimeout: 30_000,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, {
    origin: options.config.corsOrigins,

    credentials: false,
  });

  /*
   * Repository ZIP upload support.
   *
   * This enables multipart parsing only.
   *
   * Actual repository analysis must never be
   * performed inside the HTTP request handler.
   */
  await app.register(multipart, {
    limits: {
      /*
       * One repository ZIP per request.
       */
      files: 1,

      /*
       * No normal multipart text fields are
       * currently required.
       */
      fields: 0,

      /*
       * One total multipart part:
       * the repository ZIP.
       */
      parts: 1,

      /*
       * Maximum compressed archive size.
       */
      fileSize: INGESTION_LIMITS.maxArchiveBytes,
    },

    /*
     * Instead of immediately throwing when
     * Fastify reaches the file-size limit,
     * the stream is marked as truncated.
     *
     * stageZipUpload() later converts this
     * into our standardized AppError.
     */
    throwFileSizeLimit: false,
  });

  await app.register(rateLimit, {
    global: true,

    max: options.config.rateLimitMax,

    timeWindow: '1 minute',

    ipv6Subnet: 64,
  });

  registerErrorHandlers(app);

  /*
   * Basic operational endpoints.
   */
  await registerHealthRoutes(app, options.readinessProbe);

  /*
   * Long-lived Server-Sent Events endpoint:
   *
   * GET
   * /api/analyses/:analysisId/events
   *
   * This receives events from the SAME
   * AnalysisEventHub instance connected to
   * BullMQ QueueEvents in server.ts.
   */
  registerAnalysisEventsRoute(app, options.analysisEventHub);

  if (options.closeResources) {
    app.addHook('onClose', async () => {
      await options.closeResources?.();
    });
  }

  return app;
}
