import type { AnalysisFinding, AnalysisFindingSeverity } from '../deep-analysis/types.js';

export interface SeverityWeights {
  low: number;

  medium: number;

  high: number;
}

export const DEFAULT_SEVERITY_WEIGHTS = {
  low: 0.25,

  medium: 0.6,

  high: 1,
} satisfies SeverityWeights;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

export function getSeverityWeight(
  severity: AnalysisFindingSeverity,

  weights: SeverityWeights = DEFAULT_SEVERITY_WEIGHTS,
): number {
  return weights[severity];
}

export function calculateAffectedFileRatio(
  affectedFileCount: number,

  analyzedFileCount: number,
): number {
  validateNonNegativeInteger(affectedFileCount, 'affectedFileCount');

  validateNonNegativeInteger(analyzedFileCount, 'analyzedFileCount');

  if (analyzedFileCount === 0) {
    return 0;
  }

  return clamp(affectedFileCount / analyzedFileCount, 0, 1);
}

/*
 * Convert file-scoped findings into a normalized
 * 0..1 pressure value.
 *
 * Important:
 *
 * If the same file has several findings inside
 * one health dimension, we keep only the highest
 * severity weight for that file.
 *
 * Example:
 *
 * file A:
 *   medium complexity
 *   high hotspot
 *
 * contribution = 1.0
 *
 * NOT:
 *
 * 0.6 + 1.0 = 1.6
 *
 * This prevents repeatedly penalizing the exact
 * same file simply because several rules describe
 * the same underlying risk.
 */
export function calculateSeverityWeightedFilePressure(
  findings: readonly AnalysisFinding[],

  analyzedFileCount: number,

  weights: SeverityWeights = DEFAULT_SEVERITY_WEIGHTS,
): number {
  validateNonNegativeInteger(analyzedFileCount, 'analyzedFileCount');

  if (analyzedFileCount === 0 || findings.length === 0) {
    return 0;
  }

  const fileWeights = new Map<string, number>();

  for (const finding of findings) {
    const severityWeight = getSeverityWeight(finding.severity, weights);

    for (const filePath of finding.filePaths) {
      const currentWeight = fileWeights.get(filePath) ?? 0;

      if (severityWeight > currentWeight) {
        fileWeights.set(filePath, severityWeight);
      }
    }
  }

  const weightedFileTotal = [...fileWeights.values()].reduce((total, weight) => total + weight, 0);

  return clamp(weightedFileTotal / analyzedFileCount, 0, 1);
}

/*
 * Convert a normalized 0..1 pressure into an
 * integer number of points to deduct.
 *
 * Example:
 *
 * max deduction = 25
 * pressure       = 0.40
 *
 * deduction      = 10 points
 */
export function scalePressureToPoints(
  pressure: number,

  maxPoints: number,
): number {
  if (!Number.isFinite(pressure)) {
    throw new Error('pressure must be finite');
  }

  if (!Number.isInteger(maxPoints) || maxPoints < 0) {
    throw new Error('maxPoints must be a non-negative integer');
  }

  const normalizedPressure = clamp(pressure, 0, 1);

  return Math.round(normalizedPressure * maxPoints);
}
