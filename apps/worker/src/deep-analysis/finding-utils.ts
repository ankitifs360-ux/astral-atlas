import { createHash } from 'node:crypto';

import type { AnalysisFinding, AnalysisFindingKind, AnalysisFindingSeverity } from './types.js';

import type { MetricSeverityThreshold } from './thresholds.js';

/*
 * Creates a stable finding ID from:
 *
 * - finding kind
 * - affected file paths
 * - optional discriminator
 *
 * File paths are sorted first so:
 *
 * [a.ts, b.ts]
 *
 * and:
 *
 * [b.ts, a.ts]
 *
 * produce the same ID.
 */
export function createFindingId(
  kind: AnalysisFindingKind,
  filePaths: readonly string[],
  discriminator?: string,
): string {
  const normalizedFilePaths = [...filePaths].sort();

  const parts = [kind, ...normalizedFilePaths];

  if (discriminator !== undefined) {
    parts.push(discriminator);
  }

  const hash = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);

  return `finding:${hash}`;
}

/*
 * Converts a raw metric value into a finding
 * severity according to one metric threshold.
 *
 * Example:
 *
 * threshold:
 * medium = 10
 * high   = 20
 *
 * value 8  -> null
 * value 10 -> medium
 * value 19 -> medium
 * value 20 -> high
 */
export function determineMetricSeverity(
  value: number,
  threshold: MetricSeverityThreshold,
): AnalysisFindingSeverity | null {
  if (value >= threshold.high) {
    return 'high';
  }

  if (value >= threshold.medium) {
    return 'medium';
  }

  return null;
}

export function getTriggeredThreshold(
  severity: AnalysisFindingSeverity,
  threshold: MetricSeverityThreshold,
): number {
  if (severity === 'high') {
    return threshold.high;
  }

  /*
   * Metric rules currently generate medium/high
   * findings.
   *
   * "low" remains part of the general finding
   * contract for other B9 rules later.
   */
  return threshold.medium;
}

function severityRank(severity: AnalysisFindingSeverity): number {
  switch (severity) {
    case 'high':
      return 0;

    case 'medium':
      return 1;

    case 'low':
      return 2;
  }
}

/*
 * Central deterministic ordering for findings.
 *
 * Higher-severity findings come first.
 *
 * Within the same severity:
 *
 * kind -> file paths -> id
 *
 * provides stable output between analyses.
 */
export function sortFindings(findings: readonly AnalysisFinding[]): AnalysisFinding[] {
  return [...findings].sort((left, right) => {
    const severityOrder = severityRank(left.severity) - severityRank(right.severity);

    if (severityOrder !== 0) {
      return severityOrder;
    }

    const kindOrder = left.kind.localeCompare(right.kind);

    if (kindOrder !== 0) {
      return kindOrder;
    }

    const leftPaths = left.filePaths.join('\0');

    const rightPaths = right.filePaths.join('\0');

    const pathOrder = leftPaths.localeCompare(rightPaths);

    if (pathOrder !== 0) {
      return pathOrder;
    }

    return left.id.localeCompare(right.id);
  });
}
