import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GOD_FILE_RISK_THRESHOLDS,
  validateGodFileRiskThresholds,
} from './god-file-risk-thresholds.js';

import type { GodFileRiskThresholds } from './god-file-risk-thresholds.js';

function createThresholds(overrides: Partial<GodFileRiskThresholds> = {}): GodFileRiskThresholds {
  return {
    functionCount: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.functionCount,
    },

    classCount: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.classCount,
    },

    cyclomaticComplexity: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.cyclomaticComplexity,
    },

    fanOut: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.fanOut,
    },

    changedCommitCount: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.changedCommitCount,
    },

    signalCount: {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS.signalCount,
    },

    ...overrides,
  };
}

describe('validateGodFileRiskThresholds', () => {
  it('accepts the default thresholds', () => {
    expect(() => validateGodFileRiskThresholds(DEFAULT_GOD_FILE_RISK_THRESHOLDS)).not.toThrow();
  });

  it('accepts equal medium and high thresholds', () => {
    const thresholds = createThresholds({
      functionCount: {
        medium: 10,

        high: 10,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).not.toThrow();
  });

  it('rejects negative medium thresholds', () => {
    const thresholds = createThresholds({
      classCount: {
        medium: -1,

        high: 10,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).toThrow(
      'God-file-risk threshold classCount.medium must be a non-negative integer.',
    );
  });

  it('rejects fractional high thresholds', () => {
    const thresholds = createThresholds({
      cyclomaticComplexity: {
        medium: 20,

        high: 40.5,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).toThrow(
      'God-file-risk threshold cyclomaticComplexity.high must be a non-negative integer.',
    );
  });

  it('rejects high thresholds below medium thresholds', () => {
    const thresholds = createThresholds({
      fanOut: {
        medium: 12,

        high: 8,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).toThrow(
      'God-file-risk threshold fanOut.high must be greater than or equal to fanOut.medium.',
    );
  });

  it('rejects signal medium thresholds above the available signal count', () => {
    const thresholds = createThresholds({
      signalCount: {
        medium: 6,

        high: 6,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).toThrow(
      'God-file-risk signal thresholds cannot exceed 5.',
    );
  });

  it('rejects signal high thresholds above the available signal count', () => {
    const thresholds = createThresholds({
      signalCount: {
        medium: 2,

        high: 6,
      },
    });

    expect(() => validateGodFileRiskThresholds(thresholds)).toThrow(
      'God-file-risk signal thresholds cannot exceed 5.',
    );
  });
});
