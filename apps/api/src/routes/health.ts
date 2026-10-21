import type { FastifyInstance } from 'fastify';
import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
    timestamp: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

const ReadyResponseSchema = Type.Object(
  {
    status: Type.Literal('ready'),

    checks: Type.Object(
      {
        database: Type.Literal('up'),
      },
      {
        additionalProperties: false,
      },
    ),

    timestamp: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

const NotReadyResponseSchema = Type.Object(
  {
    status: Type.Literal('not_ready'),

    checks: Type.Object(
      {
        database: Type.Literal('down'),
      },
      {
        additionalProperties: false,
      },
    ),

    timestamp: Type.String(),
  },
  {
    additionalProperties: false,
  },
);

export async function registerHealthRoutes(
  app: FastifyInstance,
  readinessProbe: () => Promise<void>,
): Promise<void> {
  const typedApp = app.withTypeProvider<TypeBoxTypeProvider>();

  typedApp.get(
    '/health',
    {
      config: {
        rateLimit: false,
      },

      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => {
      return {
        status: 'ok' as const,
        timestamp: new Date().toISOString(),
      };
    },
  );

  typedApp.get(
    '/ready',
    {
      config: {
        rateLimit: false,
      },

      schema: {
        response: {
          200: ReadyResponseSchema,
          503: NotReadyResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await readinessProbe();

        return {
          status: 'ready' as const,

          checks: {
            database: 'up' as const,
          },

          timestamp: new Date().toISOString(),
        };
      } catch (error: unknown) {
        request.log.warn(
          {
            err: error,
          },
          'Readiness probe failed',
        );

        return reply.status(503).send({
          status: 'not_ready',

          checks: {
            database: 'down',
          },

          timestamp: new Date().toISOString(),
        });
      }
    },
  );
}
