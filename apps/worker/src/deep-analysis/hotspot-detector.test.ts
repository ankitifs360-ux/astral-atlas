import { describe, expect, it } from 'vitest';

import { detectFileHotspots } from './hotspot-detector.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

interface TestFileInput {
  filePath: string;

  complexity?: number;

  changedCommitCount?: number | null;

  affectedFileCount?: number;

  fanIn?: number;

  inDependencyCycle?: boolean;

  cyclicComponentSize?: number;
}

function createMetrics(files: TestFileInput[]): RepositoryMetrics {
  const hasHistory = files.some(
    (file) => file.changedCommitCount !== undefined && file.changedCommitCount !== null,
  );

  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: files.filter((file) => file.inDependencyCycle === true).length,

      totalCyclomaticComplexity: files.reduce((total, file) => total + (file.complexity ?? 1), 0),

      averageCyclomaticComplexity:
        files.length === 0
          ? 0
          : files.reduce((total, file) => total + (file.complexity ?? 1), 0) / files.length,

      maxCyclomaticComplexity:
        files.length === 0 ? 0 : Math.max(...files.map((file) => file.complexity ?? 1)),

      historyAvailable: hasHistory,

      totalChangedCommitCount: hasHistory
        ? files.reduce((total, file) => total + (file.changedCommitCount ?? 0), 0)
        : null,

      averageChangedCommitCount: hasHistory
        ? files.reduce((total, file) => total + (file.changedCommitCount ?? 0), 0) / files.length
        : null,

      maxChangedCommitCount:
        hasHistory && files.length > 0
          ? Math.max(...files.map((file) => file.changedCommitCount ?? 0))
          : null,
    },

    files: files.map((file) => ({
      filePath: file.filePath,

      dependencies: {
        fanIn: file.fanIn ?? 0,

        fanOut: 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: file.affectedFileCount ?? 0,

        maxDistance: 0,
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

function createThresholds(
  mediumSignals: number,

  highSignals: number,
): DeepAnalysisThresholds {
  return {
    ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

    hotspotSignalCount: {
      medium: mediumSignals,

      high: highSignals,
    },
  };
}

describe('detectFileHotspots', () => {
  it('does not create a hotspot from only one active signal', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 25,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.findings).toEqual([]);

    expect(result.hotspots).toEqual([]);
  });

  it('creates a medium hotspot when exactly two signals are active', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        complexity: 12,

        changedCommitCount: 7,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.findings).toHaveLength(1);

    expect(result.hotspots).toEqual([
      {
        filePath: 'src/service.ts',

        highComplexity: true,

        highChurn: true,

        largeBlastRadius: false,

        highFanIn: false,

        inDependencyCycle: false,

        signalCount: 2,
      },
    ]);

    expect(result.findings[0]).toMatchObject({
      kind: 'hotspot',

      severity: 'medium',

      title: 'Code hotspot detected in src/service.ts',

      filePaths: ['src/service.ts'],
    });
  });

  it('creates a high hotspot when exactly three signals are active', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        complexity: 14,

        changedCommitCount: 8,

        affectedFileCount: 7,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.hotspots[0]?.signalCount).toBe(3);

    expect(result.findings[0]?.severity).toBe('high');
  });

  it('counts all five available hotspot signals', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        complexity: 25,

        changedCommitCount: 20,

        affectedFileCount: 30,

        fanIn: 18,

        inDependencyCycle: true,

        cyclicComponentSize: 4,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.hotspots[0]).toEqual({
      filePath: 'src/core.ts',

      highComplexity: true,

      highChurn: true,

      largeBlastRadius: true,

      highFanIn: true,

      inDependencyCycle: true,

      signalCount: 5,
    });

    expect(result.findings[0]?.severity).toBe('high');
  });

  it('does not treat unavailable Git history as a churn signal', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/uploaded.ts',

        complexity: 12,

        changedCommitCount: null,

        affectedFileCount: 6,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.hotspots[0]).toMatchObject({
      highComplexity: true,

      highChurn: false,

      largeBlastRadius: true,

      signalCount: 2,
    });
  });

  it('uses dependency-cycle membership as a hotspot signal', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/cyclic.ts',

        complexity: 11,

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.hotspots[0]).toMatchObject({
      highComplexity: true,

      inDependencyCycle: true,

      signalCount: 2,
    });

    expect(result.findings[0]?.severity).toBe('medium');
  });

  it('includes only active signals in finding evidence', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        complexity: 12,

        fanIn: 6,
      },
    ]);

    const finding = detectFileHotspots(metrics).findings[0];

    expect(finding?.evidence).toEqual([
      {
        metric: 'hotspotSignalCount',

        value: 2,

        threshold: 2,
      },

      {
        metric: 'cyclomaticComplexity',

        value: 12,

        threshold: 10,
      },

      {
        metric: 'fanIn',

        value: 6,

        threshold: 5,
      },
    ]);
  });

  it('includes cycle component size as supporting evidence', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/cyclic.ts',

        affectedFileCount: 6,

        inDependencyCycle: true,

        cyclicComponentSize: 4,
      },
    ]);

    const finding = detectFileHotspots(metrics).findings[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'inDependencyCycle',

      value: true,
    });

    expect(finding?.evidence).toContainEqual({
      metric: 'cyclicComponentSize',

      value: 4,
    });
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        complexity: 20,

        changedCommitCount: 10,
      },
    ]);

    const first = detectFileHotspots(metrics);

    const second = detectFileHotspots(metrics);

    expect(first.findings[0]?.id).toBe(second.findings[0]?.id);

    expect(first.findings[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('returns hotspots and findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        complexity: 20,

        fanIn: 8,
      },

      {
        filePath: 'src/a.ts',

        changedCommitCount: 7,

        affectedFileCount: 8,
      },

      {
        filePath: 'src/m.ts',

        complexity: 15,

        inDependencyCycle: true,

        cyclicComponentSize: 2,
      },
    ]);

    const result = detectFileHotspots(metrics);

    expect(result.hotspots.map((hotspot) => hotspot.filePath)).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);

    expect(result.findings.map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('supports custom hotspot signal thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 12,
      },
    ]);

    const thresholds = createThresholds(1, 2);

    const result = detectFileHotspots(metrics, thresholds);

    expect(result.findings[0]).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'hotspotSignalCount',

          value: 1,

          threshold: 1,
        },

        {
          metric: 'cyclomaticComplexity',

          value: 12,

          threshold: 10,
        },
      ],
    });
  });

  it('includes active signal names in the description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        complexity: 15,

        changedCommitCount: 9,

        affectedFileCount: 10,
      },
    ]);

    const finding = detectFileHotspots(metrics).findings[0];

    expect(finding?.description).toContain('3 independent hotspot signals');

    expect(finding?.description).toContain('high complexity');

    expect(finding?.description).toContain('high churn');

    expect(finding?.description).toContain('large blast radius');
  });

  it('returns empty results for an empty repository', () => {
    expect(detectFileHotspots(createMetrics([]))).toEqual({
      findings: [],

      hotspots: [],
    });
  });
});
