import type { MetricSeverityThreshold } from './thresholds.js';

export interface GodFileRiskThresholds {
  functionCount: MetricSeverityThreshold;

  classCount: MetricSeverityThreshold;

  cyclomaticComplexity: MetricSeverityThreshold;

  fanOut: MetricSeverityThreshold;

  changedCommitCount: MetricSeverityThreshold;

  /*
   * Number of independent god-file signals that
   * must be active before the file is considered
   * a technical-debt risk.
   *
   * Possible signals:
   *
   * - many functions
   * - many classes
   * - high complexity
   * - high fan-out
   * - high churn
   */
  signalCount: MetricSeverityThreshold;
}

export const DEFAULT_GOD_FILE_RISK_THRESHOLDS = {
  functionCount: {
    medium: 15,

    high: 30,
  },

  classCount: {
    medium: 5,

    high: 10,
  },

  cyclomaticComplexity: {
    medium: 20,

    high: 40,
  },

  fanOut: {
    medium: 8,

    high: 15,
  },

  changedCommitCount: {
    medium: 10,

    high: 20,
  },

  signalCount: {
    medium: 2,

    high: 4,
  },
} satisfies GodFileRiskThresholds;

function validateMetricThreshold(
  name: string,

  threshold: MetricSeverityThreshold,
): void {
  if (!Number.isInteger(threshold.medium) || threshold.medium < 0) {
    throw new Error(`God-file-risk threshold ${name}.medium must be a non-negative integer.`);
  }

  if (!Number.isInteger(threshold.high) || threshold.high < 0) {
    throw new Error(`God-file-risk threshold ${name}.high must be a non-negative integer.`);
  }

  if (threshold.high < threshold.medium) {
    throw new Error(
      `God-file-risk threshold ${name}.high must be greater than or equal to ${name}.medium.`,
    );
  }
}

export function validateGodFileRiskThresholds(thresholds: GodFileRiskThresholds): void {
  validateMetricThreshold('functionCount', thresholds.functionCount);

  validateMetricThreshold('classCount', thresholds.classCount);

  validateMetricThreshold('cyclomaticComplexity', thresholds.cyclomaticComplexity);

  validateMetricThreshold('fanOut', thresholds.fanOut);

  validateMetricThreshold('changedCommitCount', thresholds.changedCommitCount);

  validateMetricThreshold('signalCount', thresholds.signalCount);

  if (thresholds.signalCount.medium > 5 || thresholds.signalCount.high > 5) {
    throw new Error('God-file-risk signal thresholds cannot exceed 5.');
  }
}
