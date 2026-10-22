export interface MetricSeverityThreshold {
  /*
   * Crossing this value creates a medium-severity
   * finding.
   */
  medium: number;

  /*
   * Crossing this value upgrades the finding to
   * high severity.
   */
  high: number;
}

export interface DeepAnalysisThresholds {
  cyclomaticComplexity: MetricSeverityThreshold;

  changedCommitCount: MetricSeverityThreshold;

  affectedFileCount: MetricSeverityThreshold;

  fanIn: MetricSeverityThreshold;

  fanOut: MetricSeverityThreshold;

  /*
   * Hotspots combine independent signals rather
   * than looking at one metric alone.
   *
   * Current possible signals:
   *
   * - high complexity
   * - high churn
   * - large blast radius
   * - high fan-in
   * - dependency-cycle membership
   */
  hotspotSignalCount: MetricSeverityThreshold;
}

/*
 * These are Astral Atlas heuristics, not universal
 * software-engineering laws.
 *
 * Keeping them centralized means we can later tune
 * them from real repository data without rewriting
 * rule logic throughout B9.
 */
export const DEFAULT_DEEP_ANALYSIS_THRESHOLDS = {
  cyclomaticComplexity: {
    medium: 10,

    high: 20,
  },

  changedCommitCount: {
    medium: 5,

    high: 15,
  },

  affectedFileCount: {
    medium: 5,

    high: 20,
  },

  fanIn: {
    medium: 5,

    high: 15,
  },

  fanOut: {
    medium: 8,

    high: 20,
  },

  hotspotSignalCount: {
    medium: 2,

    high: 3,
  },
} satisfies DeepAnalysisThresholds;

function validateMetricThreshold(name: string, threshold: MetricSeverityThreshold): void {
  if (!Number.isInteger(threshold.medium) || threshold.medium < 0) {
    throw new Error(`Deep-analysis threshold ${name}.medium must be a non-negative integer.`);
  }

  if (!Number.isInteger(threshold.high) || threshold.high < 0) {
    throw new Error(`Deep-analysis threshold ${name}.high must be a non-negative integer.`);
  }

  if (threshold.high < threshold.medium) {
    throw new Error(
      `Deep-analysis threshold ${name}.high must be greater than or equal to ${name}.medium.`,
    );
  }
}

export function validateDeepAnalysisThresholds(thresholds: DeepAnalysisThresholds): void {
  validateMetricThreshold('cyclomaticComplexity', thresholds.cyclomaticComplexity);

  validateMetricThreshold('changedCommitCount', thresholds.changedCommitCount);

  validateMetricThreshold('affectedFileCount', thresholds.affectedFileCount);

  validateMetricThreshold('fanIn', thresholds.fanIn);

  validateMetricThreshold('fanOut', thresholds.fanOut);

  validateMetricThreshold('hotspotSignalCount', thresholds.hotspotSignalCount);

  /*
   * We currently have five possible hotspot
   * signals.
   */
  if (thresholds.hotspotSignalCount.medium > 5 || thresholds.hotspotSignalCount.high > 5) {
    throw new Error('Deep-analysis hotspot signal thresholds cannot exceed 5.');
  }
}
