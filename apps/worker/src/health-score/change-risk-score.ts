import { calculateSeverityWeightedFilePressure, scalePressureToPoints } from './normalization.js';

import type { AnalysisFinding, FileHotspotSignals } from '../deep-analysis/types.js';

import type { HealthScoreDimensionResult } from './types.js';

export interface ChangeRiskScoreInput {
  findings: readonly AnalysisFinding[];

  hotspots: readonly FileHotspotSignals[];

  analyzedFileCount: number;

  maxScore: number;
}

export function calculateChangeRiskScore(input: ChangeRiskScoreInput): HealthScoreDimensionResult {
  const highChurnFindings = input.findings.filter((finding) => finding.kind === 'high-churn');

  /*
   * Only hotspots that actually include churn
   * belong in the change-risk dimension.
   *
   * A hotspot caused by:
   *
   * complexity + fan-in
   *
   * should not affect change risk.
   */
  const churnHotspotFilePaths = new Set(
    input.hotspots.filter((hotspot) => hotspot.highChurn).map((hotspot) => hotspot.filePath),
  );

  const churnHotspotFindings = input.findings.filter(
    (finding) =>
      finding.kind === 'hotspot' &&
      finding.filePaths.some((filePath) => churnHotspotFilePaths.has(filePath)),
  );

  /*
   * The normalization helper deduplicates files.
   *
   * Example:
   *
   * src/core.ts
   *   high-churn = medium
   *   hotspot    = high
   *
   * contribution:
   *
   * max(0.6, 1.0)
   * = 1.0
   *
   * NOT:
   *
   * 0.6 + 1.0
   */
  const relevantFindings = [...highChurnFindings, ...churnHotspotFindings];

  const pressure = calculateSeverityWeightedFilePressure(relevantFindings, input.analyzedFileCount);

  const deductedPoints = scalePressureToPoints(pressure, input.maxScore);

  const affectedFilePaths = [
    ...new Set(relevantFindings.flatMap((finding) => finding.filePaths)),
  ].sort();

  const churnFileCount = new Set(highChurnFindings.flatMap((finding) => finding.filePaths)).size;

  const churnHotspotCount = churnHotspotFilePaths.size;

  return {
    dimension: 'change-risk',

    maxScore: input.maxScore,

    score: input.maxScore - deductedPoints,

    deductedPoints,

    deductions:
      deductedPoints === 0
        ? []
        : [
            {
              reason: 'change-risk',

              description: `${churnFileCount} frequently changed file${churnFileCount === 1 ? '' : 's'} exceeded the churn threshold, including ${churnHotspotCount} file${churnHotspotCount === 1 ? '' : 's'} where churn overlaps with other hotspot signals. Frequently modified high-risk files deserve extra review and regression testing.`,

              points: deductedPoints,

              filePaths: affectedFilePaths,
            },
          ],
  };
}
