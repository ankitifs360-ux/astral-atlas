import { describe, expect, it } from 'vitest';

import type { FileArchitectureRiskScore } from '../deep-analysis/architecture-risk-score.js';
import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

import { scoreGoodFirstTasks } from './good-first-task-scorer.js';

function createFileMetrics(
  filePath: string,

  overrides: {
    complexity?: number;
    fanIn?: number;
    fanOut?: number;
    blastRadius?: number;
    inDependencyCycle?: boolean;
  } = {},
): FileMetrics {
  return {
    filePath,

    dependencies: {
      fanIn: overrides.fanIn ?? 0,

      fanOut: overrides.fanOut ?? 0,

      transitiveDependencyCount: 0,
    },

    blastRadius: {
      affectedFileCount: overrides.blastRadius ?? 0,

      maxDistance: 0,
    },

    cycles: {
      inDependencyCycle: overrides.inDependencyCycle ?? false,

      cyclicComponentSize: overrides.inDependencyCycle ? 2 : 0,
    },

    structure: {
      importCount: 0,

      functionCount: 1,

      classCount: 0,

      cyclomaticComplexity: overrides.complexity ?? 1,

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

function createRisk(
  filePath: string,

  riskScore: number,
): FileArchitectureRiskScore {
  return {
    filePath,

    riskScore,
  };
}

describe('scoreGoodFirstTasks', () => {
  it('gives a simple low-risk file the maximum score', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([createFileMetrics('src/simple.ts')]),

      architectureRiskScores: [createRisk('src/simple.ts', 0)],
    });

    expect(result.recommendations).toEqual([
      {
        filePath: 'src/simple.ts',

        score: 100,

        architectureRiskScore: 0,

        signals: [],
      },
    ]);
  });

  it('applies the architecture-risk penalty bands', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/low.ts'),

        createFileMetrics('src/medium.ts'),

        createFileMetrics('src/high.ts'),
      ]),

      architectureRiskScores: [
        createRisk('src/low.ts', 25),

        createRisk('src/medium.ts', 60),

        createRisk('src/high.ts', 85),
      ],
    });

    expect(
      result.recommendations.map((recommendation) => ({
        filePath: recommendation.filePath,

        score: recommendation.score,
      })),
    ).toEqual([
      {
        filePath: 'src/low.ts',

        score: 90,
      },

      {
        filePath: 'src/medium.ts',

        score: 80,
      },

      {
        filePath: 'src/high.ts',

        score: 70,
      },
    ]);
  });

  it('penalizes high complexity, fan-out and blast radius', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/risky.ts', {
          complexity: 20,

          fanOut: 20,

          blastRadius: 20,
        }),
      ]),

      architectureRiskScores: [createRisk('src/risky.ts', 0)],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        filePath: 'src/risky.ts',

        score: 50,
      }),
    );

    expect(result.recommendations[0]?.signals.map((signal) => signal.kind)).toEqual([
      'cyclomatic-complexity',
      'fan-out',
      'blast-radius',
    ]);
  });

  it('penalizes dependency-cycle membership', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/cyclic.ts', {
          inDependencyCycle: true,
        }),
      ]),

      architectureRiskScores: [createRisk('src/cyclic.ts', 0)],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        score: 85,
      }),
    );

    expect(result.recommendations[0]?.signals).toEqual([
      expect.objectContaining({
        kind: 'dependency-cycle',

        impact: 'penalty',

        points: 15,
      }),
    ]);
  });

  it('adds a small useful-context bonus for moderate fan-in', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/shared.ts', {
          fanIn: 2,

          complexity: 10,
        }),
      ]),

      architectureRiskScores: [createRisk('src/shared.ts', 0)],
    });

    expect(result.recommendations[0]).toEqual(
      expect.objectContaining({
        score: 95,
      }),
    );

    expect(
      result.recommendations[0]?.signals.some(
        (signal) =>
          signal.kind === 'useful-context' && signal.impact === 'bonus' && signal.points === 5,
      ),
    ).toBe(true);
  });

  it('ranks safer files before riskier files', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/risky.ts', {
          complexity: 20,
        }),

        createFileMetrics('src/safe.ts'),
      ]),

      architectureRiskScores: [createRisk('src/risky.ts', 60), createRisk('src/safe.ts', 0)],
    });

    expect(result.recommendations.map((recommendation) => recommendation.filePath)).toEqual([
      'src/safe.ts',
      'src/risky.ts',
    ]);
  });

  it('uses deterministic file-path ordering when scores tie', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/zeta.ts'),

        createFileMetrics('src/alpha.ts'),
      ]),

      architectureRiskScores: [createRisk('src/zeta.ts', 0), createRisk('src/alpha.ts', 0)],
    });

    expect(result.recommendations.map((recommendation) => recommendation.filePath)).toEqual([
      'src/alpha.ts',
      'src/zeta.ts',
    ]);
  });

  it('respects maxRecommendations and reports the considered file count', () => {
    const result = scoreGoodFirstTasks({
      metrics: createRepositoryMetrics([
        createFileMetrics('src/a.ts'),

        createFileMetrics('src/b.ts'),

        createFileMetrics('src/c.ts'),
      ]),

      architectureRiskScores: [],

      maxRecommendations: 2,
    });

    expect(result.recommendations).toHaveLength(2);

    expect(result.consideredFileCount).toBe(3);

    expect(result.maxRecommendations).toBe(2);
  });

  it('rejects duplicate architecture risk scores', () => {
    expect(() =>
      scoreGoodFirstTasks({
        metrics: createRepositoryMetrics([createFileMetrics('src/app.ts')]),

        architectureRiskScores: [createRisk('src/app.ts', 25), createRisk('src/app.ts', 60)],
      }),
    ).toThrow('Duplicate architecture risk score for "src/app.ts"');
  });

  it('rejects architecture risk scores outside 0..100', () => {
    expect(() =>
      scoreGoodFirstTasks({
        metrics: createRepositoryMetrics([createFileMetrics('src/app.ts')]),

        architectureRiskScores: [createRisk('src/app.ts', 101)],
      }),
    ).toThrow('Architecture risk score for "src/app.ts" must be between 0 and 100');
  });

  it('rejects a non-positive maxRecommendations value', () => {
    expect(() =>
      scoreGoodFirstTasks({
        metrics: createRepositoryMetrics([]),

        architectureRiskScores: [],

        maxRecommendations: 0,
      }),
    ).toThrow('maxRecommendations must be a positive integer');
  });
});
