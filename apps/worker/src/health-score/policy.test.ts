import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HEALTH_SCORE_POLICY,
  TOTAL_HEALTH_SCORE,
  validateHealthScorePolicy,
} from './policy.js';

import type { HealthScorePolicy } from './policy.js';

describe('health score policy', () => {
  it('uses a total health score of 100', () => {
    expect(TOTAL_HEALTH_SCORE).toBe(100);
  });

  it('assigns the expected default dimension weights', () => {
    expect(DEFAULT_HEALTH_SCORE_POLICY).toEqual({
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
    });
  });

  it('accepts the default policy', () => {
    expect(() => validateHealthScorePolicy(DEFAULT_HEALTH_SCORE_POLICY)).not.toThrow();
  });

  it('accepts another valid policy that totals 100', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        maintainability: {
          maxScore: 20,
        },

        'change-risk': {
          maxScore: 20,
        },

        'dependency-health': {
          maxScore: 20,
        },

        coupling: {
          maxScore: 20,
        },

        'resolution-quality': {
          maxScore: 20,
        },
      },
    };

    expect(() => validateHealthScorePolicy(policy)).not.toThrow();
  });

  it('rejects a policy whose dimensions total less than 100', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        maintainability: {
          maxScore: 20,
        },

        'change-risk': {
          maxScore: 20,
        },

        'dependency-health': {
          maxScore: 20,
        },

        coupling: {
          maxScore: 20,
        },

        'resolution-quality': {
          maxScore: 10,
        },
      },
    };

    expect(() => validateHealthScorePolicy(policy)).toThrow(
      'Health score dimension weights must total 100, received 90',
    );
  });

  it('rejects a policy whose dimensions total more than 100', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        maintainability: {
          maxScore: 30,
        },

        'change-risk': {
          maxScore: 25,
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
    };

    expect(() => validateHealthScorePolicy(policy)).toThrow(
      'Health score dimension weights must total 100, received 110',
    );
  });

  it('rejects zero maxScore values', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        ...DEFAULT_HEALTH_SCORE_POLICY.dimensions,

        maintainability: {
          maxScore: 0,
        },
      },
    };

    expect(() => validateHealthScorePolicy(policy)).toThrow(
      'Health score dimension "maintainability" must have a positive integer maxScore',
    );
  });

  it('rejects negative maxScore values', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        ...DEFAULT_HEALTH_SCORE_POLICY.dimensions,

        coupling: {
          maxScore: -5,
        },
      },
    };

    expect(() => validateHealthScorePolicy(policy)).toThrow(
      'Health score dimension "coupling" must have a positive integer maxScore',
    );
  });

  it('rejects fractional maxScore values', () => {
    const policy: HealthScorePolicy = {
      dimensions: {
        ...DEFAULT_HEALTH_SCORE_POLICY.dimensions,

        'resolution-quality': {
          maxScore: 10.5,
        },
      },
    };

    expect(() => validateHealthScorePolicy(policy)).toThrow(
      'Health score dimension "resolution-quality" must have a positive integer maxScore',
    );
  });
});
