import { describe, expect, it } from 'vitest';

import { DEFAULT_GOD_FILE_RISK_THRESHOLDS } from './god-file-risk-thresholds.js';

import { findGodFileRisks } from './god-file-risk-rule.js';

import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

function createFileMetrics(
  filePath: string,

  overrides: Partial<FileMetrics> = {},
): FileMetrics {
  return {
    filePath,

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

    churn: {
      changedCommitCount: 0,
    },

    ...overrides,
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

describe('findGodFileRisks', () => {
  it('does not create a finding for only one active signal', () => {
    const metrics = createRepositoryMetrics([
      createFileMetrics('src/large.ts', {
        structure: {
          importCount: 0,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: 0,

          cyclomaticComplexity: 1,

          hasSyntaxErrors: false,
        },
      }),
    ]);

    expect(findGodFileRisks(metrics)).toEqual([]);
  });

  it('creates a medium finding when two signals are active', () => {
    const metrics = createRepositoryMetrics([
      createFileMetrics('src/service.ts', {
        dependencies: {
          fanIn: 0,

          fanOut: DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut.medium,

          transitiveDependencyCount: 8,
        },

        structure: {
          importCount: 8,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: 0,

          cyclomaticComplexity: 1,

          hasSyntaxErrors: false,
        },
      }),
    ]);

    const findings = findGodFileRisks(metrics);

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      kind: 'god-file-risk',

      severity: 'medium',

      title: 'God-file risk detected in src/service.ts',

      filePaths: ['src/service.ts'],
    });

    expect(findings[0]?.evidence).toEqual([
      {
        metric: 'godFileRiskSignalCount',

        value: 2,

        threshold: DEFAULT_GOD_FILE_RISK_THRESHOLDS.signalCount.medium,
      },

      {
        metric: 'functionCount',

        value: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

        threshold: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,
      },

      {
        metric: 'fanOut',

        value: DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut.medium,

        threshold: DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut.medium,
      },
    ]);
  });

  it('creates a high finding when at least four signals are active', () => {
    const metrics = createRepositoryMetrics([
      createFileMetrics('src/god-file.ts', {
        dependencies: {
          fanIn: 0,

          fanOut: DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut.medium,

          transitiveDependencyCount: 20,
        },

        structure: {
          importCount: 10,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.classCount.medium,

          cyclomaticComplexity: DEFAULT_GOD_FILE_RISK_THRESHOLDS.cyclomaticComplexity.medium,

          hasSyntaxErrors: false,
        },

        churn: {
          changedCommitCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.changedCommitCount.medium,
        },
      }),
    ]);

    const findings = findGodFileRisks(metrics);

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      kind: 'god-file-risk',

      severity: 'high',

      filePaths: ['src/god-file.ts'],
    });

    expect(findings[0]?.evidence.find((item) => item.metric === 'godFileRiskSignalCount')).toEqual({
      metric: 'godFileRiskSignalCount',

      value: 5,

      threshold: DEFAULT_GOD_FILE_RISK_THRESHOLDS.signalCount.high,
    });
  });

  it('does not treat unavailable Git history as high churn', () => {
    const metrics = createRepositoryMetrics([
      createFileMetrics('src/no-history.ts', {
        structure: {
          importCount: 0,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: 0,

          cyclomaticComplexity: 1,

          hasSyntaxErrors: false,
        },

        churn: null,
      }),
    ]);

    expect(findGodFileRisks(metrics)).toEqual([]);
  });

  it('includes churn evidence when Git history triggers the signal', () => {
    const metrics = createRepositoryMetrics([
      createFileMetrics('src/churn-heavy.ts', {
        structure: {
          importCount: 0,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: 0,

          cyclomaticComplexity: 1,

          hasSyntaxErrors: false,
        },

        churn: {
          changedCommitCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.changedCommitCount.medium,
        },
      }),
    ]);

    const findings = findGodFileRisks(metrics);

    expect(findings).toHaveLength(1);

    expect(findings[0]?.evidence.find((item) => item.metric === 'changedCommitCount')).toEqual({
      metric: 'changedCommitCount',

      value: DEFAULT_GOD_FILE_RISK_THRESHOLDS.changedCommitCount.medium,

      threshold: DEFAULT_GOD_FILE_RISK_THRESHOLDS.changedCommitCount.medium,
    });
  });

  it('sorts findings deterministically by file path', () => {
    const riskyFile = (filePath: string): FileMetrics =>
      createFileMetrics(filePath, {
        dependencies: {
          fanIn: 0,

          fanOut: DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut.medium,

          transitiveDependencyCount: 8,
        },

        structure: {
          importCount: 8,

          functionCount: DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount.medium,

          classCount: 0,

          cyclomaticComplexity: 1,

          hasSyntaxErrors: false,
        },
      });

    const metrics = createRepositoryMetrics([riskyFile('src/zeta.ts'), riskyFile('src/alpha.ts')]);

    expect(findGodFileRisks(metrics).map((finding) => finding.filePaths[0])).toEqual([
      'src/alpha.ts',
      'src/zeta.ts',
    ]);
  });
});
