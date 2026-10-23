import { Type } from 'typebox';

import type { FastifyInstance } from 'fastify';

import type {
  AnalysisFileDetailResponse,
  AnalysisGraphResponse,
  AnalysisPathfinderResponse,
} from '@astral-atlas/shared';

const AnalysisIdParamsSchema = Type.Object({
  analysisId: Type.String({
    format: 'uuid',
  }),
});

const AnalysisFileParamsSchema = Type.Object({
  analysisId: Type.String({
    format: 'uuid',
  }),

  fileId: Type.String({
    format: 'uuid',
  }),
});

interface AnalysisIdParams {
  analysisId: string;
}

interface AnalysisFileParams extends AnalysisIdParams {
  fileId: string;
}

export interface AnalysisResultsReader {
  getGraph(analysisId: string): Promise<AnalysisGraphResponse | null>;

  getFileDetail(analysisId: string, fileId: string): Promise<AnalysisFileDetailResponse | null>;

  getPathfinder(analysisId: string): Promise<AnalysisPathfinderResponse | null>;
}

function notFoundBody(message: string) {
  return {
    error: {
      code: 'NOT_FOUND',
      message,
    },
  };
}

export function registerAnalysisResultsRoutes(
  app: FastifyInstance,
  resultsStore: AnalysisResultsReader,
): void {
  app.get<{
    Params: AnalysisIdParams;
  }>(
    '/api/analyses/:analysisId/graph',
    {
      schema: {
        params: AnalysisIdParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await resultsStore.getGraph(request.params.analysisId);

      if (result === null) {
        return reply.code(404).send(notFoundBody('Completed analysis was not found.'));
      }

      return reply.send(result);
    },
  );

  app.get<{
    Params: AnalysisFileParams;
  }>(
    '/api/analyses/:analysisId/files/:fileId',
    {
      schema: {
        params: AnalysisFileParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await resultsStore.getFileDetail(
        request.params.analysisId,
        request.params.fileId,
      );

      if (result === null) {
        return reply.code(404).send(notFoundBody('Analysis file was not found.'));
      }

      return reply.send(result);
    },
  );

  app.get<{
    Params: AnalysisIdParams;
  }>(
    '/api/analyses/:analysisId/pathfinder',
    {
      schema: {
        params: AnalysisIdParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await resultsStore.getPathfinder(request.params.analysisId);

      if (result === null) {
        return reply.code(404).send(notFoundBody('Completed analysis was not found.'));
      }

      return reply.send(result);
    },
  );
}
