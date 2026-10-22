import { calculateChangeRiskScore } from './change-risk-score.js';

import { calculateCouplingScore } from './coupling-score.js';

import { calculateDependencyHealthScore } from './dependency-health-score.js';

import { calculateMaintainabilityScore } from './maintainability-score.js';

import { DEFAULT_HEALTH_SCORE_POLICY, validateHealthScorePolicy } from './policy.js';

import { calculateResolutionQualityScore } from './resolution-quality-score.js';

import type { DeepAnalysisResult } from '../deep-analysis/types.js';

import type { HealthScorePolicy } from './policy.js';

import type { RepositoryHealthRating, RepositoryHealthScore } from './types.js';

export interface RepositoryHealthScoreInput {
  deepAnalysis: DeepAnalysisResult;

  analyzedFileCount: number;

  policy?: HealthScorePolicy;
}

export function determineRepositoryHealthRating(score: number): RepositoryHealthRating {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error('Repository health score must be an integer between 0 and 100');
  }

  if (score >= 90) {
    return 'excellent';
  }

  if (score >= 75) {
    return 'good';
  }

  if (score >= 60) {
    return 'fair';
  }

  if (score >= 40) {
    return 'poor';
  }

  return 'critical';
}

export function calculateRepositoryHealthScore(
  input: RepositoryHealthScoreInput,
): RepositoryHealthScore {
  if (!Number.isInteger(input.analyzedFileCount) || input.analyzedFileCount < 0) {
    throw new Error('analyzedFileCount must be a non-negative integer');
  }

  const policy = input.policy ?? DEFAULT_HEALTH_SCORE_POLICY;

  /*
   * Validate the score distribution once at the
   * B10 orchestration boundary.
   */
  validateHealthScorePolicy(policy);

  const maintainability = calculateMaintainabilityScore({
    findings: input.deepAnalysis.findings,

    analyzedFileCount: input.analyzedFileCount,

    maxScore: policy.dimensions.maintainability.maxScore,
  });

  const changeRisk = calculateChangeRiskScore({
    findings: input.deepAnalysis.findings,

    hotspots: input.deepAnalysis.hotspots,

    analyzedFileCount: input.analyzedFileCount,

    maxScore: policy.dimensions['change-risk'].maxScore,
  });

  const dependencyHealth = calculateDependencyHealthScore({
    findings: input.deepAnalysis.findings,

    analyzedFileCount: input.analyzedFileCount,

    maxScore: policy.dimensions['dependency-health'].maxScore,
  });

  const coupling = calculateCouplingScore({
    findings: input.deepAnalysis.findings,

    analyzedFileCount: input.analyzedFileCount,

    maxScore: policy.dimensions.coupling.maxScore,
  });

  const resolutionQuality = calculateResolutionQualityScore({
    findings: input.deepAnalysis.findings,

    analyzedFileCount: input.analyzedFileCount,

    maxScore: policy.dimensions['resolution-quality'].maxScore,
  });

  /*
   * Keep dimension ordering stable because this
   * order will eventually be useful to the API/UI.
   */
  const dimensions = [maintainability, changeRisk, dependencyHealth, coupling, resolutionQuality];

  const score = dimensions.reduce((total, dimension) => total + dimension.score, 0);

  return {
    score,

    rating: determineRepositoryHealthRating(score),

    dimensions,

    analyzedFileCount: input.analyzedFileCount,
  };
}
