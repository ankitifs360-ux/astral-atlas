import { describe, expect, it } from 'vitest';

import { scoreOnboardingCandidates } from './candidate-scorer.js';

import type {
  AnalysisFinding,
  DeepAnalysisResult,
  FileHotspotSignals,
} from '../deep-analysis/types.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { EntryPointCandidate } from './entry-point-detector.js';

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

function createFinding(kind: AnalysisFinding['kind'], filePaths: string[]): AnalysisFinding {
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

function createHotspot(filePath: string, signalCount = 3): FileHotspotSignals {
  return {
    filePath,

    highComplexity: true,

    highChurn: true,

    largeBlastRadius: true,

    highFanIn: false,

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

function createEntryPoint(
  filePath: string,
  reasons: EntryPointCandidate['reasons'] = ['dependency-root'],
): EntryPointCandidate {
  return {
    filePath,

    score: 50,

    reasons,
  };
}

describe('scoreOnboardingCandidates', () => {
  it('gives an entry-point signal a weight of 50', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/server.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result[0]).toEqual({
      filePath: 'src/server.ts',

      score: 50,

      signals: [
        {
          kind: 'entry-point',

          weight: 50,

          description: 'Likely repository entry point based on dependency-graph structure.',
        },
      ],
    });
  });

  it('uses the conventional-name entry-point explanation when there is no dependency-root reason', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/main.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [createEntryPoint('src/main.ts', ['conventional-name'])],
    });

    expect(result[0]?.signals[0]).toEqual({
      kind: 'entry-point',

      weight: 50,

      description: 'Likely repository entry point based on a conventional startup filename.',
    });
  });

  it('adds a high fan-in signal', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/shared.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([createFinding('high-fan-in', ['src/shared.ts'])]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(20);

    expect(result[0]?.signals).toContainEqual({
      kind: 'high-fan-in',

      weight: 20,

      description:
        'Many repository files directly depend on this file, making it useful for understanding shared behavior.',
    });
  });

  it('adds a high fan-out signal', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/orchestrator.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([createFinding('high-fan-out', ['src/orchestrator.ts'])]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(12);

    expect(result[0]?.signals).toContainEqual({
      kind: 'high-fan-out',

      weight: 12,

      description:
        'This file directly depends on many other repository files and may reveal how major components are connected.',
    });
  });

  it('adds a large blast-radius signal', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([createFinding('large-blast-radius', ['src/core.ts'])]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(18);
  });

  it('adds a hotspot signal', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([], [createHotspot('src/core.ts', 4)]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(25);

    expect(result[0]?.signals).toContainEqual({
      kind: 'hotspot',

      weight: 25,

      description:
        'This file combines 4 important repository signals and is a strong architectural hotspot.',
    });
  });

  it('adds a dependency-cycle signal', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/a.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([
        createFinding('dependency-cycle', ['src/a.ts', 'src/b.ts']),
      ]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(10);

    expect(result[0]?.signals).toContainEqual({
      kind: 'dependency-cycle',

      weight: 10,

      description:
        'This file participates in a dependency cycle and helps explain tightly coupled parts of the repository.',
    });
  });

  it('combines multiple explainable signals', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(
        [
          createFinding('high-fan-in', ['src/core.ts']),

          createFinding('large-blast-radius', ['src/core.ts']),

          createFinding('dependency-cycle', ['src/core.ts', 'src/service.ts']),
        ],

        [createHotspot('src/core.ts')],
      ),

      entryPoints: [createEntryPoint('src/core.ts')],
    });

    /*
     * entry point        = 50
     * high fan-in        = 20
     * blast radius       = 18
     * hotspot            = 25
     * dependency cycle   = 10
     *
     * total              = 123
     */
    expect(result[0]?.score).toBe(123);

    expect(result[0]?.signals.map((signal) => signal.kind)).toEqual([
      'entry-point',
      'high-fan-in',
      'large-blast-radius',
      'hotspot',
      'dependency-cycle',
    ]);
  });

  it('adds capped graph importance bonuses', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',

          fanIn: 30,

          fanOut: 20,

          affectedFileCount: 100,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [],
    });

    /*
     * fan-in bonus       max 10
     * fan-out bonus      max 5
     * blast bonus        max 10
     *
     * total = 25
     */
    expect(result[0]?.score).toBe(25);
  });

  it('adds graph bonuses together with signals', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 2,

          fanOut: 4,

          affectedFileCount: 6,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    /*
     * entry point = 50
     * fan-in      = 2
     * fan-out     = 4
     * blast       = 6
     *
     * total = 62
     */
    expect(result[0]?.score).toBe(62);
  });

  it('does not duplicate the same signal when a finding contains a file once', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([createFinding('high-fan-in', ['src/core.ts'])]),

      entryPoints: [],
    });

    expect(result[0]?.signals.filter((signal) => signal.kind === 'high-fan-in')).toHaveLength(1);
  });

  it('does not duplicate a signal when multiple findings of the same kind contain the same file', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/core.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([
        createFinding('high-fan-in', ['src/core.ts']),

        createFinding('high-fan-in', ['src/core.ts']),
      ]),

      entryPoints: [],
    });

    expect(result[0]?.score).toBe(20);

    expect(result[0]?.signals).toHaveLength(1);
  });

  it('returns ordinary files even when they have no special signals', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/helper.ts',

          fanIn: 0,

          fanOut: 0,

          affectedFileCount: 0,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [],
    });

    expect(result).toEqual([
      {
        filePath: 'src/helper.ts',

        score: 0,

        signals: [],
      },
    ]);
  });

  it('orders higher-scoring candidates first', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/helper.ts',
        },

        {
          filePath: 'src/core.ts',
        },

        {
          filePath: 'src/server.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis(
        [createFinding('high-fan-in', ['src/core.ts'])],

        [createHotspot('src/core.ts')],
      ),

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.map((candidate) => candidate.filePath)).toEqual([
      'src/server.ts',
      'src/core.ts',
      'src/helper.ts',
    ]);
  });

  it('uses lexical file-path ordering when scores tie', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/z.ts',

          fanIn: 2,
        },

        {
          filePath: 'src/a.ts',

          fanIn: 2,
        },
      ]),

      deepAnalysis: createDeepAnalysis(),

      entryPoints: [],
    });

    expect(result.map((candidate) => candidate.filePath)).toEqual(['src/a.ts', 'src/z.ts']);
  });

  it('ignores B9 findings that are not onboarding signals', () => {
    const result = scoreOnboardingCandidates({
      metrics: createMetrics([
        {
          filePath: 'src/parser.ts',
        },
      ]),

      deepAnalysis: createDeepAnalysis([
        createFinding('high-complexity', ['src/parser.ts']),

        createFinding('high-churn', ['src/parser.ts']),

        createFinding('unresolved-imports', ['src/parser.ts']),
      ]),

      entryPoints: [],
    });

    expect(result).toEqual([
      {
        filePath: 'src/parser.ts',

        score: 0,

        signals: [],
      },
    ]);
  });

  it('returns an empty array for an empty repository', () => {
    expect(
      scoreOnboardingCandidates({
        metrics: createMetrics([]),

        deepAnalysis: createDeepAnalysis(),

        entryPoints: [],
      }),
    ).toEqual([]);
  });
});
