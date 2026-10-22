import { describe, expect, it } from 'vitest';

import { findHighChurnFiles } from './high-churn-rule.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createMetrics(
  files: {
    filePath: string;
    changedCommitCount: number | null;
  }[],
): RepositoryMetrics {
  const availableChurn = files
    .map((file) => file.changedCommitCount)
    .filter((value): value is number => value !== null);

  const historyAvailable = availableChurn.length > 0;

  const totalChangedCommitCount = historyAvailable
    ? availableChurn.reduce((total, value) => total + value, 0)
    : null;

  const maxChangedCommitCount = historyAvailable ? Math.max(...availableChurn) : null;

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

      historyAvailable,

      totalChangedCommitCount,

      averageChangedCommitCount:
        historyAvailable && totalChangedCommitCount !== null
          ? totalChangedCommitCount / files.length
          : null,

      maxChangedCommitCount,
    },

    files: files.map((file) => ({
      filePath: file.filePath,

      dependencies: {
        fanIn: 0,

        fanOut: 0,

        transitiveDependencyCount: 0,
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

      churn:
        file.changedCommitCount === null
          ? null
          : {
              changedCommitCount: file.changedCommitCount,
            },
    })),
  };
}

function createThresholds(
  medium: number,

  high: number,
): DeepAnalysisThresholds {
  return {
    ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

    changedCommitCount: {
      medium,

      high,
    },
  };
}

describe('findHighChurnFiles', () => {
  it('returns no finding below the medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/stable.ts',

        changedCommitCount: 4,
      },
    ]);

    expect(findHighChurnFiles(metrics)).toEqual([]);
  });

  it('creates a medium finding at the exact medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        changedCommitCount: 5,
      },
    ]);

    const finding = findHighChurnFiles(metrics)[0];

    expect(finding).toMatchObject({
      kind: 'high-churn',

      severity: 'medium',

      title: 'High change frequency in src/service.ts',

      filePaths: ['src/service.ts'],

      evidence: [
        {
          metric: 'changedCommitCount',

          value: 5,

          threshold: 5,
        },
      ],
    });
  });

  it('creates a medium finding between medium and high thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        changedCommitCount: 10,
      },
    ]);

    expect(findHighChurnFiles(metrics)[0]?.severity).toBe('medium');
  });

  it('creates a high finding at the exact high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        changedCommitCount: 15,
      },
    ]);

    const finding = findHighChurnFiles(metrics)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      evidence: [
        {
          metric: 'changedCommitCount',

          value: 15,

          threshold: 15,
        },
      ],
    });
  });

  it('creates a high finding above the high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        changedCommitCount: 28,
      },
    ]);

    expect(findHighChurnFiles(metrics)[0]?.severity).toBe('high');
  });

  it('creates no finding when Git history is unavailable', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/uploaded.ts',

        changedCommitCount: null,
      },
    ]);

    expect(findHighChurnFiles(metrics)).toEqual([]);
  });

  it('creates no finding for zero churn', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/new.ts',

        changedCommitCount: 0,
      },
    ]);

    expect(findHighChurnFiles(metrics)).toEqual([]);
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        changedCommitCount: 20,
      },
    ]);

    const first = findHighChurnFiles(metrics);

    const second = findHighChurnFiles(metrics);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('returns findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        changedCommitCount: 20,
      },

      {
        filePath: 'src/a.ts',

        changedCommitCount: 8,
      },

      {
        filePath: 'src/m.ts',

        changedCommitCount: 16,
      },
    ]);

    expect(findHighChurnFiles(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('uses custom thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        changedCommitCount: 3,
      },
    ]);

    const thresholds = createThresholds(2, 4);

    const finding = findHighChurnFiles(metrics, thresholds)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'changedCommitCount',

          value: 3,

          threshold: 2,
        },
      ],
    });
  });

  it('includes an explanation in the finding description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/auth.ts',

        changedCommitCount: 18,
      },
    ]);

    const finding = findHighChurnFiles(metrics)[0];

    expect(finding?.description).toContain('changed in 18 commits');

    expect(finding?.description).toContain('maintenance');
  });

  it('returns no findings for an empty repository', () => {
    expect(findHighChurnFiles(createMetrics([]))).toEqual([]);
  });
});
