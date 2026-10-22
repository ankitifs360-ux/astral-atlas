import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

export function findHighChurnFiles(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    /*
     * null means Git history was unavailable.
     *
     * We must not interpret that as:
     *
     * changedCommitCount = 0
     */
    if (file.churn === null) {
      continue;
    }

    const changedCommitCount = file.churn.changedCommitCount;

    const severity = determineMetricSeverity(changedCommitCount, thresholds.changedCommitCount);

    if (severity === null) {
      continue;
    }

    const threshold = getTriggeredThreshold(severity, thresholds.changedCommitCount);

    findings.push({
      id: createFindingId('high-churn', [file.filePath]),

      kind: 'high-churn',

      severity,

      title: `High change frequency in ${file.filePath}`,

      description: `This file changed in ${changedCommitCount} commits within the analyzed Git history window. Frequently modified files can require extra attention because they are more exposed to ongoing maintenance and regression risk.`,

      filePaths: [file.filePath],

      evidence: [
        {
          metric: 'changedCommitCount',

          value: changedCommitCount,

          threshold,
        },
      ],
    });
  }

  return findings.sort((left, right) => {
    const leftPath = left.filePaths[0] ?? '';

    const rightPath = right.filePaths[0] ?? '';

    return leftPath.localeCompare(rightPath);
  });
}
