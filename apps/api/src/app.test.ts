import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { buildApp } from './app.js';
import type { ApiConfig } from './config.js';

import { AnalysisEventHub } from './queues/analysis-event-hub.js';

function createTestConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    nodeEnv: 'test',

    databaseUrl: 'postgresql://test:test@127.0.0.1:5432/test',

    host: '127.0.0.1',

    port: 3000,

    logLevel: 'silent',

    corsOrigins: ['http://localhost:5173'],

    rateLimitMax: 1_000,

    trustProxy: false,

    redis: {
      host: '127.0.0.1',

      port: 6379,

      database: 0,

      useTls: false,
    },

    ...overrides,
  };
}

/*
 * These app-level tests exercise health, readiness,
 * validation, not-found, rate-limit and OpenAPI behavior.
 *
 * None of them call the completed-analysis routes, so a
 * lightweight typed database stub is sufficient here.
 *
 * Dedicated analysis-results store tests cover actual
 * database query behavior separately.
 */
function createTestDatabase(): Database {
  return {} as Database;
}

describe('Fastify API', () => {
  it('returns liveness health', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    try {
      const response = await app.inject({
        method: 'GET',

        url: '/health',
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        status: 'ok',
      });
    } finally {
      await app.close();
    }
  });

  it('reports ready when dependencies are healthy', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    try {
      const response = await app.inject({
        method: 'GET',

        url: '/ready',
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toMatchObject({
        status: 'ready',

        checks: {
          database: 'up',

          redis: 'up',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('reports not ready when dependencies are unavailable', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => {
        throw new Error('Dependencies unavailable');
      },

      logger: false,
    });

    try {
      const response = await app.inject({
        method: 'GET',

        url: '/ready',
      });

      expect(response.statusCode).toBe(503);

      expect(response.json()).toMatchObject({
        status: 'not_ready',

        checks: {
          database: 'down',

          redis: 'down',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns standardized validation errors', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    app.post(
      '/test/validation',
      {
        schema: {
          body: Type.Object(
            {
              name: Type.String({
                minLength: 1,
              }),
            },
            {
              additionalProperties: false,
            },
          ),
        },
      },
      async () => {
        return {
          ok: true,
        };
      },
    );

    try {
      const response = await app.inject({
        method: 'POST',

        url: '/test/validation',

        payload: {},
      });

      expect(response.statusCode).toBe(400);

      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns standardized 404 errors', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    try {
      const response = await app.inject({
        method: 'GET',

        url: '/this-route-does-not-exist',
      });

      expect(response.statusCode).toBe(404);

      expect(response.json()).toMatchObject({
        error: {
          code: 'NOT_FOUND',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('rate limits excessive requests', async () => {
    const app = await buildApp({
      config: createTestConfig({
        rateLimitMax: 2,
      }),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    app.get('/test/rate-limit', async () => {
      return {
        ok: true,
      };
    });

    try {
      const first = await app.inject({
        method: 'GET',

        url: '/test/rate-limit',
      });

      const second = await app.inject({
        method: 'GET',

        url: '/test/rate-limit',
      });

      const third = await app.inject({
        method: 'GET',

        url: '/test/rate-limit',
      });

      expect(first.statusCode).toBe(200);

      expect(second.statusCode).toBe(200);

      expect(third.statusCode).toBe(429);

      expect(third.json()).toMatchObject({
        error: {
          code: 'RATE_LIMITED',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('serves OpenAPI documentation for the public API', async () => {
    const app = await buildApp({
      config: createTestConfig(),

      database: createTestDatabase(),

      analysisEventHub: new AnalysisEventHub(),

      readinessProbe: async () => ({
        database: 'up',

        redis: 'up',
      }),

      logger: false,
    });

    try {
      /*
       * Verify the interactive Swagger UI itself is available.
       */
      const uiResponse = await app.inject({
        method: 'GET',

        url: '/docs/',
      });

      expect(uiResponse.statusCode).toBe(200);

      expect(uiResponse.headers['content-type']).toContain('text/html');

      /*
       * Verify the generated OpenAPI document contains
       * Astral Atlas metadata and its important public routes.
       */
      const jsonResponse = await app.inject({
        method: 'GET',

        url: '/docs/json',
      });

      expect(jsonResponse.statusCode).toBe(200);

      expect(jsonResponse.json()).toMatchObject({
        openapi: '3.1.0',

        info: {
          title: 'Astral Atlas API',

          version: '0.1.0',
        },

        paths: {
          '/health': {},

          '/ready': {},

          '/api/analyses/{analysisId}/graph': {},

          '/api/analyses/{analysisId}/files/{fileId}': {},

          '/api/analyses/{analysisId}/search': {},

          '/api/analyses/{analysisId}/pathfinder': {},

          '/api/analyses/{analysisId}/newcomer-change-guidance': {},

          '/api/analyses/{analysisId}/events': {},
        },
      });

      /*
       * Swagger UI also exposes a YAML representation for
       * tooling and human-readable inspection.
       */
      const yamlResponse = await app.inject({
        method: 'GET',

        url: '/docs/yaml',
      });

      expect(yamlResponse.statusCode).toBe(200);

      expect(yamlResponse.body).toContain('Astral Atlas API');
    } finally {
      await app.close();
    }
  });
});
