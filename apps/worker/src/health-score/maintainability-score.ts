import { calculateSeverityWeightedFilePressure, scalePressureToPoints } from './normalization.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { HealthScoreDimensionResult } from './types.js';

export interface MaintainabilityScoreInput {
  findings: readonly AnalysisFinding[];

  analyzedFileCount: number;

  maxScore: number;
}

export function calculateMaintainabilityScore(
  input: MaintainabilityScoreInput,
): HealthScoreDimensionResult {
  const complexityFindings = input.findings.filter((finding) => finding.kind === 'high-complexity');

  const pressure = calculateSeverityWeightedFilePressure(
    complexityFindings,
    input.analyzedFileCount,
  );

  const deductedPoints = scalePressureToPoints(pressure, input.maxScore);

  const affectedFilePaths = [
    ...new Set(complexityFindings.flatMap((finding) => finding.filePaths)),
  ].sort();

  return {
    dimension: 'maintainability',

    maxScore: input.maxScore,

    score: input.maxScore - deductedPoints,

    deductedPoints,

    deductions:
      deductedPoints === 0
        ? []
        : [
            {
              reason: 'high-complexity',

              description: `${affectedFilePaths.length} file${affectedFilePaths.length === 1 ? '' : 's'} exceeded the configured cyclomatic complexity threshold. Higher complexity can make code harder to understand, test, and safely modify.`,

              points: deductedPoints,

              filePaths: affectedFilePaths,
            },
          ],
  };
}
