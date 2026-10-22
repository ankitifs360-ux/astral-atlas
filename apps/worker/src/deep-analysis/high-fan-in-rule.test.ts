import { describe, expect, it } from 'vitest';

import { findHighFanInFiles } from './high-fan-in-rule.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createMetrics(
  files: {
    filePath: string;
    fanIn: number;
    affectedFileCount?: number;
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
        fanIn: file.fanIn,

        fanOut: 0,

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

function createThresholds(
  medium: number,

  high: number,
): DeepAnalysisThresholds {
  return {
    ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

    fanIn: {
      medium,

      high,
    },
  };
}

describe('findHighFanInFiles', () => {
  it('returns no finding below the medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/local.ts',

        fanIn: 4,
      },
    ]);

    expect(findHighFanInFiles(metrics)).toEqual([]);
  });

  it('creates a medium finding at the exact medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/utils.ts',

        fanIn: 5,

        affectedFileCount: 9,
      },
    ]);

    const finding = findHighFanInFiles(metrics)[0];

    expect(finding).toMatchObject({
      kind: 'high-fan-in',

      severity: 'medium',

      title: 'High fan-in for src/utils.ts',

      filePaths: ['src/utils.ts'],

      evidence: [
        {
          metric: 'fanIn',

          value: 5,

          threshold: 5,
        },

        {
          metric: 'affectedFileCount',

          value: 9,
        },
      ],
    });
  });

  it('creates a medium finding between medium and high thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/utils.ts',

        fanIn: 10,
      },
    ]);

    expect(findHighFanInFiles(metrics)[0]?.severity).toBe('medium');
  });

  it('creates a high finding at the exact high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        fanIn: 15,

        affectedFileCount: 30,
      },
    ]);

    const finding = findHighFanInFiles(metrics)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      evidence: [
        {
          metric: 'fanIn',

          value: 15,

          threshold: 15,
        },

        {
          metric: 'affectedFileCount',

          value: 30,
        },
      ],
    });
  });

  it('creates a high finding above the high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        fanIn: 28,
      },
    ]);

    expect(findHighFanInFiles(metrics)[0]?.severity).toBe('high');
  });

  it('keeps blast radius as supporting evidence', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/shared.ts',

        fanIn: 6,

        affectedFileCount: 22,
      },
    ]);

    const finding = findHighFanInFiles(metrics)[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'affectedFileCount',

      value: 22,
    });
  });

  it('creates no finding when fan-in is zero', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/entry.ts',

        fanIn: 0,
      },
    ]);

    expect(findHighFanInFiles(metrics)).toEqual([]);
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        fanIn: 20,
      },
    ]);

    const first = findHighFanInFiles(metrics);

    const second = findHighFanInFiles(metrics);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('returns findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        fanIn: 20,
      },

      {
        filePath: 'src/a.ts',

        fanIn: 7,
      },

      {
        filePath: 'src/m.ts',

        fanIn: 16,
      },
    ]);

    expect(findHighFanInFiles(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('uses custom thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/shared.ts',

        fanIn: 3,
      },
    ]);

    const thresholds = createThresholds(2, 4);

    const finding = findHighFanInFiles(metrics, thresholds)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'fanIn',

          value: 3,

          threshold: 2,
        },

        {
          metric: 'affectedFileCount',

          value: 0,
        },
      ],
    });
  });

  it('includes fan-in information in the description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        fanIn: 18,

        affectedFileCount: 25,
      },
    ]);

    const finding = findHighFanInFiles(metrics)[0];

    expect(finding?.description).toContain('directly imported by 18 other repository files');

    expect(finding?.description).toContain('shared or central module');
  });

  it('returns no findings for an empty repository', () => {
    expect(findHighFanInFiles(createMetrics([]))).toEqual([]);
  });
});
