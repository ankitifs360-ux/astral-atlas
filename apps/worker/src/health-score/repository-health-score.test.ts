import { describe, expect, it } from 'vitest';

import {
  calculateRepositoryHealthScore,
  determineRepositoryHealthRating,
} from './repository-health-score.js';

import { DEFAULT_HEALTH_SCORE_POLICY } from './policy.js';

import type {
  AnalysisFinding,
  DeepAnalysisResult,
  FileHotspotSignals,
} from '../deep-analysis/types.js';

import type { HealthScorePolicy } from './policy.js';

function createFinding(
  kind: AnalysisFinding['kind'],
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:${kind}:${filePath}:${severity}`,
    kind,
    severity,
    title: `${kind} in ${filePath}`,
    description: 'Test finding',
    filePaths: [filePath],
    evidence:
      kind === 'unresolved-imports'
        ? [
            {
              metric: 'unresolvedImportCount',
              value: 1,
            },
          ]
        : [],
  };
}

function createHotspot(filePath: string, highChurn: boolean): FileHotspotSignals {
  return {
    filePath,
    highComplexity: true,
    highChurn,
    largeBlastRadius: true,
    highFanIn: true,
    inDependencyCycle: false,
    signalCount: highChurn ? 4 : 3,
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

describe('determineRepositoryHealthRating', () => {
  it('returns excellent for scores from 90 to 100', () => {
    expect(determineRepositoryHealthRating(100)).toBe('excellent');
    expect(determineRepositoryHealthRating(90)).toBe('excellent');
  });

  it('returns good for scores from 75 to 89', () => {
    expect(determineRepositoryHealthRating(89)).toBe('good');
    expect(determineRepositoryHealthRating(75)).toBe('good');
  });

  it('returns fair for scores from 60 to 74', () => {
    expect(determineRepositoryHealthRating(74)).toBe('fair');
    expect(determineRepositoryHealthRating(60)).toBe('fair');
  });

  it('returns poor for scores from 40 to 59', () => {
    expect(determineRepositoryHealthRating(59)).toBe('poor');
    expect(determineRepositoryHealthRating(40)).toBe('poor');
  });

  it('returns critical for scores from 0 to 39', () => {
    expect(determineRepositoryHealthRating(39)).toBe('critical');
    expect(determineRepositoryHealthRating(0)).toBe('critical');
  });

  it('rejects scores below zero', () => {
    expect(() => determineRepositoryHealthRating(-1)).toThrow(
      'Repository health score must be an integer between 0 and 100',
    );
  });

  it('rejects scores above 100', () => {
    expect(() => determineRepositoryHealthRating(101)).toThrow(
      'Repository health score must be an integer between 0 and 100',
    );
  });

  it('rejects fractional scores', () => {
    expect(() => determineRepositoryHealthRating(89.5)).toThrow(
      'Repository health score must be an integer between 0 and 100',
    );
  });
});

describe('calculateRepositoryHealthScore', () => {
  it('returns 100 and excellent for a repository with no findings', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(),

      analyzedFileCount: 10,
    });

    expect(result).toEqual({
      score: 100,

      rating: 'excellent',

      dimensions: [
        {
          dimension: 'maintainability',

          maxScore: 25,

          score: 25,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'change-risk',

          maxScore: 20,

          score: 20,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'dependency-health',

          maxScore: 25,

          score: 25,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'coupling',

          maxScore: 20,

          score: 20,

          deductedPoints: 0,

          deductions: [],
        },

        {
          dimension: 'resolution-quality',

          maxScore: 10,

          score: 10,

          deductedPoints: 0,

          deductions: [],
        },
      ],

      analyzedFileCount: 10,
    });
  });

  it('keeps dimension ordering deterministic', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(),

      analyzedFileCount: 10,
    });

    expect(result.dimensions.map((dimension) => dimension.dimension)).toEqual([
      'maintainability',
      'change-risk',
      'dependency-health',
      'coupling',
      'resolution-quality',
    ]);
  });

  it('combines deductions from all five dimensions', () => {
    const findings: AnalysisFinding[] = [
      createFinding('high-complexity', 'src/complex.ts', 'high'),

      createFinding('high-churn', 'src/churn.ts', 'high'),

      createFinding('large-blast-radius', 'src/blast.ts', 'high'),

      createFinding('high-fan-in', 'src/shared.ts', 'high'),

      createFinding('unresolved-imports', 'src/missing.ts', 'high'),
    ];

    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(findings),

      analyzedFileCount: 10,
    });

    expect(
      result.dimensions.map((dimension) => ({
        dimension: dimension.dimension,

        deductedPoints: dimension.deductedPoints,
      })),
    ).toEqual([
      {
        dimension: 'maintainability',

        deductedPoints: 3,
      },

      {
        dimension: 'change-risk',

        deductedPoints: 2,
      },

      {
        dimension: 'dependency-health',

        deductedPoints: 3,
      },

      {
        dimension: 'coupling',

        deductedPoints: 2,
      },

      {
        dimension: 'resolution-quality',

        deductedPoints: 1,
      },
    ]);

    expect(result.score).toBe(89);

    expect(result.rating).toBe('good');
  });

  it('uses hotspot severity to strengthen change risk only when churn is active', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(
        [
          createFinding('high-churn', 'src/core.ts', 'medium'),

          createFinding('hotspot', 'src/core.ts', 'high'),
        ],

        [createHotspot('src/core.ts', true)],
      ),

      analyzedFileCount: 10,
    });

    const changeRisk = result.dimensions.find((dimension) => dimension.dimension === 'change-risk');

    expect(changeRisk).toMatchObject({
      score: 18,

      deductedPoints: 2,
    });
  });

  it('does not use a non-churn hotspot as change-risk evidence', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(
        [createFinding('hotspot', 'src/core.ts', 'high')],

        [createHotspot('src/core.ts', false)],
      ),

      analyzedFileCount: 10,
    });

    const changeRisk = result.dimensions.find((dimension) => dimension.dimension === 'change-risk');

    expect(changeRisk).toMatchObject({
      score: 20,

      deductedPoints: 0,
    });
  });

  it('keeps overlapping findings deduplicated inside their dimensions', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis([
        createFinding('dependency-cycle', 'src/core.ts', 'medium'),

        createFinding('large-blast-radius', 'src/core.ts', 'high'),

        createFinding('high-fan-in', 'src/core.ts', 'medium'),

        createFinding('high-fan-out', 'src/core.ts', 'high'),
      ]),

      analyzedFileCount: 10,
    });

    const dependencyHealth = result.dimensions.find(
      (dimension) => dimension.dimension === 'dependency-health',
    );

    const coupling = result.dimensions.find((dimension) => dimension.dimension === 'coupling');

    expect(dependencyHealth?.deductedPoints).toBe(3);

    expect(coupling?.deductedPoints).toBe(2);
  });

  it('supports a custom valid scoring policy', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        maintainability: {
          maxScore: 20,
        },

        'change-risk': {
          maxScore: 20,
        },

        'dependency-health': {
          maxScore: 20,
        },

        coupling: {
          maxScore: 20,
        },

        'resolution-quality': {
          maxScore: 20,
        },
      },
    };

    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(),

      analyzedFileCount: 10,

      policy,
    });

    expect(result.score).toBe(100);

    expect(result.dimensions.map((dimension) => dimension.maxScore)).toEqual([20, 20, 20, 20, 20]);
  });

  it('rejects an invalid scoring policy', () => {
    const invalidPolicy: HealthScorePolicy = {
      dimensions: {
        ...DEFAULT_HEALTH_SCORE_POLICY.dimensions,

        maintainability: {
          maxScore: 20,
        },
      },
    };

    expect(() =>
      calculateRepositoryHealthScore({
        deepAnalysis: createDeepAnalysis(),

        analyzedFileCount: 10,

        policy: invalidPolicy,
      }),
    ).toThrow('Health score dimension weights must total 100, received 95');
  });

  it('rejects negative analyzedFileCount', () => {
    expect(() =>
      calculateRepositoryHealthScore({
        deepAnalysis: createDeepAnalysis(),

        analyzedFileCount: -1,
      }),
    ).toThrow('analyzedFileCount must be a non-negative integer');
  });

  it('rejects fractional analyzedFileCount', () => {
    expect(() =>
      calculateRepositoryHealthScore({
        deepAnalysis: createDeepAnalysis(),

        analyzedFileCount: 10.5,
      }),
    ).toThrow('analyzedFileCount must be a non-negative integer');
  });

  it('returns 100 for an empty repository with no findings', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(),

      analyzedFileCount: 0,
    });

    expect(result.score).toBe(100);

    expect(result.rating).toBe('excellent');

    expect(result.analyzedFileCount).toBe(0);
  });

  it('keeps the final score equal to the sum of dimension scores', () => {
    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis([
        createFinding('high-complexity', 'src/a.ts', 'high'),

        createFinding('high-churn', 'src/b.ts', 'high'),

        createFinding('high-fan-out', 'src/c.ts', 'medium'),
      ]),

      analyzedFileCount: 5,
    });

    const dimensionTotal = result.dimensions.reduce(
      (total, dimension) => total + dimension.score,
      0,
    );

    expect(result.score).toBe(dimensionTotal);
  });

  it('produces a realistic mixed-risk repository score with explanations', () => {
    const findings: AnalysisFinding[] = [
      createFinding('high-complexity', 'src/core.ts', 'high'),

      createFinding('high-complexity', 'src/parser.ts', 'medium'),

      createFinding('high-churn', 'src/core.ts', 'medium'),

      createFinding('hotspot', 'src/core.ts', 'high'),

      {
        ...createFinding('dependency-cycle', 'src/core.ts', 'medium'),

        filePaths: ['src/core.ts', 'src/service.ts'],
      },

      createFinding('large-blast-radius', 'src/core.ts', 'high'),

      createFinding('high-fan-in', 'src/core.ts', 'high'),

      createFinding('high-fan-out', 'src/controller.ts', 'medium'),

      {
        ...createFinding('unresolved-imports', 'src/legacy.ts', 'low'),

        evidence: [
          {
            metric: 'unresolvedImportCount',

            value: 3,
          },
        ],
      },
    ];

    const hotspots = [createHotspot('src/core.ts', true)];

    const result = calculateRepositoryHealthScore({
      deepAnalysis: createDeepAnalysis(findings, hotspots),

      analyzedFileCount: 10,
    });

    expect(result.score).toBeGreaterThanOrEqual(0);

    expect(result.score).toBeLessThanOrEqual(100);

    expect(result.dimensions).toHaveLength(5);

    expect(
      result.dimensions.every(
        (dimension) => dimension.score >= 0 && dimension.score <= dimension.maxScore,
      ),
    ).toBe(true);

    expect(result.dimensions.some((dimension) => dimension.deductions.length > 0)).toBe(true);
  });
});
