import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

export function findHighFanOutFiles(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    const fanOut = file.dependencies.fanOut;

    const severity = determineMetricSeverity(fanOut, thresholds.fanOut);

    if (severity === null) {
      continue;
    }

    const threshold = getTriggeredThreshold(severity, thresholds.fanOut);

    findings.push({
      id: createFindingId('high-fan-out', [file.filePath]),

      kind: 'high-fan-out',

      severity,

      title: `High fan-out for ${file.filePath}`,

      description: `This file directly depends on ${fanOut} other repository files. High fan-out can indicate strong coupling or an orchestration module that knows about many parts of the codebase, which can make changes harder to reason about.`,

      filePaths: [file.filePath],

      evidence: [
        {
          metric: 'fanOut',

          value: fanOut,

          threshold,
        },

        {
          metric: 'transitiveDependencyCount',

          value: file.dependencies.transitiveDependencyCount,
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
