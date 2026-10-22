import { calculateSeverityWeightedFilePressure, scalePressureToPoints } from './normalization.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { HealthScoreDimensionResult } from './types.js';

export interface DependencyHealthScoreInput {
  findings: readonly AnalysisFinding[];

  analyzedFileCount: number;

  maxScore: number;
}

export function calculateDependencyHealthScore(
  input: DependencyHealthScoreInput,
): HealthScoreDimensionResult {
  const dependencyFindings = input.findings.filter(
    (finding) => finding.kind === 'dependency-cycle' || finding.kind === 'large-blast-radius',
  );

  const pressure = calculateSeverityWeightedFilePressure(
    dependencyFindings,
    input.analyzedFileCount,
  );

  const deductedPoints = scalePressureToPoints(pressure, input.maxScore);

  const affectedFilePaths = [
    ...new Set(dependencyFindings.flatMap((finding) => finding.filePaths)),
  ].sort();

  const cycleFindings = dependencyFindings.filter((finding) => finding.kind === 'dependency-cycle');

  const blastRadiusFindings = dependencyFindings.filter(
    (finding) => finding.kind === 'large-blast-radius',
  );

  return {
    dimension: 'dependency-health',

    maxScore: input.maxScore,

    score: input.maxScore - deductedPoints,

    deductedPoints,

    deductions:
      deductedPoints === 0
        ? []
        : [
            {
              reason: 'dependency-health',

              description: `${cycleFindings.length} dependency cycle${cycleFindings.length === 1 ? '' : 's'} and ${blastRadiusFindings.length} large blast-radius finding${blastRadiusFindings.length === 1 ? '' : 's'} affected ${affectedFilePaths.length} file${affectedFilePaths.length === 1 ? '' : 's'}. Cyclic and widely depended-on modules can make changes harder to isolate and increase regression risk.`,

              points: deductedPoints,

              filePaths: affectedFilePaths,
            },
          ],
  };
}
