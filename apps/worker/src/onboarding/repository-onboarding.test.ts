import { describe, expect, it } from 'vitest';

import { buildRepositoryOnboardingPath } from './repository-onboarding.js';

import type {
  AnalysisFinding,
  DeepAnalysisResult,
  FileHotspotSignals,
} from '../deep-analysis/types.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { RepositoryMetrics } from '../metrics/types.js';

interface TestFileInput {
  filePath: string;

  fanIn?: number;

  fanOut?: number;

  affectedFileCount?: number;
}

function createMetrics(files: TestFileInput[]): RepositoryMetrics {
  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: files.length,

      averageCyclomaticComplexity: files.length === 0 ? 0 : 1,

      maxCyclomaticComplexity: files.length === 0 ? 0 : 1,

      historyAvailable: false,

      totalChangedCommitCount: null,

      averageChangedCommitCount: null,

      maxChangedCommitCount: null,
    },

    files: files.map((file) => ({
      filePath: file.filePath,

      dependencies: {
        fanIn: file.fanIn ?? 0,

        fanOut: file.fanOut ?? 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: file.affectedFileCount ?? 0,

        maxDistance: 0,
      },

      cycles: {
        inDependencyCycle: false,

        cyclicComponentSize: 0,
      },

      structure: {
        importCount: 0,

        functionCount: 0,

        classCount: 0,

        cyclomaticComplexity: 1,

        hasSyntaxErrors: false,
      },

      churn: null,
    })),
  };
}

function createGraphAnalysis(
  edges: {
    source: string;

    target: string;
  }[] = [],
): RepositoryGraphAnalysis {
  const filePaths = [...new Set(edges.flatMap((edge) => [edge.source, edge.target]))];

  return {
    graph: {
      nodes: filePaths.map((filePath) => ({
        id: filePath,

        kind: 'file',

        filePath,

        language: 'typescript',

        hasSyntaxErrors: false,
      })),

      edges: edges.map((edge, index) => ({
        id: `edge:${index}`,

        kind: 'imports',

        source: edge.source,

        target: edge.target,

        specifier: `./dependency-${index}`,

        range: {
          start: {
            row: index,

            column: 0,
          },

          end: {
            row: index,

            column: 1,
          },
        },
      })),
    },

    graphIndex: {} as RepositoryGraphAnalysis['graphIndex'],

    resolvedImports: [],

    cycles: [],
  };
}

function createFinding(
  kind: AnalysisFinding['kind'],

  filePaths: string[],
): AnalysisFinding {
  return {
    id: `finding:${kind}:${filePaths.join(':')}`,

    kind,

    severity: 'high',

    title: 'Test finding',

    description: 'Test finding',

    filePaths,

    evidence: [],
  };
}

function createHotspot(
  filePath: string,

  signalCount = 3,
): FileHotspotSignals {
  return {
    filePath,

    highComplexity: true,

    highChurn: true,

    largeBlastRadius: true,

    highFanIn: true,

    inDependencyCycle: false,

    signalCount,
  };
}

function createDeepAnalysis(
  findings: AnalysisFinding[] = [],

  hotspots: FileHotspotSignals[] = [],
): DeepAnalysisResult {
  return {
    findings,

    hotspots,
  };
}

describe('buildRepositoryOnboardingPath', () => {
  it('starts from a detected dependency-root entry point', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/start.ts',

          target: 'src/service.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/start.ts',

          fanIn: 0,

          fanOut: 1,
        },

        {
          filePath: 'src/service.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/start.ts', 'src/service.ts']);

    expect(result.steps[0]?.signals.some((signal) => signal.kind === 'entry-point')).toBe(true);
  });

  it('prefers a conventional server entry point', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      metrics: createMetrics([
        {
          filePath: 'src/helper.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/server.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result.steps[0]?.filePath).toBe('src/server.ts');
  });

  it('follows dependency edges after selecting the entry point', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },

        {
          source: 'src/routes.ts',

          target: 'src/service.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 1,
        },

        {
          filePath: 'src/routes.ts',

          fanIn: 1,

          fanOut: 1,
        },

        {
          filePath: 'src/service.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/service.ts',
    ]);

    expect(
      result.steps[1]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(true);
  });

  it('uses deep-analysis importance signals when ranking dependencies', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/config.ts',
        },

        {
          source: 'src/server.ts',

          target: 'src/core.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 2,
        },

        {
          filePath: 'src/config.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/core.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(
        [createFinding('high-fan-in', ['src/core.ts'])],

        [createHotspot('src/core.ts')],
      ),
    });

    expect(result.steps[1]?.filePath).toBe('src/core.ts');

    expect(result.steps[1]?.signals.map((signal) => signal.kind)).toContain('hotspot');
  });

  it('falls back to the most important remaining file when a dependency branch ends', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 1,
        },

        {
          filePath: 'src/routes.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/core.ts',

          fanIn: 5,

          fanOut: 0,

          affectedFileCount: 6,
        },
      ]),

      deepAnalysis: createDeepAnalysis([
        createFinding('high-fan-in', ['src/core.ts']),

        createFinding('large-blast-radius', ['src/core.ts']),
      ]),
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/core.ts',
    ]);

    expect(
      result.steps[2]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(false);
  });

  it('handles dependency cycles without revisiting files', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/a.ts',

          target: 'src/b.ts',
        },

        {
          source: 'src/b.ts',

          target: 'src/c.ts',
        },

        {
          source: 'src/c.ts',

          target: 'src/a.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/a.ts',

          fanIn: 1,

          fanOut: 1,
        },

        {
          filePath: 'src/b.ts',

          fanIn: 1,

          fanOut: 1,
        },

        {
          filePath: 'src/c.ts',

          fanIn: 1,

          fanOut: 1,
        },
      ]),

      deepAnalysis: createDeepAnalysis([
        createFinding('dependency-cycle', ['src/a.ts', 'src/b.ts', 'src/c.ts']),
      ]),
    });

    expect(result.steps).toHaveLength(3);

    expect(new Set(result.steps.map((step) => step.filePath)).size).toBe(3);
  });

  it('passes maxSteps through to Pathfinder', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/a.ts',
        },

        {
          source: 'src/a.ts',

          target: 'src/b.ts',
        },

        {
          source: 'src/b.ts',

          target: 'src/c.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 1,
        },

        {
          filePath: 'src/a.ts',

          fanIn: 1,

          fanOut: 1,
        },

        {
          filePath: 'src/b.ts',

          fanIn: 1,

          fanOut: 1,
        },

        {
          filePath: 'src/c.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      maxSteps: 2,
    });

    expect(result.steps).toHaveLength(2);

    expect(result.maxSteps).toBe(2);
  });

  it('uses the default maxSteps when maxSteps is omitted', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result.maxSteps).toBe(10);
  });

  it('returns an empty result for an empty repository', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      metrics: createMetrics([]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result).toEqual({
      steps: [],

      consideredFileCount: 0,

      maxSteps: 10,
    });
  });

  it('reports the number of repository files considered', () => {
    const result = buildRepositoryOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      metrics: createMetrics([
        {
          filePath: 'src/a.ts',
        },

        {
          filePath: 'src/b.ts',
        },

        {
          filePath: 'src/c.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    });

    expect(result.consideredFileCount).toBe(3);
  });

  it('is deterministic for the same repository input', () => {
    const input = {
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/a.ts',
        },

        {
          source: 'src/server.ts',

          target: 'src/b.ts',
        },
      ]),

      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 2,
        },

        {
          filePath: 'src/a.ts',

          fanIn: 1,
        },

        {
          filePath: 'src/b.ts',

          fanIn: 1,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),
    };

    expect(buildRepositoryOnboardingPath(input)).toEqual(buildRepositoryOnboardingPath(input));
  });
});
