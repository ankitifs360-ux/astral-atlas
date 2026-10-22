import type { HealthScoreDimension } from './types.js';

export interface HealthScoreDimensionPolicy {
  maxScore: number;
}

export interface HealthScorePolicy {
  dimensions: Record<HealthScoreDimension, HealthScoreDimensionPolicy>;
}

export const DEFAULT_HEALTH_SCORE_POLICY = {
  dimensions: {
    maintainability: {
      maxScore: 25,
    },

    'change-risk': {
      maxScore: 20,
    },

    'dependency-health': {
      maxScore: 25,
    },

    coupling: {
      maxScore: 20,
    },

    'resolution-quality': {
      maxScore: 10,
    },
  },
} satisfies HealthScorePolicy;

export const TOTAL_HEALTH_SCORE = 100;

export function validateHealthScorePolicy(policy: HealthScorePolicy): void {
  const dimensions: HealthScoreDimension[] = [
    'maintainability',
    'change-risk',
    'dependency-health',
    'coupling',
    'resolution-quality',
  ];

  let total = 0;

  for (const dimension of dimensions) {
    const maxScore = policy.dimensions[dimension].maxScore;

    if (!Number.isInteger(maxScore) || maxScore <= 0) {
      throw new Error(
        `Health score dimension "${dimension}" must have a positive integer maxScore`,
      );
    }

    total += maxScore;
  }

  if (total !== TOTAL_HEALTH_SCORE) {
    throw new Error(
      `Health score dimension weights must total ${TOTAL_HEALTH_SCORE}, received ${total}`,
    );
  }
}
