import { calculateSeverityWeightedFilePressure, scalePressureToPoints } from './normalization.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { HealthScoreDimensionResult } from './types.js';

export interface CouplingScoreInput {
  findings: readonly AnalysisFinding[];

  analyzedFileCount: number;

  maxScore: number;
}

export function calculateCouplingScore(input: CouplingScoreInput): HealthScoreDimensionResult {
  const couplingFindings = input.findings.filter(
    (finding) => finding.kind === 'high-fan-in' || finding.kind === 'high-fan-out',
  );

  const pressure = calculateSeverityWeightedFilePressure(couplingFindings, input.analyzedFileCount);

  const deductedPoints = scalePressureToPoints(pressure, input.maxScore);

  const affectedFilePaths = [
    ...new Set(couplingFindings.flatMap((finding) => finding.filePaths)),
  ].sort();

  const fanInFindings = couplingFindings.filter((finding) => finding.kind === 'high-fan-in');

  const fanOutFindings = couplingFindings.filter((finding) => finding.kind === 'high-fan-out');

  return {
    dimension: 'coupling',

    maxScore: input.maxScore,

    score: input.maxScore - deductedPoints,

    deductedPoints,

    deductions:
      deductedPoints === 0
        ? []
        : [
            {
              reason: 'coupling',

              description: `${fanInFindings.length} high fan-in finding${fanInFindings.length === 1 ? '' : 's'} and ${fanOutFindings.length} high fan-out finding${fanOutFindings.length === 1 ? '' : 's'} affected ${affectedFilePaths.length} file${affectedFilePaths.length === 1 ? '' : 's'}. Strong incoming or outgoing dependency concentration can make modules harder to isolate and evolve safely.`,

              points: deductedPoints,

              filePaths: affectedFilePaths,
            },
          ],
  };
}
