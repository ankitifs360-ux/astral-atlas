import { describe, expect, it } from 'vitest';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS, validateDeepAnalysisThresholds } from './thresholds.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function createThresholds(overrides: Partial<DeepAnalysisThresholds> = {}): DeepAnalysisThresholds {
  return {
    cyclomaticComplexity: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.cyclomaticComplexity,
    },

    changedCommitCount: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.changedCommitCount,
    },

    affectedFileCount: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.affectedFileCount,
    },

    fanIn: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanIn,
    },

    fanOut: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanOut,
    },

    hotspotSignalCount: {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS.hotspotSignalCount,
    },

    ...overrides,
  };
}

describe('validateDeepAnalysisThresholds', () => {
  it('accepts the default thresholds', () => {
    expect(() => validateDeepAnalysisThresholds(DEFAULT_DEEP_ANALYSIS_THRESHOLDS)).not.toThrow();
  });

  it('accepts equal medium and high thresholds', () => {
    const thresholds = createThresholds({
      fanIn: {
        medium: 5,

        high: 5,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).not.toThrow();
  });

  it('rejects negative medium thresholds', () => {
    const thresholds = createThresholds({
      cyclomaticComplexity: {
        medium: -1,

        high: 20,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis threshold cyclomaticComplexity.medium must be a non-negative integer.',
    );
  });

  it('rejects fractional medium thresholds', () => {
    const thresholds = createThresholds({
      changedCommitCount: {
        medium: 2.5,

        high: 15,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis threshold changedCommitCount.medium must be a non-negative integer.',
    );
  });

  it('rejects negative high thresholds', () => {
    const thresholds = createThresholds({
      affectedFileCount: {
        medium: 5,

        high: -1,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis threshold affectedFileCount.high must be a non-negative integer.',
    );
  });

  it('rejects fractional high thresholds', () => {
    const thresholds = createThresholds({
      fanOut: {
        medium: 8,

        high: 10.5,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis threshold fanOut.high must be a non-negative integer.',
    );
  });

  it('rejects high thresholds below medium thresholds', () => {
    const thresholds = createThresholds({
      fanIn: {
        medium: 10,

        high: 5,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis threshold fanIn.high must be greater than or equal to fanIn.medium.',
    );
  });

  it('rejects hotspot medium thresholds above the available signal count', () => {
    const thresholds = createThresholds({
      hotspotSignalCount: {
        medium: 6,

        high: 6,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis hotspot signal thresholds cannot exceed 5.',
    );
  });

  it('rejects hotspot high thresholds above the available signal count', () => {
    const thresholds = createThresholds({
      hotspotSignalCount: {
        medium: 2,

        high: 6,
      },
    });

    expect(() => validateDeepAnalysisThresholds(thresholds)).toThrow(
      'Deep-analysis hotspot signal thresholds cannot exceed 5.',
    );
  });
});
