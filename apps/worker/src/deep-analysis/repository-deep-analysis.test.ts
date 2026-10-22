import { describe, expect, it } from 'vitest';

import { analyzeRepositoryDeeply } from './repository-deep-analysis.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { FileDependencyCycle } from '../graph/cycle-detector.js';

import type { ResolvedImport } from '../resolution/types.js';

interface TestFileInput {
  filePath: string;

  complexity?: number;

  changedCommitCount?: number | null;

  affectedFileCount?: number;

  maxDistance?: number;

  fanIn?: number;

  fanOut?: number;

  transitiveDependencyCount?: number;

  inDependencyCycle?: boolean;

  cyclicComponentSize?: number;
}

function createMetrics(files: TestFileInput[]): RepositoryMetrics {
  const complexities = files.map((file) => file.complexity ?? 1);

  const churnValues = files
    .map((file) => file.changedCommitCount)
    .filter((value): value is number => value !== undefined && value !== null);

  const historyAvailable = churnValues.length > 0;

  const totalChangedCommitCount = historyAvailable
    ? churnValues.reduce((total, value) => total + value, 0)
    : null;

  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: files.filter((file) => file.inDependencyCycle === true).length,

      totalCyclomaticComplexity: complexities.reduce((total, value) => total + value, 0),

      averageCyclomaticComplexity:
        files.length === 0
          ? 0
          : complexities.reduce((total, value) => total + value, 0) / files.length,

      maxCyclomaticComplexity: complexities.length === 0 ? 0 : Math.max(...complexities),

      historyAvailable,

      totalChangedCommitCount,

      averageChangedCommitCount:
        historyAvailable && totalChangedCommitCount !== null
          ? totalChangedCommitCount / files.length
          : null,

      maxChangedCommitCount: historyAvailable ? Math.max(...churnValues) : null,
    },

    files: files.map((file) => ({
      filePath: file.filePath,

      dependencies: {
        fanIn: file.fanIn ?? 0,

        fanOut: file.fanOut ?? 0,

        transitiveDependencyCount: file.transitiveDependencyCount ?? 0,
      },

      blastRadius: {
        affectedFileCount: file.affectedFileCount ?? 0,

        maxDistance: file.maxDistance ?? 0,
      },

      cycles: {
        inDependencyCycle: file.inDependencyCycle ?? false,

        cyclicComponentSize: file.cyclicComponentSize ?? 0,
      },

      structure: {
        importCount: 0,

        functionCount: 0,

        classCount: 0,

        cyclomaticComplexity: file.complexity ?? 1,

        hasSyntaxErrors: false,
      },

      churn:
        file.changedCommitCount === undefined || file.changedCommitCount === null
          ? null
          : {
              changedCommitCount: file.changedCommitCount,
            },
    })),
  };
}

function createResolvedImport(input: {
  sourceFilePath: string;

  specifier: string;

  kind: ResolvedImport['kind'];

  reason: ResolvedImport['reason'];

  targetFilePath?: string | null;
}): ResolvedImport {
  return {
    sourceFilePath: input.sourceFilePath,

    sourceLanguage: 'typescript',

    specifier: input.specifier,

    range: {
      start: {
        row: 0,

        column: 0,
      },

      end: {
        row: 0,

        column: 1,
      },
    },

    kind: input.kind,

    targetFilePath: input.targetFilePath ?? null,

    reason: input.reason,
  };
}

function createCycle(
  nodeIds: string[],

  edgeIds: string[],
): FileDependencyCycle {
  return {
    id: `cycle:${nodeIds.join(':')}`,

    nodeIds,

    edgeIds,
  };
}

function createGraphAnalysis(options?: {
  resolvedImports?: ResolvedImport[];

  cycles?: FileDependencyCycle[];
}): RepositoryGraphAnalysis {
  return {
    /*
     * repository-deep-analysis currently only needs
     * resolvedImports and cycles.
     *
     * Keep a valid empty graph here while avoiding
     * rebuilding a real graph in this focused unit
     * test.
     */
    graph: {
      nodes: [],

      edges: [],
    },

    graphIndex: {} as RepositoryGraphAnalysis['graphIndex'],

    resolvedImports: options?.resolvedImports ?? [],

    cycles: options?.cycles ?? [],
  };
}

describe('analyzeRepositoryDeeply', () => {
  it('combines all B9 finding families into one result', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        complexity: 25,

        changedCommitCount: 20,

        affectedFileCount: 30,

        maxDistance: 5,

        fanIn: 18,

        fanOut: 22,

        transitiveDependencyCount: 40,

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },

      {
        filePath: 'src/service.ts',

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },

      {
        filePath: 'src/utils.ts',

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },
    ]);

    const graphAnalysis = createGraphAnalysis({
      cycles: [
        createCycle(
          ['src/core.ts', 'src/service.ts', 'src/utils.ts'],
          ['edge:1', 'edge:2', 'edge:3'],
        ),
      ],

      resolvedImports: [
        createResolvedImport({
          sourceFilePath: 'src/utils.ts',

          specifier: './missing-helper',

          kind: 'unresolved',

          reason: 'target-not-found',
        }),
      ],
    });

    const result = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,
    });

    expect(new Set(result.findings.map((finding) => finding.kind))).toEqual(
      new Set([
        'dependency-cycle',
        'unresolved-imports',
        'high-complexity',
        'high-churn',
        'large-blast-radius',
        'high-fan-in',
        'high-fan-out',
        'hotspot',
      ]),
    );
  });

  it('globally orders findings by high, medium, then low severity', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/high.ts',

        changedCommitCount: 20,
      },

      {
        filePath: 'src/medium.ts',

        complexity: 12,
      },

      {
        filePath: 'src/low.ts',
      },
    ]);

    const graphAnalysis = createGraphAnalysis({
      resolvedImports: [
        createResolvedImport({
          sourceFilePath: 'src/low.ts',

          specifier: './missing',

          kind: 'unresolved',

          reason: 'target-not-found',
        }),
      ],
    });

    const result = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,
    });

    expect(result.findings.map((finding) => finding.severity)).toEqual(['high', 'medium', 'low']);

    expect(result.findings.map((finding) => finding.kind)).toEqual([
      'high-churn',
      'high-complexity',
      'unresolved-imports',
    ]);
  });

  it('returns hotspot metadata alongside hotspot findings', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/risky.ts',

        complexity: 12,

        fanIn: 7,
      },
    ]);

    const result = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis: createGraphAnalysis(),
    });

    expect(result.hotspots).toEqual([
      {
        filePath: 'src/risky.ts',

        highComplexity: true,

        highChurn: false,

        largeBlastRadius: false,

        highFanIn: true,

        inDependencyCycle: false,

        signalCount: 2,
      },
    ]);

    expect(result.findings.some((finding) => finding.kind === 'hotspot')).toBe(true);
  });

  it('creates one dependency-cycle finding for one SCC', () => {
    const graphAnalysis = createGraphAnalysis({
      cycles: [createCycle(['src/c.ts', 'src/a.ts', 'src/b.ts'], ['edge:1', 'edge:2', 'edge:3'])],
    });

    const result = analyzeRepositoryDeeply({
      metrics: createMetrics([]),

      graphAnalysis,
    });

    const cycleFindings = result.findings.filter((finding) => finding.kind === 'dependency-cycle');

    expect(cycleFindings).toHaveLength(1);

    expect(cycleFindings[0]).toMatchObject({
      severity: 'high',

      filePaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
  });

  it('converts only unresolved resolver results into unresolved-import findings', () => {
    const graphAnalysis = createGraphAnalysis({
      resolvedImports: [
        createResolvedImport({
          sourceFilePath: 'src/app.ts',

          specifier: './service',

          kind: 'internal',

          reason: null,

          targetFilePath: 'src/service.ts',
        }),

        createResolvedImport({
          sourceFilePath: 'src/app.ts',

          specifier: 'fastify',

          kind: 'external',

          reason: 'external-package',
        }),

        createResolvedImport({
          sourceFilePath: 'src/app.ts',

          specifier: './missing',

          kind: 'unresolved',

          reason: 'target-not-found',
        }),
      ],
    });

    const result = analyzeRepositoryDeeply({
      metrics: createMetrics([
        {
          filePath: 'src/app.ts',
        },
      ]),

      graphAnalysis,
    });

    const unresolvedFindings = result.findings.filter(
      (finding) => finding.kind === 'unresolved-imports',
    );

    expect(unresolvedFindings).toHaveLength(1);

    expect(unresolvedFindings[0]?.evidence).toContainEqual({
      metric: 'unresolvedImportCount',

      value: 1,
    });
  });

  it('applies custom thresholds to metric rules and hotspot detection', () => {
    const thresholds: DeepAnalysisThresholds = {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

      cyclomaticComplexity: {
        medium: 2,

        high: 4,
      },

      fanIn: {
        medium: 1,

        high: 3,
      },
    };

    const result = analyzeRepositoryDeeply({
      metrics: createMetrics([
        {
          filePath: 'src/small.ts',

          complexity: 3,

          fanIn: 2,
        },
      ]),

      graphAnalysis: createGraphAnalysis(),

      thresholds,
    });

    expect(
      result.findings.some(
        (finding) => finding.kind === 'high-complexity' && finding.severity === 'medium',
      ),
    ).toBe(true);

    expect(
      result.findings.some(
        (finding) => finding.kind === 'high-fan-in' && finding.severity === 'medium',
      ),
    ).toBe(true);

    expect(
      result.findings.some(
        (finding) => finding.kind === 'hotspot' && finding.severity === 'medium',
      ),
    ).toBe(true);

    expect(result.hotspots[0]?.signalCount).toBe(2);
  });

  it('rejects invalid thresholds at the repository analysis boundary', () => {
    const invalidThresholds: DeepAnalysisThresholds = {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

      fanIn: {
        medium: 10,

        high: 5,
      },
    };

    expect(() =>
      analyzeRepositoryDeeply({
        metrics: createMetrics([]),

        graphAnalysis: createGraphAnalysis(),

        thresholds: invalidThresholds,
      }),
    ).toThrow();
  });

  it('produces deterministic results regardless of file and import order', () => {
    const firstMetrics = createMetrics([
      {
        filePath: 'src/z.ts',

        complexity: 12,

        fanIn: 6,
      },

      {
        filePath: 'src/a.ts',

        changedCommitCount: 18,
      },
    ]);

    const secondMetrics = createMetrics([
      {
        filePath: 'src/a.ts',

        changedCommitCount: 18,
      },

      {
        filePath: 'src/z.ts',

        complexity: 12,

        fanIn: 6,
      },
    ]);

    const importA = createResolvedImport({
      sourceFilePath: 'src/z.ts',

      specifier: './missing-z',

      kind: 'unresolved',

      reason: 'target-not-found',
    });

    const importB = createResolvedImport({
      sourceFilePath: 'src/a.ts',

      specifier: 'virtual:a',

      kind: 'unresolved',

      reason: 'unsupported-specifier',
    });

    const first = analyzeRepositoryDeeply({
      metrics: firstMetrics,

      graphAnalysis: createGraphAnalysis({
        resolvedImports: [importA, importB],
      }),
    });

    const second = analyzeRepositoryDeeply({
      metrics: secondMetrics,

      graphAnalysis: createGraphAnalysis({
        resolvedImports: [importB, importA],
      }),
    });

    expect(second).toEqual(first);
  });

  it('returns empty B9 results for an empty repository', () => {
    expect(
      analyzeRepositoryDeeply({
        metrics: createMetrics([]),

        graphAnalysis: createGraphAnalysis(),
      }),
    ).toEqual({
      findings: [],

      hotspots: [],
    });
  });
});
