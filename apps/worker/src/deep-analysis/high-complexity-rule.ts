import {
  createFindingId,
  determineMetricSeverity,
  getTriggeredThreshold,
} from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFinding } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

export function findHighComplexityFiles(
  metrics: RepositoryMetrics,

  thresholds: DeepAnalysisThresholds = DEFAULT_DEEP_ANALYSIS_THRESHOLDS,
): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const file of metrics.files) {
    const complexity = file.structure.cyclomaticComplexity;

    const severity = determineMetricSeverity(complexity, thresholds.cyclomaticComplexity);

    if (severity === null) {
      continue;
    }

    const threshold = getTriggeredThreshold(severity, thresholds.cyclomaticComplexity);

    findings.push({
      id: createFindingId('high-complexity', [file.filePath]),

      kind: 'high-complexity',

      severity,

      title: `High cyclomatic complexity in ${file.filePath}`,

      description: `This file has cyclomatic complexity ${complexity}, which indicates many independent control-flow paths and can make the code harder to understand, test, and modify safely.`,

      filePaths: [file.filePath],

      evidence: [
        {
          metric: 'cyclomaticComplexity',

          value: complexity,

          threshold,
        },
      ],
    });
  }

  /*
   * Individual metric rules remain ordered by
   * file path.
   *
   * The final B9 aggregator will later use
   * sortFindings() to globally prioritize:
   *
   * high -> medium -> low.
   */
  return findings.sort((left, right) => {
    const leftPath = left.filePaths[0] ?? '';

    const rightPath = right.filePaths[0] ?? '';

    return leftPath.localeCompare(rightPath);
  });
}
