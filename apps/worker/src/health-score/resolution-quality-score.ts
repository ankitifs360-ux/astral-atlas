import { calculateSeverityWeightedFilePressure, scalePressureToPoints } from './normalization.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { HealthScoreDimensionResult } from './types.js';

export interface ResolutionQualityScoreInput {
  findings: readonly AnalysisFinding[];

  analyzedFileCount: number;

  maxScore: number;
}

export function calculateResolutionQualityScore(
  input: ResolutionQualityScoreInput,
): HealthScoreDimensionResult {
  const unresolvedImportFindings = input.findings.filter(
    (finding) => finding.kind === 'unresolved-imports',
  );

  const pressure = calculateSeverityWeightedFilePressure(
    unresolvedImportFindings,
    input.analyzedFileCount,
  );

  const deductedPoints = scalePressureToPoints(pressure, input.maxScore);

  const affectedFilePaths = [
    ...new Set(unresolvedImportFindings.flatMap((finding) => finding.filePaths)),
  ].sort();

  const unresolvedImportCount = unresolvedImportFindings.reduce((total, finding) => {
    const evidence = finding.evidence.find(
      (item) => item.metric === 'unresolvedImportCount' && typeof item.value === 'number',
    );

    if (evidence === undefined || typeof evidence.value !== 'number') {
      return total;
    }

    return total + evidence.value;
  }, 0);

  return {
    dimension: 'resolution-quality',

    maxScore: input.maxScore,

    score: input.maxScore - deductedPoints,

    deductedPoints,

    deductions:
      deductedPoints === 0
        ? []
        : [
            {
              reason: 'unresolved-imports',

              description: `${unresolvedImportCount} unresolved import${unresolvedImportCount === 1 ? '' : 's'} were found across ${affectedFilePaths.length} file${affectedFilePaths.length === 1 ? '' : 's'}. Unresolved imports reduce confidence in the dependency graph, although some may result from unsupported aliases, generated files, or framework-specific resolution behavior.`,

              points: deductedPoints,

              filePaths: affectedFilePaths,
            },
          ],
  };
}
