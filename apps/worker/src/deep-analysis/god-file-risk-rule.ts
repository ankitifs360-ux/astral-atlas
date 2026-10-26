import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import {
  DEFAULT_GOD_FILE_RISK_THRESHOLDS,
  validateGodFileRiskThresholds,
} from './god-file-risk-thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { GodFileRiskThresholds } from './god-file-risk-thresholds.js';

import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

interface GodFileRiskSignals {
  manyFunctions: boolean;

  manyClasses: boolean;

  highComplexity: boolean;

  highFanOut: boolean;

  highChurn: boolean;

  signalCount: number;
}

function isAtLeastMedium(value: number, mediumThreshold: number): boolean {
  return value >= mediumThreshold;
}

function calculateSignals(
  file: FileMetrics,

  thresholds: GodFileRiskThresholds,
): GodFileRiskSignals {
  const manyFunctions = isAtLeastMedium(
    file.structure.functionCount,
    thresholds.functionCount.medium,
  );

  const manyClasses = isAtLeastMedium(file.structure.classCount, thresholds.classCount.medium);

  const highComplexity = isAtLeastMedium(
    file.structure.cyclomaticComplexity,
    thresholds.cyclomaticComplexity.medium,
  );

  const highFanOut = isAtLeastMedium(file.dependencies.fanOut, thresholds.fanOut.medium);

  /*
   * null means Git history was unavailable.
   *
   * Missing history must not be interpreted as
   * either low churn or high churn.
   */
  const highChurn =
    file.churn !== null &&
    isAtLeastMedium(file.churn.changedCommitCount, thresholds.changedCommitCount.medium);

  const signalCount = [manyFunctions, manyClasses, highComplexity, highFanOut, highChurn].filter(
    Boolean,
  ).length;

  return {
    manyFunctions,

    manyClasses,

    highComplexity,

    highFanOut,

    highChurn,

    signalCount,
  };
}

function describeActiveSignals(signals: GodFileRiskSignals): string {
  const labels: string[] = [];

  if (signals.manyFunctions) {
    labels.push('many functions');
  }

  if (signals.manyClasses) {
    labels.push('many classes');
  }

  if (signals.highComplexity) {
    labels.push('high complexity');
  }

  if (signals.highFanOut) {
    labels.push('high fan-out');
  }

  if (signals.highChurn) {
    labels.push('high churn');
  }

  return labels.join(', ');
}

function createEvidence(
  file: FileMetrics,

  signals: GodFileRiskSignals,

  thresholds: GodFileRiskThresholds,

  triggeredSignalThreshold: number,
): AnalysisFinding['evidence'] {
  const evidence: AnalysisFinding['evidence'] = [
    {
      metric: 'godFileRiskSignalCount',

      value: signals.signalCount,

      threshold: triggeredSignalThreshold,
    },
  ];

  if (signals.manyFunctions) {
    evidence.push({
      metric: 'functionCount',

      value: file.structure.functionCount,

      threshold: thresholds.functionCount.medium,
    });
  }

  if (signals.manyClasses) {
    evidence.push({
      metric: 'classCount',

      value: file.structure.classCount,

      threshold: thresholds.classCount.medium,
    });
  }

  if (signals.highComplexity) {
    evidence.push({
      metric: 'cyclomaticComplexity',

      value: file.structure.cyclomaticComplexity,

      threshold: thresholds.cyclomaticComplexity.medium,
    });
  }

  if (signals.highFanOut) {
    evidence.push({
      metric: 'fanOut',

      value: file.dependencies.fanOut,

      threshold: thresholds.fanOut.medium,
    });
  }

  if (signals.highChurn && file.churn !== null) {
    evidence.push({
      metric: 'changedCommitCount',

      value: file.churn.changedCommitCount,

      threshold: thresholds.changedCommitCount.medium,
    });
  }

  return evidence;
}

export function findGodFileRisks(
  metrics: RepositoryMetrics,

  thresholds: GodFileRiskThresholds = DEFAULT_GOD_FILE_RISK_THRESHOLDS,
): AnalysisFinding[] {
  validateGodFileRiskThresholds(thresholds);

  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    const signals = calculateSignals(file, thresholds);

    const severity = determineMetricSeverity(signals.signalCount, thresholds.signalCount);

    /*
     * A single large metric is not enough to label
     * a file as a god-file risk.
     *
     * This rule intentionally requires multiple
     * independent responsibility/risk signals.
     */
    if (severity === null) {
      continue;
    }

    const triggeredSignalThreshold = getTriggeredThreshold(severity, thresholds.signalCount);

    const activeSignals = describeActiveSignals(signals);

    findings.push({
      id: createFindingId('god-file-risk', [file.filePath]),

      kind: 'god-file-risk',

      severity,

      title: `God-file risk detected in ${file.filePath}`,

      description: `This file triggered ${signals.signalCount} independent god-file risk signals: ${activeSignals}. Concentrating many responsibilities, dependencies, complexity, or frequent changes in one file can increase technical debt and make the file harder to understand, test, and safely modify.`,

      filePaths: [file.filePath],

      evidence: createEvidence(file, signals, thresholds, triggeredSignalThreshold),
    });
  }

  return findings.sort((left, right) => {
    const leftPath = left.filePaths[0] ?? '';

    const rightPath = right.filePaths[0] ?? '';

    return leftPath.localeCompare(rightPath);
  });
}
