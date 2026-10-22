import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

export function findHighFanInFiles(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    const fanIn = file.dependencies.fanIn;

    const severity = determineMetricSeverity(fanIn, thresholds.fanIn);

    if (severity === null) {
      continue;
    }

    const threshold = getTriggeredThreshold(severity, thresholds.fanIn);

    findings.push({
      id: createFindingId('high-fan-in', [file.filePath]),

      kind: 'high-fan-in',

      severity,

      title: `High fan-in for ${file.filePath}`,

      description: `This file is directly imported by ${fanIn} other repository files. High fan-in often indicates a shared or central module, so changes to it may require careful compatibility review even when its own implementation is small.`,

      filePaths: [file.filePath],

      evidence: [
        {
          metric: 'fanIn',

          value: fanIn,

          threshold,
        },

        {
          metric: 'affectedFileCount',

          value: file.blastRadius.affectedFileCount,
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
