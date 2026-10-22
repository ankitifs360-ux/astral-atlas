import { Type } from 'typebox';
import type { FastifyInstance } from 'fastify';

export type DependencyStatus = 'up' | 'down';

export interface ReadinessCheckResult {
  database: DependencyStatus;
  redis: DependencyStatus;
}

export type ReadinessProbe = () => Promise<ReadinessCheckResult>;

const DependencyStatusSchema = Type.Union([Type.Literal('up'), Type.Literal('down')]);

const HealthResponseSchema = Type.Object({
  status: Type.Literal('ok'),

  timestamp: Type.String({
    format: 'date-time',
  }),
});

const ReadinessResponseSchema = Type.Object({
  status: Type.Union([Type.Literal('ready'), Type.Literal('not_ready')]),

  checks: Type.Object({
    database: DependencyStatusSchema,

    redis: DependencyStatusSchema,
  }),

  timestamp: Type.String({
    format: 'date-time',
  }),
});

export async function registerHealthRoutes(
  app: FastifyInstance,
  readinessProbe: ReadinessProbe,
): Promise<void> {
  app.get(
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

  app.get(
    '/ready',
    {
      config: {
        rateLimit: false,
      },

      schema: {
        response: {
          200: ReadinessResponseSchema,

          503: ReadinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      let checks: ReadinessCheckResult;

      try {
        checks = await readinessProbe();
      } catch {
        /*
         * Unexpected failure in the readiness
         * implementation itself.
         */
        checks = {
          database: 'down',
          redis: 'down',
        };
      }

      const ready = checks.database === 'up' && checks.redis === 'up';

      const response = {
        status: ready ? ('ready' as const) : ('not_ready' as const),

        checks,

        timestamp: new Date().toISOString(),
      };

      if (!ready) {
        return reply.status(503).send(response);
      }

      return reply.status(200).send(response);
    },
  );
}
