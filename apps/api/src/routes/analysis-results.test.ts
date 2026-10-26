import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type {
  AnalysisFileDetailResponse,
  AnalysisGraphResponse,
  AnalysisPathfinderResponse,
} from '@astral-atlas/shared';

import { registerAnalysisResultsRoutes, type AnalysisResultsReader } from './analysis-results.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TARGET_FILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function createGraphResponse(): AnalysisGraphResponse {
  return {
    analysis: {
      id: ANALYSIS_ID,
      repositoryId: '22222222-2222-2222-2222-222222222222',
      commitSha: 'a'.repeat(40),
      status: 'completed',
      warningCount: 0,
      fileCount: 1,
      createdAt: '2026-10-23T00:00:00.000Z',
      startedAt: '2026-10-23T00:00:01.000Z',
      completedAt: '2026-10-23T00:00:02.000Z',
    },

    summary: {
      fileCount: 1,
      internalDependencyCount: 0,
      externalImportCount: 0,
      unresolvedImportCount: 0,
      cyclicComponentCount: 0,
      cyclicFileCount: 0,
      totalCyclomaticComplexity: 1,
      averageCyclomaticComplexity: 1,
      maxCyclomaticComplexity: 1,
      historyAvailable: false,
      totalChangedCommitCount: null,
      averageChangedCommitCount: null,
      maxChangedCommitCount: null,
    },

    health: {
      score: 100,
      rating: 'excellent',
      analyzedFileCount: 1,
      dimensions: [],
    },

    nodes: [
      {
        id: FILE_ID,
        path: 'src/server.ts',
        language: 'typescript',
        sizeBytes: 42,
        isSupported: true,
        parseStatus: 'analyzed',
        metrics: null,
      },
    ],

    edges: [],
  };
}

function createFileDetailResponse(): AnalysisFileDetailResponse {
  return {
    analysisId: ANALYSIS_ID,

    file: {
      id: FILE_ID,
      path: 'src/server.ts',
      language: 'typescript',
      sizeBytes: 42,
      isSupported: true,
      parseStatus: 'analyzed',
      metrics: null,
    },

    sourceContent: 'export const server = true;\n',

    symbols: [
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        fileId: FILE_ID,
        filePath: 'src/server.ts',
        kind: 'variable',
        name: 'server',
        qualifiedName: 'server',
        startLine: 1,
        startColumn: 13,
        endLine: 1,
        endColumn: 19,
        isExported: true,
        complexity: null,
      },
    ],

    outgoingEdges: [
      {
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        sourceFileId: FILE_ID,
        sourcePath: 'src/server.ts',
        targetFileId: TARGET_FILE_ID,
        targetPath: 'src/service.ts',
        fromSymbolId: null,
        toSymbolId: null,
        type: 'import',
        weight: 1,
        isDynamic: false,
      },
    ],

    incomingEdges: [],

    findings: [],
  };
}

function createPathfinderResponse(): AnalysisPathfinderResponse {
  return {
    analysisId: ANALYSIS_ID,
    consideredFileCount: 1,
    maxSteps: 10,
    steps: [
      {
        order: 1,
        filePath: 'src/server.ts',
        score: 50,
        signals: [
          {
            kind: 'entry-point',
            weight: 50,
            description: 'Likely repository entry point.',
          },
        ],
      },
    ],
  };
}

function createNewcomerChangeGuidanceResponse() {
  return {
    analysisId: ANALYSIS_ID,

    consideredFileCount: 2,

    maxRecommendations: 5,

    recommendations: [
      {
        filePath: 'src/server.ts',

        safetyScore: 100,

        riskLevel: 'low' as const,

        blastRadius: 0,

        blastMaxDistance: 0,

        reviewFilePaths: [],

        signals: [],
      },

      {
        filePath: 'src/service.ts',

        safetyScore: 65,

        riskLevel: 'medium' as const,

        blastRadius: 1,

        blastMaxDistance: 1,

        reviewFilePaths: ['src/server.ts'],

        signals: [
          {
            kind: 'blast-radius' as const,

            description: 'One dependent file should be reviewed before changing this file.',
          },
        ],
      },
    ],
  };
}

function createReader(overrides: Partial<AnalysisResultsReader> = {}): AnalysisResultsReader {
  return {
    getGraph: vi.fn(async () => createGraphResponse()),

    getFileDetail: vi.fn(async () => createFileDetailResponse()),

    getPathfinder: vi.fn(async () => createPathfinderResponse()),

    getNewcomerChangeGuidance: vi.fn(async () => createNewcomerChangeGuidanceResponse()),

    ...overrides,
  };
}

async function createApp(reader: AnalysisResultsReader) {
  const app = Fastify();

  registerAnalysisResultsRoutes(app, reader);

  await app.ready();

  return app;
}

describe('analysis results routes', () => {
  it('returns the completed analysis graph', async () => {
    const reader = createReader();
    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/graph`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(createGraphResponse());

      expect(reader.getGraph).toHaveBeenCalledTimes(1);
      expect(reader.getGraph).toHaveBeenCalledWith(ANALYSIS_ID);
    } finally {
      await app.close();
    }
  });

  it('returns one file with persisted source content', async () => {
    const reader = createReader();
    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/files/${FILE_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(createFileDetailResponse());

      expect(reader.getFileDetail).toHaveBeenCalledTimes(1);
      expect(reader.getFileDetail).toHaveBeenCalledWith(ANALYSIS_ID, FILE_ID);
    } finally {
      await app.close();
    }
  });

  it('returns the onboarding pathfinder', async () => {
    const reader = createReader();
    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/pathfinder`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(createPathfinderResponse());

      expect(reader.getPathfinder).toHaveBeenCalledTimes(1);
      expect(reader.getPathfinder).toHaveBeenCalledWith(ANALYSIS_ID);
    } finally {
      await app.close();
    }
  });

  it('returns newcomer change guidance', async () => {
    const reader = createReader();
    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/newcomer-change-guidance`,
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual(createNewcomerChangeGuidanceResponse());

      expect(reader.getNewcomerChangeGuidance).toHaveBeenCalledTimes(1);

      expect(reader.getNewcomerChangeGuidance).toHaveBeenCalledWith(ANALYSIS_ID);
    } finally {
      await app.close();
    }
  });

  it('returns 404 when a completed graph is unavailable', async () => {
    const reader = createReader({
      getGraph: vi.fn(async () => null),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/graph`,
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

  it('returns 404 when the requested file is unavailable', async () => {
    const reader = createReader({
      getFileDetail: vi.fn(async () => null),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/files/${FILE_ID}`,
      });

      expect(response.statusCode).toBe(404);

      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: 'Analysis file was not found.',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 when the pathfinder analysis is unavailable', async () => {
    const reader = createReader({
      getPathfinder: vi.fn(async () => null),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/pathfinder`,
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

  it('returns 404 when newcomer change guidance is unavailable', async () => {
    const reader = createReader({
      getNewcomerChangeGuidance: vi.fn(async () => null),
    });

    const app = await createApp(reader);

    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/newcomer-change-guidance`,
      });

      expect(response.statusCode).toBe(404);

      expect(response.json()).toEqual({
        error: {
          code: 'NOT_FOUND',

          message: 'Completed analysis was not found.',
        },
      });

      expect(reader.getNewcomerChangeGuidance).toHaveBeenCalledTimes(1);

      expect(reader.getNewcomerChangeGuidance).toHaveBeenCalledWith(ANALYSIS_ID);
    } finally {
      await app.close();
    }
  });

  it('rejects invalid UUID route parameters before calling the reader', async () => {
    const reader = createReader();
    const app = await createApp(reader);

    try {
      const invalidAnalysisResponse = await app.inject({
        method: 'GET',
        url: '/api/analyses/not-a-uuid/graph',
      });

      expect(invalidAnalysisResponse.statusCode).toBe(400);
      expect(reader.getGraph).not.toHaveBeenCalled();

      const invalidGuidanceResponse = await app.inject({
        method: 'GET',
        url: '/api/analyses/not-a-uuid/newcomer-change-guidance',
      });

      expect(invalidGuidanceResponse.statusCode).toBe(400);

      expect(reader.getNewcomerChangeGuidance).not.toHaveBeenCalled();

      const invalidFileResponse = await app.inject({
        method: 'GET',
        url: `/api/analyses/${ANALYSIS_ID}/files/not-a-uuid`,
      });

      expect(invalidFileResponse.statusCode).toBe(400);
      expect(reader.getFileDetail).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
