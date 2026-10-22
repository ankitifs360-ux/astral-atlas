import { describe, expect, it } from 'vitest';

import { findHighComplexityFiles } from './high-complexity-rule.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createMetrics(
  files: {
    filePath: string;
    complexity: number;
  }[],
): RepositoryMetrics {
  const totalCyclomaticComplexity = files.reduce((total, file) => total + file.complexity, 0);

  const maxCyclomaticComplexity =
    files.length === 0 ? 0 : Math.max(...files.map((file) => file.complexity));

  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity,

      averageCyclomaticComplexity:
        files.length === 0 ? 0 : totalCyclomaticComplexity / files.length,

      maxCyclomaticComplexity,

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

        cyclomaticComplexity: file.complexity,

        hasSyntaxErrors: false,
      },

      churn: null,
    })),
  };
}

function createThresholds(
  complexityMedium: number,

  complexityHigh: number,
): DeepAnalysisThresholds {
  return {
    ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

    cyclomaticComplexity: {
      medium: complexityMedium,

      high: complexityHigh,
    },
  };
}

describe('findHighComplexityFiles', () => {
  it('returns no finding below the medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/simple.ts',

        complexity: 9,
      },
    ]);

    expect(findHighComplexityFiles(metrics)).toEqual([]);
  });

  it('creates a medium finding at the exact medium threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        complexity: 10,
      },
    ]);

    const findings = findHighComplexityFiles(metrics);

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      kind: 'high-complexity',

      severity: 'medium',

      title: 'High cyclomatic complexity in src/service.ts',

      filePaths: ['src/service.ts'],

      evidence: [
        {
          metric: 'cyclomaticComplexity',

          value: 10,

          threshold: 10,
        },
      ],
    });
  });

  it('creates a medium finding between medium and high thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        complexity: 15,
      },
    ]);

    expect(findHighComplexityFiles(metrics)[0]?.severity).toBe('medium');
  });

  it('creates a high finding at the exact high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 20,
      },
    ]);

    const finding = findHighComplexityFiles(metrics)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      evidence: [
        {
          metric: 'cyclomaticComplexity',

          value: 20,

          threshold: 20,
        },
      ],
    });
  });

  it('creates a high finding above the high threshold', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 42,
      },
    ]);

    expect(findHighComplexityFiles(metrics)[0]?.severity).toBe('high');
  });

  it('produces deterministic finding ids', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 24,
      },
    ]);

    const first = findHighComplexityFiles(metrics);

    const second = findHighComplexityFiles(metrics);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('uses different finding ids for different files', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/a.ts',

        complexity: 20,
      },

      {
        filePath: 'src/b.ts',

        complexity: 20,
      },
    ]);

    const findings = findHighComplexityFiles(metrics);

    expect(findings[0]?.id).not.toBe(findings[1]?.id);
  });

  it('returns findings in deterministic file-path order', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/z.ts',

        complexity: 25,
      },

      {
        filePath: 'src/a.ts',

        complexity: 30,
      },

      {
        filePath: 'src/m.ts',

        complexity: 15,
      },
    ]);

    expect(findHighComplexityFiles(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('uses custom thresholds', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/service.ts',

        complexity: 6,
      },
    ]);

    const thresholds = createThresholds(5, 8);

    const finding = findHighComplexityFiles(metrics, thresholds)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      evidence: [
        {
          metric: 'cyclomaticComplexity',

          value: 6,

          threshold: 5,
        },
      ],
    });
  });

  it('includes an explanation in the finding description', () => {
    const metrics = createMetrics([
      {
        filePath: 'src/parser.ts',

        complexity: 25,
      },
    ]);

    const finding = findHighComplexityFiles(metrics)[0];

    expect(finding?.description).toContain('cyclomatic complexity 25');

    expect(finding?.description).toContain('control-flow paths');
  });

  it('returns no findings for an empty repository', () => {
    expect(findHighComplexityFiles(createMetrics([]))).toEqual([]);
  });
});
