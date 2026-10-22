import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

export function findLargeBlastRadiusFiles(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    const affectedFileCount = file.blastRadius.affectedFileCount;

    const severity = determineMetricSeverity(affectedFileCount, thresholds.affectedFileCount);

    if (severity === null) {
      continue;
    }

    const threshold = getTriggeredThreshold(severity, thresholds.affectedFileCount);

    findings.push({
      id: createFindingId('large-blast-radius', [file.filePath]),

      kind: 'large-blast-radius',

      severity,

      title: `Large blast radius for ${file.filePath}`,

      description: `Changes to this file could transitively affect ${affectedFileCount} other files, with the furthest dependent ${file.blastRadius.maxDistance} dependency hops away. Files with large blast radius can require broader regression testing and more careful review.`,

      filePaths: [file.filePath],

      evidence: [
        {
          metric: 'affectedFileCount',

          value: affectedFileCount,

          threshold,
        },

        {
          metric: 'maxBlastRadiusDistance',

          value: file.blastRadius.maxDistance,
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
