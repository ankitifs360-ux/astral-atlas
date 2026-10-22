import { describe, expect, it } from 'vitest';

import { findLargeBlastRadiusFiles } from './large-blast-radius-rule.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createMetrics(
  files: {
    filePath: string;
    affectedFileCount: number;
    maxDistance: number;
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

        fanOut: 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: file.affectedFileCount,

        maxDistance: file.maxDistance,
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

    affectedFileCount: {
      medium,

      high,
    },
  };
}

describe('findLargeBlastRadiusFiles', () => {
  it('returns no finding below the medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/local.ts',

        affectedFileCount: 4,

        maxDistance: 2,
      },
    ]);

    expect(findLargeBlastRadiusFiles(metrics)).toEqual([]);
  });

  it('creates a medium finding at the exact medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        affectedFileCount: 5,

        maxDistance: 3,
      },
    ]);

    const finding = findLargeBlastRadiusFiles(metrics)[0];

    expect(finding).toMatchObject({
      kind: 'large-blast-radius',

      severity: 'medium',

      title: 'Large blast radius for src/service.ts',

      filePaths: ['src/service.ts'],

      evidence: [
        {
          metric: 'affectedFileCount',

          value: 5,

          threshold: 5,
        },

        {
          metric: 'maxBlastRadiusDistance',

          value: 3,
        },
      ],
    });
  });

  it('creates a medium finding between medium and high thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        affectedFileCount: 12,

        maxDistance: 4,
      },
    ]);

    expect(findLargeBlastRadiusFiles(metrics)[0]?.severity).toBe('medium');
  });

  it('creates a high finding at the exact high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/database.ts',

        affectedFileCount: 20,

        maxDistance: 5,
      },
    ]);

    const finding = findLargeBlastRadiusFiles(metrics)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      evidence: [
        {
          metric: 'affectedFileCount',

          value: 20,

          threshold: 20,
        },

        {
          metric: 'maxBlastRadiusDistance',

          value: 5,
        },
      ],
    });
  });

  it('creates a high finding above the high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/database.ts',

        affectedFileCount: 42,

        maxDistance: 8,
      },
    ]);

    expect(findLargeBlastRadiusFiles(metrics)[0]?.severity).toBe('high');
  });

  it('keeps max distance as supporting evidence', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/core.ts',

        affectedFileCount: 6,

        maxDistance: 7,
      },
    ]);

    const finding = findLargeBlastRadiusFiles(metrics)[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'maxBlastRadiusDistance',

      value: 7,
    });
  });

  it('creates no finding for an isolated file', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/isolated.ts',

        affectedFileCount: 0,

        maxDistance: 0,
      },
    ]);

    expect(findLargeBlastRadiusFiles(metrics)).toEqual([]);
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/database.ts',

        affectedFileCount: 25,

        maxDistance: 5,
      },
    ]);

    const first = findLargeBlastRadiusFiles(metrics);

    const second = findLargeBlastRadiusFiles(metrics);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('returns findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        affectedFileCount: 30,

        maxDistance: 4,
      },

      {
        filePath: 'src/a.ts',

        affectedFileCount: 7,

        maxDistance: 2,
      },

      {
        filePath: 'src/m.ts',

        affectedFileCount: 22,

        maxDistance: 3,
      },
    ]);

    expect(findLargeBlastRadiusFiles(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('uses custom thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        affectedFileCount: 3,

        maxDistance: 2,
      },
    ]);

    const thresholds = createThresholds(2, 4);

    const finding = findLargeBlastRadiusFiles(metrics, thresholds)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'affectedFileCount',

          value: 3,

          threshold: 2,
        },

        {
          metric: 'maxBlastRadiusDistance',

          value: 2,
        },
      ],
    });
  });

  it('includes affected-file count and distance in the description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/database.ts',

        affectedFileCount: 25,

        maxDistance: 6,
      },
    ]);

    const finding = findLargeBlastRadiusFiles(metrics)[0];

    expect(finding?.description).toContain('25 other files');

    expect(finding?.description).toContain('6 dependency hops');
  });

  it('returns no findings for an empty repository', () => {
    expect(findLargeBlastRadiusFiles(createMetrics([]))).toEqual([]);
  });
});
