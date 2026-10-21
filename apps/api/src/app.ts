import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { ApiConfig } from './config.js';
import { AppError, createErrorResponse } from './errors.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: ApiConfig;
  readinessProbe: () => Promise<void>;
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

    bodyLimit: 1_048_576,

    requestTimeout: 30_000,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, {
    origin: options.config.corsOrigins,
    credentials: false,
  });

  await app.register(rateLimit, {
    global: true,
    max: options.config.rateLimitMax,
    timeWindow: '1 minute',
    ipv6Subnet: 64,
  });

  registerErrorHandlers(app);

  await registerHealthRoutes(app, options.readinessProbe);

  if (options.closeResources) {
    app.addHook('onClose', async () => {
      await options.closeResources?.();
    });
  }

  return app;
}
