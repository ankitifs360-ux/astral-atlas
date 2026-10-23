import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import type { Database } from '@astral-atlas/database';

import type { ApiConfig } from './config.js';
import { AppError, createErrorResponse } from './errors.js';

import { registerAnalysisResultsModule } from './modules/analysis-results/register-analysis-results.js';

import { registerAnalysisSubmissionModule } from './modules/analysis-submission/register-analysis-submission.js';

import type { GitHubClient } from './modules/ingestion/github-client.js';
import { INGESTION_LIMITS } from './modules/ingestion/limits.js';

import type { AnalysisEventHub } from './queues/analysis-event-hub.js';
import type { AnalysisQueue } from './queues/analysis-queue.js';

import { registerAnalysisEventsRoute } from './routes/analysis-events.js';

import { registerHealthRoutes, type ReadinessProbe } from './routes/health.js';

export interface AnalysisSubmissionDependencies {
  analysisQueue: AnalysisQueue;

  githubClient: GitHubClient;

  /**
   * Must be visible to both the API and worker.
   *
   * In Docker this will be a shared volume.
   */
  zipStagingDirectory: string;
}

export interface BuildAppOptions {
  config: ApiConfig;

  readinessProbe: ReadinessProbe;

  /*
   * PostgreSQL dependency used by:
   *
   * - completed-analysis read API
   * - analysis submission state
   */
  database: Database;

  /*
   * BullMQ QueueEvents are converted into SSE events
   * through this shared hub.
   */
  analysisEventHub: AnalysisEventHub;

  /*
   * Submission dependencies are optional here so small
   * isolated app tests do not need Redis/GitHub clients.
   *
   * server.ts will provide these in production.
   */
  analysisSubmission?: AnalysisSubmissionDependencies;

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
     * Normal JSON requests stay limited to 1 MiB.
     *
     * ZIP multipart uploads have their own larger,
     * independent limit below.
     */
    bodyLimit: 1_048_576,

    requestTimeout: 30_000,
  }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(cors, {
    origin: options.config.corsOrigins,

    credentials: false,
  });

  /*
   * Repository ZIP upload parsing.
   *
   * This only accepts and streams the upload.
   * Extraction and analysis happen in the worker.
   */
  await app.register(multipart, {
    limits: {
      /*
       * Exactly one repository ZIP.
       */
      files: 1,

      /*
       * No normal multipart text fields.
       */
      fields: 0,

      /*
       * One total multipart part.
       */
      parts: 1,

      /*
       * Maximum compressed ZIP size.
       */
      fileSize: INGESTION_LIMITS.maxArchiveBytes,
    },

    /*
     * stageZipUpload() detects the truncated stream and
     * converts it into our standardized AppError.
     */
    throwFileSizeLimit: false,
  });

  await app.register(rateLimit, {
    global: true,

    max: options.config.rateLimitMax,

    timeWindow: '1 minute',

    ipv6Subnet: 64,
  });

  /*
   * ---------------------------------------------------------
   * OpenAPI documentation
   * ---------------------------------------------------------
   *
   * Swagger must be registered before application routes so
   * its onRoute hook can discover their schemas.
   *
   * Documentation endpoints:
   *
   * GET /docs/
   * GET /docs/json
   * GET /docs/yaml
   */
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',

      info: {
        title: 'Astral Atlas API',

        description:
          'Backend API for repository ingestion, analysis progress, dependency graph exploration, search, and onboarding pathfinding.',

        version: '0.1.0',
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',

    uiConfig: {
      docExpansion: 'list',

      deepLinking: true,
    },

    /*
     * Generate a restrictive Content-Security-Policy for
     * the Swagger UI assets instead of disabling CSP.
     */
    staticCSP: true,
  });

  registerErrorHandlers(app);

  /*
   * ---------------------------------------------------------
   * Operational endpoints
   * ---------------------------------------------------------
   */
  await registerHealthRoutes(app, options.readinessProbe);

  /*
   * ---------------------------------------------------------
   * Repository submission
   * ---------------------------------------------------------
   *
   * POST /api/analyses/github
   * POST /api/analyses/zip
   *
   * The HTTP request only resolves/stages the source and
   * creates/reuses the BullMQ analysis job.
   *
   * Heavy repository analysis never happens here.
   */
  if (options.analysisSubmission !== undefined) {
    registerAnalysisSubmissionModule({
      app,

      database: options.database,

      analysisQueue: options.analysisSubmission.analysisQueue,

      githubClient: options.analysisSubmission.githubClient,

      zipStagingDirectory: options.analysisSubmission.zipStagingDirectory,
    });
  }

  /*
   * ---------------------------------------------------------
   * Completed-analysis REST API
   * ---------------------------------------------------------
   *
   * GET /api/analyses/:analysisId/graph
   * GET /api/analyses/:analysisId/files/:fileId
   * GET /api/analyses/:analysisId/search
   * GET /api/analyses/:analysisId/pathfinder
   */
  registerAnalysisResultsModule({
    app,

    database: options.database,
  });

  /*
   * ---------------------------------------------------------
   * Live analysis progress
   * ---------------------------------------------------------
   *
   * GET /api/analyses/:analysisId/events
   */
  registerAnalysisEventsRoute(app, options.analysisEventHub);

  if (options.closeResources) {
    app.addHook('onClose', async () => {
      await options.closeResources?.();
    });
  }

  return app;
}
