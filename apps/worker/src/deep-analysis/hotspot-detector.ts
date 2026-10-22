import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding, FileHotspotSignals } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

export interface HotspotDetectionResult {
  findings: AnalysisFinding[];

  hotspots: FileHotspotSignals[];
}

function isAtLeastMedium(value: number, mediumThreshold: number): boolean {
  return value >= mediumThreshold;
}

function calculateSignals(
  file: FileMetrics,

  thresholds: DeepAnalysisThresholds,
): FileHotspotSignals {
  const highComplexity = isAtLeastMedium(
    file.structure.cyclomaticComplexity,
    thresholds.cyclomaticComplexity.medium,
  );

  /*
   * null means Git history was unavailable.
   *
   * Unknown history must not count as either
   * low churn or high churn.
   */
  const highChurn =
    file.churn !== null &&
    isAtLeastMedium(file.churn.changedCommitCount, thresholds.changedCommitCount.medium);

  const largeBlastRadius = isAtLeastMedium(
    file.blastRadius.affectedFileCount,
    thresholds.affectedFileCount.medium,
  );

  const highFanIn = isAtLeastMedium(file.dependencies.fanIn, thresholds.fanIn.medium);

  const inDependencyCycle = file.cycles.inDependencyCycle;

  const signalCount = [
    highComplexity,
    highChurn,
    largeBlastRadius,
    highFanIn,
    inDependencyCycle,
  ].filter(Boolean).length;

  return {
    filePath: file.filePath,

    highComplexity,

    highChurn,

    largeBlastRadius,

    highFanIn,

    inDependencyCycle,

    signalCount,
  };
}

function createHotspotEvidence(
  file: FileMetrics,

  signals: FileHotspotSignals,

  thresholds: DeepAnalysisThresholds,

  triggeredSignalThreshold: number,
): AnalysisFinding['evidence'] {
  const evidence: AnalysisFinding['evidence'] = [
    {
      metric: 'hotspotSignalCount',

      value: signals.signalCount,

      threshold: triggeredSignalThreshold,
    },
  ];

  if (signals.highComplexity) {
    evidence.push({
      metric: 'cyclomaticComplexity',

      value: file.structure.cyclomaticComplexity,

      threshold: thresholds.cyclomaticComplexity.medium,
    });
  }

  if (signals.highChurn && file.churn !== null) {
    evidence.push({
      metric: 'changedCommitCount',

      value: file.churn.changedCommitCount,

      threshold: thresholds.changedCommitCount.medium,
    });
  }

  if (signals.largeBlastRadius) {
    evidence.push({
      metric: 'affectedFileCount',

      value: file.blastRadius.affectedFileCount,

      threshold: thresholds.affectedFileCount.medium,
    });
  }

  if (signals.highFanIn) {
    evidence.push({
      metric: 'fanIn',

      value: file.dependencies.fanIn,

      threshold: thresholds.fanIn.medium,
    });
  }

  if (signals.inDependencyCycle) {
    evidence.push({
      metric: 'inDependencyCycle',

      value: true,
    });

    evidence.push({
      metric: 'cyclicComponentSize',

      value: file.cycles.cyclicComponentSize,
    });
  }

  return evidence;
}

function describeActiveSignals(signals: FileHotspotSignals): string {
  const labels: string[] = [];

  if (signals.highComplexity) {
    labels.push('high complexity');
  }

  if (signals.highChurn) {
    labels.push('high churn');
  }

  if (signals.largeBlastRadius) {
    labels.push('large blast radius');
  }

  if (signals.highFanIn) {
    labels.push('high fan-in');
  }

  if (signals.inDependencyCycle) {
    labels.push('dependency-cycle membership');
  }

  return labels.join(', ');
}

export function detectFileHotspots(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): HotspotDetectionResult {
  const findings: AnalysisFinding[] = [];

  const hotspots: FileHotspotSignals[] = [];

  for (const file of metrics.files) {
    const signals = calculateSignals(file, thresholds);

    const severity = determineMetricSeverity(signals.signalCount, thresholds.hotspotSignalCount);

    /*
     * Files with only one isolated signal are not
     * considered hotspots by default.
     *
     * They may still receive an individual finding
     * such as high-complexity or high-churn.
     */
    if (severity === null) {
      continue;
    }

    hotspots.push(signals);

    const triggeredSignalThreshold = getTriggeredThreshold(severity, thresholds.hotspotSignalCount);

    const activeSignals = describeActiveSignals(signals);

    findings.push({
      id: createFindingId('hotspot', [file.filePath]),

      kind: 'hotspot',

      severity,

      title: `Code hotspot detected in ${file.filePath}`,

      description: `This file triggered ${signals.signalCount} independent hotspot signals: ${activeSignals}. Multiple risk signals occurring together make this file a stronger candidate for careful review than any single metric alone.`,

      filePaths: [file.filePath],

      evidence: createHotspotEvidence(file, signals, thresholds, triggeredSignalThreshold),
    });
  }

  hotspots.sort((left, right) => left.filePath.localeCompare(right.filePath));

  findings.sort((left, right) => {
    const leftPath = left.filePaths[0] ?? '';

    const rightPath = right.filePaths[0] ?? '';

    return leftPath.localeCompare(rightPath);
  });

  return {
    findings,

    hotspots,
  };
}
