import { Type } from 'typebox';

import type { FastifyInstance } from 'fastify';

import type { AnalysisSearchResponse } from '@astral-atlas/shared';

const AnalysisSearchParamsSchema = Type.Object({
  analysisId: Type.String({
    format: 'uuid',
  }),
});

const AnalysisSearchQuerySchema = Type.Object({
  q: Type.String({
    minLength: 1,
    maxLength: 200,
  }),

  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
    }),
  ),
});

interface AnalysisSearchParams {
  analysisId: string;
}

interface AnalysisSearchQuery {
  q: string;
  limit?: number;
}

export interface AnalysisSearchReader {
  search(analysisId: string, query: string, limit?: number): Promise<AnalysisSearchResponse | null>;
}

function errorBody(code: string, message: string) {
  return {
    error: {
      code,
      message,
    },
  };
}

export function registerAnalysisSearchRoute(
  app: FastifyInstance,
  searchStore: AnalysisSearchReader,
): void {
  app.get<{
    Params: AnalysisSearchParams;
    Querystring: AnalysisSearchQuery;
  }>(
    '/api/analyses/:analysisId/search',
    {
      schema: {
        params: AnalysisSearchParamsSchema,
        querystring: AnalysisSearchQuerySchema,
      },
    },
    async (request, reply) => {
      const normalizedQuery = request.query.q.trim();

      if (normalizedQuery.length === 0) {
        return reply.code(400).send(errorBody('BAD_REQUEST', 'Search query cannot be empty.'));
      }

      const result = await searchStore.search(
        request.params.analysisId,
        normalizedQuery,
        request.query.limit,
      );

      if (result === null) {
        return reply.code(404).send(errorBody('NOT_FOUND', 'Completed analysis was not found.'));
      }

      return reply.send(result);
    },
  );
}
