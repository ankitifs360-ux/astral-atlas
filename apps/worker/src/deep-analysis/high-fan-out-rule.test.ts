import { describe, expect, it } from 'vitest';

import { findHighFanOutFiles } from './high-fan-out-rule.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createMetrics(
  files: {
    filePath: string;
    fanOut: number;
    transitiveDependencyCount?: number;
  }[],
): RepositoryMetrics {
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
        fanIn: 0,

        fanOut: file.fanOut,

        transitiveDependencyCount: file.transitiveDependencyCount ?? 0,
      },

      blastRadius: {
        affectedFileCount: 0,

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

function createThresholds(
  medium: number,

  high: number,
): DeepAnalysisThresholds {
  return {
    ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

    fanOut: {
      medium,

      high,
    },
  };
}

describe('findHighFanOutFiles', () => {
  it('returns no finding below the medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/simple.ts',

        fanOut: 7,
      },
    ]);

    expect(findHighFanOutFiles(metrics)).toEqual([]);
  });

  it('creates a medium finding at the exact medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/controller.ts',

        fanOut: 8,

        transitiveDependencyCount: 14,
      },
    ]);

    const finding = findHighFanOutFiles(metrics)[0];

    expect(finding).toMatchObject({
      kind: 'high-fan-out',

      severity: 'medium',

      title: 'High fan-out for src/controller.ts',

      filePaths: ['src/controller.ts'],

      evidence: [
        {
          metric: 'fanOut',

          value: 8,

          threshold: 8,
        },

        {
          metric: 'transitiveDependencyCount',

          value: 14,
        },
      ],
    });
  });

  it('creates a medium finding between medium and high thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/controller.ts',

        fanOut: 12,
      },
    ]);

    expect(findHighFanOutFiles(metrics)[0]?.severity).toBe('medium');
  });

  it('creates a high finding at the exact high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/orchestrator.ts',

        fanOut: 20,

        transitiveDependencyCount: 45,
      },
    ]);

    const finding = findHighFanOutFiles(metrics)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      evidence: [
        {
          metric: 'fanOut',

          value: 20,

          threshold: 20,
        },

        {
          metric: 'transitiveDependencyCount',

          value: 45,
        },
      ],
    });
  });

  it('creates a high finding above the high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/orchestrator.ts',

        fanOut: 30,
      },
    ]);

    expect(findHighFanOutFiles(metrics)[0]?.severity).toBe('high');
  });

  it('keeps transitive dependency count as supporting evidence', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/controller.ts',

        fanOut: 10,

        transitiveDependencyCount: 31,
      },
    ]);

    const finding = findHighFanOutFiles(metrics)[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'transitiveDependencyCount',

      value: 31,
    });
  });

  it('creates no finding when fan-out is zero', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/leaf.ts',

        fanOut: 0,
      },
    ]);

    expect(findHighFanOutFiles(metrics)).toEqual([]);
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/orchestrator.ts',

        fanOut: 24,
      },
    ]);

    const first = findHighFanOutFiles(metrics);

    const second = findHighFanOutFiles(metrics);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('returns findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        fanOut: 25,
      },

      {
        filePath: 'src/a.ts',

        fanOut: 9,
      },

      {
        filePath: 'src/m.ts',

        fanOut: 21,
      },
    ]);

    expect(findHighFanOutFiles(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('uses custom thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/controller.ts',

        fanOut: 4,

        transitiveDependencyCount: 9,
      },
    ]);

    const thresholds = createThresholds(3, 6);

    const finding = findHighFanOutFiles(metrics, thresholds)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'fanOut',

          value: 4,

          threshold: 3,
        },

        {
          metric: 'transitiveDependencyCount',

          value: 9,
        },
      ],
    });
  });

  it('includes fan-out information in the description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/orchestrator.ts',

        fanOut: 23,

        transitiveDependencyCount: 40,
      },
    ]);

    const finding = findHighFanOutFiles(metrics)[0];

    expect(finding?.description).toContain('directly depends on 23 other repository files');

    expect(finding?.description).toContain('strong coupling');
  });

  it('returns no findings for an empty repository', () => {
    expect(findHighFanOutFiles(createMetrics([]))).toEqual([]);
  });
});
