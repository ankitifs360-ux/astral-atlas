import { describe, expect, it } from 'vitest';

import type { FileArchitectureRiskScore } from '../deep-analysis/architecture-risk-score.js';
import type { FileDependencyGraph } from '../graph/types.js';
import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

import { scoreNewcomerChangeGuidance } from './newcomer-change-guidance-scorer.js';

function createFileMetrics(
  filePath: string,

  overrides: {
    fanIn?: number;
    blastRadius?: number;
    blastMaxDistance?: number;
    inDependencyCycle?: boolean;
    cyclicComponentSize?: number;
  } = {},
): FileMetrics {
  return {
    filePath,

    dependencies: {
      fanIn: overrides.fanIn ?? 0,

      fanOut: 0,

      transitiveDependencyCount: 0,
    },

    blastRadius: {
      affectedFileCount: overrides.blastRadius ?? 0,

      maxDistance: overrides.blastMaxDistance ?? 0,
    },

    cycles: {
      inDependencyCycle: overrides.inDependencyCycle ?? false,

      cyclicComponentSize: overrides.cyclicComponentSize ?? (overrides.inDependencyCycle ? 2 : 0),
    },

    structure: {
      importCount: 0,

      functionCount: 1,

      classCount: 0,

      cyclomaticComplexity: 1,

      hasSyntaxErrors: false,
    },

    churn: {
      changedCommitCount: 0,
    },
  };
}

function createRepositoryMetrics(files: FileMetrics[]): RepositoryMetrics {
  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: files.reduce(
        (total, file) => total + file.structure.cyclomaticComplexity,
        0,
      ),

      averageCyclomaticComplexity:
        files.length === 0
          ? 0
          : files.reduce((total, file) => total + file.structure.cyclomaticComplexity, 0) /
            files.length,

      maxCyclomaticComplexity:
        files.length === 0
          ? 0
          : Math.max(...files.map((file) => file.structure.cyclomaticComplexity)),

      historyAvailable: true,

      totalChangedCommitCount: 0,

      averageChangedCommitCount: 0,

      maxChangedCommitCount: 0,
    },

    files,
  };
}

function createGraph(
  filePaths: string[],

  edges: (readonly [source: string, target: string])[] = [],
): FileDependencyGraph {
  return {
    nodes: filePaths.map((filePath) => ({
      id: filePath,

      kind: 'file',

      filePath,

      language: 'typescript',

      hasSyntaxErrors: false,
    })),

    edges: edges.map(([source, target], index) => ({
      id: `edge-${index}`,

      kind: 'imports',

      source,

      target,

      specifier: target,

      range: {} as FileDependencyGraph['edges'][number]['range'],
    })),
  };
}

function createRisk(
  filePath: string,

  riskScore: number,
): FileArchitectureRiskScore {
  return {
    filePath,

    riskScore,
  };
}

describe('scoreNewcomerChangeGuidance', () => {
  it('gives an isolated low-risk file the maximum safety score', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([createFileMetrics('src/simple.ts')]),

      graph: createGraph(['src/simple.ts']),

      architectureRiskScores: [createRisk('src/simple.ts', 0)],
    });

    expect(result.recommendations).toEqual([
      {
        filePath: 'src/simple.ts',

        safetyScore: 100,

        riskLevel: 'low',

        blastRadius: 0,

        blastMaxDistance: 0,

        reviewFilePaths: [],

        signals: [],
      },
    ]);
  });

  it('penalizes a large and deep blast radius', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/core.ts', {
          blastRadius: 100,

          blastMaxDistance: 4,
        }),
      ]),

      graph: createGraph(['src/core.ts']),

      architectureRiskScores: [createRisk('src/core.ts', 0)],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        filePath: 'src/core.ts',

        safetyScore: 55,

        riskLevel: 'medium',

        blastRadius: 100,

        blastMaxDistance: 4,
      }),
    );

    expect(result.recommendations[0]?.signals.map((signal) => signal.kind)).toEqual([
      'blast-radius',
      'blast-distance',
    ]);
  });

  it('penalizes dependency cycles, high fan-in and architecture risk', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/shared.ts', {
          fanIn: 100,

          inDependencyCycle: true,

          cyclicComponentSize: 3,
        }),
      ]),

      graph: createGraph(['src/shared.ts']),

      architectureRiskScores: [createRisk('src/shared.ts', 100)],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        safetyScore: 30,

        riskLevel: 'high',
      }),
    );

    expect(result.recommendations[0]?.signals.map((signal) => signal.kind)).toEqual([
      'dependency-cycle',
      'fan-in',
      'architecture-risk',
    ]);
  });

  it('lists transitive dependents in nearest-first review order', () => {
    const files = [
      createFileMetrics('src/db.ts', {
        blastRadius: 2,

        blastMaxDistance: 2,
      }),

      createFileMetrics('src/service.ts'),

      createFileMetrics('src/app.ts'),
    ];

    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics(files),

      graph: createGraph(
        ['src/app.ts', 'src/service.ts', 'src/db.ts'],

        [
          ['src/app.ts', 'src/service.ts'],

          ['src/service.ts', 'src/db.ts'],
        ],
      ),

      architectureRiskScores: [],
    });

    const dbGuidance = result.recommendations.find(
      (recommendation) => recommendation.filePath === 'src/db.ts',
    );

    expect(dbGuidance?.reviewFilePaths).toEqual(['src/service.ts', 'src/app.ts']);
  });

  it('ranks safer change surfaces before riskier ones', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/risky.ts', {
          blastRadius: 100,

          blastMaxDistance: 4,
        }),

        createFileMetrics('src/safe.ts'),
      ]),

      graph: createGraph(['src/risky.ts', 'src/safe.ts']),

      architectureRiskScores: [createRisk('src/risky.ts', 100), createRisk('src/safe.ts', 0)],
    });

    expect(result.recommendations.map((recommendation) => recommendation.filePath)).toEqual([
      'src/safe.ts',
      'src/risky.ts',
    ]);
  });

  it('uses deterministic file-path ordering when safety scores tie', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/zeta.ts'),

        createFileMetrics('src/alpha.ts'),
      ]),

      graph: createGraph(['src/zeta.ts', 'src/alpha.ts']),

      architectureRiskScores: [],
    });

    expect(result.recommendations.map((recommendation) => recommendation.filePath)).toEqual([
      'src/alpha.ts',
      'src/zeta.ts',
    ]);
  });

  it('respects maxRecommendations and reports the considered file count', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/a.ts'),

        createFileMetrics('src/b.ts'),

        createFileMetrics('src/c.ts'),
      ]),

      graph: createGraph(['src/a.ts', 'src/b.ts', 'src/c.ts']),

      architectureRiskScores: [],

      maxRecommendations: 2,
    });

    expect(result.recommendations).toHaveLength(2);

    expect(result.consideredFileCount).toBe(3);

    expect(result.maxRecommendations).toBe(2);
  });

  it('uses zero architecture risk when no risk score exists for a file', () => {
    const result = scoreNewcomerChangeGuidance({
      metrics: createRepositoryMetrics([createFileMetrics('src/app.ts')]),

      graph: createGraph(['src/app.ts']),

      architectureRiskScores: [],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        safetyScore: 100,

        riskLevel: 'low',
      }),
    );
  });

  it('rejects duplicate architecture risk scores', () => {
    expect(() =>
      scoreNewcomerChangeGuidance({
        metrics: createRepositoryMetrics([createFileMetrics('src/app.ts')]),

        graph: createGraph(['src/app.ts']),

        architectureRiskScores: [createRisk('src/app.ts', 25), createRisk('src/app.ts', 60)],
      }),
    ).toThrow('Duplicate architecture risk score for "src/app.ts"');
  });

  it('rejects architecture risk scores outside 0..100', () => {
    expect(() =>
      scoreNewcomerChangeGuidance({
        metrics: createRepositoryMetrics([createFileMetrics('src/app.ts')]),

        graph: createGraph(['src/app.ts']),

        architectureRiskScores: [createRisk('src/app.ts', 101)],
      }),
    ).toThrow('Architecture risk score for "src/app.ts" must be between 0 and 100');
  });

  it('rejects a non-positive maxRecommendations value', () => {
    expect(() =>
      scoreNewcomerChangeGuidance({
        metrics: createRepositoryMetrics([]),

        graph: createGraph([]),

        architectureRiskScores: [],

        maxRecommendations: 0,
      }),
    ).toThrow('maxRecommendations must be a positive integer');
  });
});
