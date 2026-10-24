import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import { AnalysisResultsStore } from './analysis-results-store.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';
const REPOSITORY_ID = '22222222-2222-2222-2222-222222222222';

const SERVER_FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SERVICE_FILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

interface FakeDatabaseResult {
  database: Database;
  selectSpy: ReturnType<typeof vi.fn>;
}

function createSelectBuilder(response: readonly unknown[]) {
  const builder: {
    from: ReturnType<typeof vi.fn>;
    leftJoin: ReturnType<typeof vi.fn>;
    innerJoin: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    then: Promise<readonly unknown[]>['then'];
  } = {
    from: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (onFulfilled, onRejected) => Promise.resolve(response).then(onFulfilled, onRejected),
  };

  return builder;
}

function createFakeDatabase(selectResponses: readonly (readonly unknown[])[]): FakeDatabaseResult {
  let selectIndex = 0;

  const selectSpy = vi.fn(() => {
    const response = selectResponses[selectIndex];

    selectIndex += 1;

    if (response === undefined) {
      throw new Error(`Unexpected database select call ${selectIndex}`);
    }

    return createSelectBuilder(response);
  });

  return {
    database: {
      select: selectSpy,
    } as unknown as Database,
    selectSpy,
  };
}

function createCompletedAnalysisRow() {
  return {
    id: ANALYSIS_ID,
    repositoryId: REPOSITORY_ID,
    commitSha: 'a'.repeat(40),
    status: 'completed' as const,
    warningCount: 1,
    fileCount: 2,
    createdAt: new Date('2026-10-23T00:00:00.000Z'),
    startedAt: new Date('2026-10-23T00:01:00.000Z'),
    completedAt: new Date('2026-10-23T00:02:00.000Z'),
  };
}

function createRepositorySummary() {
  return {
    fileCount: 2,
    internalDependencyCount: 1,
    externalImportCount: 0,
    unresolvedImportCount: 0,
    cyclicComponentCount: 0,
    cyclicFileCount: 0,
    totalCyclomaticComplexity: 5,
    averageCyclomaticComplexity: 2.5,
    maxCyclomaticComplexity: 3,
    historyAvailable: true,
    totalChangedCommitCount: 7,
    averageChangedCommitCount: 3.5,
    maxChangedCommitCount: 5,
  };
}

function createHealthDimensions() {
  return [
    {
      dimension: 'maintainability' as const,
      maxScore: 25,
      score: 22,
      deductedPoints: 3,
      deductions: [],
    },
    {
      dimension: 'change-risk' as const,
      maxScore: 20,
      score: 18,
      deductedPoints: 2,
      deductions: [],
    },
    {
      dimension: 'dependency-health' as const,
      maxScore: 25,
      score: 23,
      deductedPoints: 2,
      deductions: [],
    },
    {
      dimension: 'coupling' as const,
      maxScore: 20,
      score: 17,
      deductedPoints: 3,
      deductions: [],
    },
    {
      dimension: 'resolution-quality' as const,
      maxScore: 10,
      score: 8,
      deductedPoints: 2,
      deductions: [],
    },
  ];
}

function createServerFileRow() {
  return {
    id: SERVER_FILE_ID,
    path: 'src/server.ts',
    language: 'typescript',
    sizeBytes: 120,
    sourceContent: "import { Service } from './service.js';\nexport function startServer() {}\n",
    isSupported: true,
    parseStatus: 'analyzed' as const,

    metricFileId: SERVER_FILE_ID,
    loc: 12,
    tokenCount: 30,
    cyclomaticComplexity: 2,
    churnAdditions: null,
    churnDeletions: null,
    churnCommits: 2,
    importCount: 1,
    functionCount: 1,
    classCount: 0,
    hasSyntaxErrors: false,
    fanIn: 0,
    fanOut: 1,
    transitiveDependencyCount: 1,
    blastRadius: 0,
    blastMaxDistance: 0,
    inDependencyCycle: false,
    cyclicComponentSize: 0,
    riskScore: 20,
  };
}

function createServiceFileRow() {
  return {
    id: SERVICE_FILE_ID,
    path: 'src/service.ts',
    language: 'typescript',
    sizeBytes: 80,
    sourceContent: 'export class Service {}\n',
    isSupported: true,
    parseStatus: 'analyzed' as const,

    metricFileId: SERVICE_FILE_ID,
    loc: 20,
    tokenCount: 40,
    cyclomaticComplexity: 3,
    churnAdditions: null,
    churnDeletions: null,
    churnCommits: 5,
    importCount: 0,
    functionCount: 0,
    classCount: 1,
    hasSyntaxErrors: false,
    fanIn: 1,
    fanOut: 0,
    transitiveDependencyCount: 0,
    blastRadius: 1,
    blastMaxDistance: 1,
    inDependencyCycle: false,
    cyclicComponentSize: 0,
    riskScore: 35,
  };
}

describe('AnalysisResultsStore', () => {
  describe('getGraph', () => {
    it('reconstructs the public graph response for a completed analysis', async () => {
      const analysisRow = createCompletedAnalysisRow();

      const resultRow = {
        repositorySummary: createRepositorySummary(),
        healthScore: 88,
        healthRating: 'good' as const,
        healthDimensions: createHealthDimensions(),
      };

      const fileRows = [createServiceFileRow(), createServerFileRow()];

      const edgeRows = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          sourceFileId: SERVER_FILE_ID,
          targetFileId: SERVICE_FILE_ID,
          fromSymbolId: null,
          toSymbolId: null,
          type: 'import' as const,
          weight: 2,
          isDynamic: false,
        },
      ];

      const { database, selectSpy } = createFakeDatabase([
        [analysisRow],
        [resultRow],
        fileRows,
        edgeRows,
      ]);

      const store = new AnalysisResultsStore(database);

      const graph = await store.getGraph(ANALYSIS_ID);

      expect(selectSpy).toHaveBeenCalledTimes(4);

      expect(graph).toEqual({
        analysis: {
          id: ANALYSIS_ID,
          repositoryId: REPOSITORY_ID,
          commitSha: 'a'.repeat(40),
          status: 'completed',
          warningCount: 1,
          fileCount: 2,
          createdAt: '2026-10-23T00:00:00.000Z',
          startedAt: '2026-10-23T00:01:00.000Z',
          completedAt: '2026-10-23T00:02:00.000Z',
        },
        summary: createRepositorySummary(),
        health: {
          score: 88,
          rating: 'good',
          analyzedFileCount: 2,
          dimensions: createHealthDimensions().map(
            ({ dimension, maxScore, score, deductedPoints }) => ({
              dimension,
              maxScore,
              score,
              deductedPoints,
            }),
          ),
        },
        nodes: [
          {
            id: SERVER_FILE_ID,
            path: 'src/server.ts',
            language: 'typescript',
            sizeBytes: 120,
            isSupported: true,
            parseStatus: 'analyzed',
            metrics: {
              loc: 12,
              tokenCount: 30,
              cyclomaticComplexity: 2,
              churnAdditions: null,
              churnDeletions: null,
              churnCommits: 2,
              importCount: 1,
              functionCount: 1,
              classCount: 0,
              hasSyntaxErrors: false,
              fanIn: 0,
              fanOut: 1,
              transitiveDependencyCount: 1,
              blastRadius: 0,
              blastMaxDistance: 0,
              inDependencyCycle: false,
              cyclicComponentSize: 0,
              riskScore: 20,
            },
          },
          {
            id: SERVICE_FILE_ID,
            path: 'src/service.ts',
            language: 'typescript',
            sizeBytes: 80,
            isSupported: true,
            parseStatus: 'analyzed',
            metrics: {
              loc: 20,
              tokenCount: 40,
              cyclomaticComplexity: 3,
              churnAdditions: null,
              churnDeletions: null,
              churnCommits: 5,
              importCount: 0,
              functionCount: 0,
              classCount: 1,
              hasSyntaxErrors: false,
              fanIn: 1,
              fanOut: 0,
              transitiveDependencyCount: 0,
              blastRadius: 1,
              blastMaxDistance: 1,
              inDependencyCycle: false,
              cyclicComponentSize: 0,
              riskScore: 35,
            },
          },
        ],
        edges: [
          {
            id: '33333333-3333-3333-3333-333333333333',
            sourceFileId: SERVER_FILE_ID,
            sourcePath: 'src/server.ts',
            targetFileId: SERVICE_FILE_ID,
            targetPath: 'src/service.ts',
            fromSymbolId: null,
            toSymbolId: null,
            type: 'import',
            weight: 2,
            isDynamic: false,
          },
        ],
      });

      expect(
        graph?.nodes.some((node) => Object.prototype.hasOwnProperty.call(node, 'sourceContent')),
      ).toBe(false);
    });

    it('returns null for an analysis that is not completed', async () => {
      const { database, selectSpy } = createFakeDatabase([[]]);

      const store = new AnalysisResultsStore(database);

      await expect(store.getGraph(ANALYSIS_ID)).resolves.toBeNull();

      expect(selectSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getFileDetail', () => {
    it('returns source content, symbols, edges and findings for one file', async () => {
      const serverFile = createServerFileRow();

      const pathRows = [
        {
          id: SERVER_FILE_ID,
          path: 'src/server.ts',
        },
        {
          id: SERVICE_FILE_ID,
          path: 'src/service.ts',
        },
      ];

      const edgeRows = [
        {
          id: '33333333-3333-3333-3333-333333333333',
          sourceFileId: SERVER_FILE_ID,
          targetFileId: SERVICE_FILE_ID,
          fromSymbolId: null,
          toSymbolId: null,
          type: 'import' as const,
          weight: 1,
          isDynamic: false,
        },
      ];

      const symbolRows = [
        {
          id: '44444444-4444-4444-4444-444444444444',
          fileId: SERVER_FILE_ID,
          kind: 'function' as const,
          name: 'startServer',
          qualifiedName: 'startServer',
          startLine: 2,
          startColumn: 0,
          endLine: 2,
          endColumn: 31,
          isExported: true,
          complexity: 2,
        },
      ];

      const findingRows = [
        {
          id: '55555555-5555-5555-5555-555555555555',
          findingKey: 'finding:high-complexity',
          kind: 'high-complexity' as const,
          severity: 'medium' as const,
          title: 'High complexity',
          description: 'This file is harder to understand.',
          evidence: [
            {
              metric: 'cyclomaticComplexity',
              value: 2,
              threshold: 2,
            },
          ],
        },
      ];

      const { database, selectSpy } = createFakeDatabase([
        [{ id: ANALYSIS_ID }],
        [serverFile],
        pathRows,
        edgeRows,
        symbolRows,
        findingRows,
      ]);

      const store = new AnalysisResultsStore(database);

      const detail = await store.getFileDetail(ANALYSIS_ID, SERVER_FILE_ID);

      expect(selectSpy).toHaveBeenCalledTimes(6);

      expect(detail?.analysisId).toBe(ANALYSIS_ID);

      expect(detail?.file).toEqual({
        id: SERVER_FILE_ID,
        path: 'src/server.ts',
        language: 'typescript',
        sizeBytes: 120,
        isSupported: true,
        parseStatus: 'analyzed',
        metrics: {
          loc: 12,
          tokenCount: 30,
          cyclomaticComplexity: 2,
          churnAdditions: null,
          churnDeletions: null,
          churnCommits: 2,
          importCount: 1,
          functionCount: 1,
          classCount: 0,
          hasSyntaxErrors: false,
          fanIn: 0,
          fanOut: 1,
          transitiveDependencyCount: 1,
          blastRadius: 0,
          blastMaxDistance: 0,
          inDependencyCycle: false,
          cyclicComponentSize: 0,
          riskScore: 20,
        },
      });

      expect(detail?.sourceContent).toBe(
        "import { Service } from './service.js';\nexport function startServer() {}\n",
      );

      expect(detail?.symbols).toEqual([
        {
          id: '44444444-4444-4444-4444-444444444444',
          fileId: SERVER_FILE_ID,
          filePath: 'src/server.ts',
          kind: 'function',
          name: 'startServer',
          qualifiedName: 'startServer',
          startLine: 2,
          startColumn: 0,
          endLine: 2,
          endColumn: 31,
          isExported: true,
          complexity: 2,
        },
      ]);

      expect(detail?.outgoingEdges).toEqual([
        {
          id: '33333333-3333-3333-3333-333333333333',
          sourceFileId: SERVER_FILE_ID,
          sourcePath: 'src/server.ts',
          targetFileId: SERVICE_FILE_ID,
          targetPath: 'src/service.ts',
          fromSymbolId: null,
          toSymbolId: null,
          type: 'import',
          weight: 1,
          isDynamic: false,
        },
      ]);

      expect(detail?.incomingEdges).toEqual([]);

      expect(detail?.findings).toEqual([
        {
          id: 'finding:high-complexity',
          kind: 'high-complexity',
          severity: 'medium',
          title: 'High complexity',
          description: 'This file is harder to understand.',
          filePaths: ['src/server.ts'],
          evidence: [
            {
              metric: 'cyclomaticComplexity',
              value: 2,
              threshold: 2,
            },
          ],
        },
      ]);
    });

    it('returns null when the file does not belong to the completed analysis', async () => {
      const { database, selectSpy } = createFakeDatabase([[{ id: ANALYSIS_ID }], []]);

      const store = new AnalysisResultsStore(database);

      await expect(store.getFileDetail(ANALYSIS_ID, SERVER_FILE_ID)).resolves.toBeNull();

      expect(selectSpy).toHaveBeenCalledTimes(2);
    });

    it('supports completed files whose source content is unavailable', async () => {
      const fileRow = {
        ...createServerFileRow(),
        sourceContent: null,
      };

      const { database } = createFakeDatabase([
        [{ id: ANALYSIS_ID }],
        [fileRow],
        [
          {
            id: SERVER_FILE_ID,
            path: 'src/server.ts',
          },
        ],
        [],
        [],
        [],
      ]);

      const store = new AnalysisResultsStore(database);

      const detail = await store.getFileDetail(ANALYSIS_ID, SERVER_FILE_ID);

      expect(detail?.sourceContent).toBeNull();
    });
  });

  describe('getPathfinder', () => {
    it('returns onboarding steps in deterministic order', async () => {
      const resultRow = {
        consideredFileCount: 2,
        maxSteps: 10,
      };

      const stepRows = [
        {
          order: 2,
          filePath: 'src/service.ts',
          score: 35,
          signals: [
            {
              kind: 'dependency-of-previous' as const,
              weight: 15,
              description: 'Direct dependency of the previous file.',
            },
          ],
        },
        {
          order: 1,
          filePath: 'src/server.ts',
          score: 50,
          signals: [
            {
              kind: 'entry-point' as const,
              weight: 50,
              description: 'Likely repository entry point.',
            },
          ],
        },
      ];

      const { database, selectSpy } = createFakeDatabase([
        [{ id: ANALYSIS_ID }],
        [resultRow],
        stepRows,
      ]);

      const store = new AnalysisResultsStore(database);

      const pathfinder = await store.getPathfinder(ANALYSIS_ID);

      expect(selectSpy).toHaveBeenCalledTimes(3);

      expect(pathfinder).toEqual({
        analysisId: ANALYSIS_ID,
        consideredFileCount: 2,
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
          {
            order: 2,
            filePath: 'src/service.ts',
            score: 35,
            signals: [
              {
                kind: 'dependency-of-previous',
                weight: 15,
                description: 'Direct dependency of the previous file.',
              },
            ],
          },
        ],
      });
    });

    it('returns null when the analysis is not completed', async () => {
      const { database, selectSpy } = createFakeDatabase([[]]);

      const store = new AnalysisResultsStore(database);

      await expect(store.getPathfinder(ANALYSIS_ID)).resolves.toBeNull();

      expect(selectSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects empty identifiers before querying PostgreSQL', async () => {
    const { database, selectSpy } = createFakeDatabase([]);

    const store = new AnalysisResultsStore(database);

    await expect(store.getGraph('   ')).rejects.toThrow('analysisId cannot be empty');

    await expect(store.getFileDetail(ANALYSIS_ID, '   ')).rejects.toThrow('fileId cannot be empty');

    expect(selectSpy).not.toHaveBeenCalled();
  });
});
