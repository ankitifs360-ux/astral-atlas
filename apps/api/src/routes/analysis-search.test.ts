import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { AnalysisSearchResponse } from '@astral-atlas/shared';

import { registerAnalysisSearchRoute, type AnalysisSearchReader } from './analysis-search.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

function createSearchResponse(): AnalysisSearchResponse {
  return {
    analysisId: ANALYSIS_ID,

    query: 'server',

    files: [
      {
        type: 'file',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        path: 'src/server.ts',
        language: 'typescript',
        isSupported: true,
        parseStatus: 'analyzed',
      },
    ],

    symbols: [
      {
        type: 'symbol',
        symbolId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filePath: 'src/server.ts',
        kind: 'function',
        name: 'startServer',
        qualifiedName: 'startServer',
        startLine: 5,
        startColumn: 0,
        endLine: 12,
        endColumn: 1,
        isExported: true,
        complexity: 3,
      },
    ],
  };
}

function createReader(overrides: Partial<AnalysisSearchReader> = {}): AnalysisSearchReader {
  return {
    search: vi.fn(async () => createSearchResponse()),

    ...overrides,
  };
}

async function createApp(reader: AnalysisSearchReader) {
  const app = Fastify();

  registerAnalysisSearchRoute(app, reader);

  await app.ready();

  return app;
}

describe('analysis search route', () => {
  it('returns file and symbol search matches', async () => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=server`,
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual(createSearchResponse());

      expect(reader.search).toHaveBeenCalledTimes(1);

      expect(reader.search).toHaveBeenCalledWith(ANALYSIS_ID, 'server', undefined);
    } finally {
      await app.close();
    }
  });

  it('trims the search query before calling the store', async () => {
    const reader = createReader({
      search: vi.fn(async (_analysisId, query) => ({
        ...createSearchResponse(),
        query,
      })),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=%20%20server%20%20`,
      });

      expect(response.statusCode).toBe(200);

      expect(reader.search).toHaveBeenCalledWith(ANALYSIS_ID, 'server', undefined);

      expect(response.json()).toEqual({
        ...createSearchResponse(),
        query: 'server',
      });
    } finally {
      await app.close();
    }
  });

  it('passes the optional result limit to the store', async () => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=server&limit=25`,
      });

      expect(response.statusCode).toBe(200);

      expect(reader.search).toHaveBeenCalledWith(ANALYSIS_ID, 'server', 25);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the completed analysis does not exist', async () => {
    const reader = createReader({
      search: vi.fn(async () => null),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=server`,
      });

      expect(response.statusCode).toBe(404);

      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Completed analysis was not found.',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('rejects a whitespace-only search query before calling the store', async () => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=%20%20%20`,
      });

      expect(response.statusCode).toBe(400);

      expect(response.json()).toEqual({
        error: {
          code: 'BAD_REQUEST',
          message: 'Search query cannot be empty.',
        },
      });

      expect(reader.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects a missing search query', async () => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search`,
      });

      expect(response.statusCode).toBe(400);

      expect(reader.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an invalid analysis UUID', async () => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/analyses/not-a-uuid/search?q=server',
      });

      expect(response.statusCode).toBe(400);

      expect(reader.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      label: 'zero',
      limit: '0',
    },
    {
      label: 'too large',
      limit: '101',
    },
    {
      label: 'fractional',
      limit: '1.5',
    },
  ])('rejects a $label search limit before calling the store', async ({ limit }) => {
    const reader = createReader();

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/search?q=server&limit=${limit}`,
      });

      expect(response.statusCode).toBe(400);

      expect(reader.search).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
