import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SEVERITY_WEIGHTS,
  calculateAffectedFileRatio,
  calculateSeverityWeightedFilePressure,
  getSeverityWeight,
  scalePressureToPoints,
} from './normalization.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

function createFinding(
  filePaths: string[],
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:${filePaths.join('-')}-${severity}`,

    kind: 'hotspot',

    severity,

    title: 'Test finding',

    description: 'Test finding',

    filePaths,

    evidence: [],
  };
}

describe('health score normalization', () => {
  describe('getSeverityWeight', () => {
    it('returns the default low severity weight', () => {
      expect(getSeverityWeight('low')).toBe(0.25);
    });

    it('returns the default medium severity weight', () => {
      expect(getSeverityWeight('medium')).toBe(0.6);
    });

    it('returns the default high severity weight', () => {
      expect(getSeverityWeight('high')).toBe(1);
    });

    it('supports custom severity weights', () => {
      expect(
        getSeverityWeight('medium', {
          low: 0.1,
          medium: 0.5,
          high: 0.9,
        }),
      ).toBe(0.5);
    });

    it('exposes the expected default weights', () => {
      expect(DEFAULT_SEVERITY_WEIGHTS).toEqual({
        low: 0.25,
        medium: 0.6,
        high: 1,
      });
    });
  });

  describe('calculateAffectedFileRatio', () => {
    it('calculates the ratio of affected files', () => {
      expect(calculateAffectedFileRatio(3, 10)).toBe(0.3);
    });

    it('returns zero for an empty repository', () => {
      expect(calculateAffectedFileRatio(0, 0)).toBe(0);
    });

    it('clamps ratios above one', () => {
      expect(calculateAffectedFileRatio(15, 10)).toBe(1);
    });

    it('rejects negative affected file counts', () => {
      expect(() => calculateAffectedFileRatio(-1, 10)).toThrow(
        'affectedFileCount must be a non-negative integer',
      );
    });

    it('rejects fractional affected file counts', () => {
      expect(() => calculateAffectedFileRatio(1.5, 10)).toThrow(
        'affectedFileCount must be a non-negative integer',
      );
    });

    it('rejects negative analyzed file counts', () => {
      expect(() => calculateAffectedFileRatio(1, -10)).toThrow(
        'analyzedFileCount must be a non-negative integer',
      );
    });

    it('rejects fractional analyzed file counts', () => {
      expect(() => calculateAffectedFileRatio(1, 10.5)).toThrow(
        'analyzedFileCount must be a non-negative integer',
      );
    });
  });

  describe('calculateSeverityWeightedFilePressure', () => {
    it('returns zero when there are no findings', () => {
      expect(calculateSeverityWeightedFilePressure([], 10)).toBe(0);
    });

    it('returns zero when the repository has no analyzed files', () => {
      expect(calculateSeverityWeightedFilePressure([createFinding(['src/a.ts'], 'high')], 0)).toBe(
        0,
      );
    });

    it('normalizes one high finding by repository size', () => {
      expect(calculateSeverityWeightedFilePressure([createFinding(['src/a.ts'], 'high')], 10)).toBe(
        0.1,
      );
    });

    it('normalizes one medium finding by repository size', () => {
      expect(
        calculateSeverityWeightedFilePressure([createFinding(['src/a.ts'], 'medium')], 10),
      ).toBeCloseTo(0.06);
    });

    it('normalizes one low finding by repository size', () => {
      expect(
        calculateSeverityWeightedFilePressure([createFinding(['src/a.ts'], 'low')], 10),
      ).toBeCloseTo(0.025);
    });

    it('uses the highest severity only when the same file appears multiple times', () => {
      const findings = [
        createFinding(['src/core.ts'], 'low'),
        createFinding(['src/core.ts'], 'medium'),
        createFinding(['src/core.ts'], 'high'),
      ];

      expect(calculateSeverityWeightedFilePressure(findings, 10)).toBe(0.1);
    });

    it('does not double count the same file across overlapping findings', () => {
      const findings = [
        createFinding(['src/a.ts', 'src/b.ts'], 'medium'),
        createFinding(['src/b.ts', 'src/c.ts'], 'high'),
      ];

      /*
       * a.ts = 0.6
       * b.ts = max(0.6, 1.0) = 1.0
       * c.ts = 1.0
       *
       * total = 2.6
       *
       * pressure = 2.6 / 10
       */
      expect(calculateSeverityWeightedFilePressure(findings, 10)).toBeCloseTo(0.26);
    });

    it('handles findings with no file paths without increasing pressure', () => {
      const finding: AnalysisFinding = {
        ...createFinding([], 'high'),
        filePaths: [],
      };

      expect(calculateSeverityWeightedFilePressure([finding], 10)).toBe(0);
    });

    it('supports custom severity weights', () => {
      const findings = [createFinding(['src/a.ts'], 'medium')];

      expect(
        calculateSeverityWeightedFilePressure(findings, 10, {
          low: 0.1,
          medium: 0.5,
          high: 0.8,
        }),
      ).toBeCloseTo(0.05);
    });

    it('clamps pressure to one when weighted files exceed analyzed file count', () => {
      const findings = [
        createFinding(['src/a.ts'], 'high'),
        createFinding(['src/b.ts'], 'high'),
        createFinding(['src/c.ts'], 'high'),
      ];

      expect(calculateSeverityWeightedFilePressure(findings, 2)).toBe(1);
    });

    it('rejects negative analyzed file counts', () => {
      expect(() => calculateSeverityWeightedFilePressure([], -1)).toThrow(
        'analyzedFileCount must be a non-negative integer',
      );
    });

    it('rejects fractional analyzed file counts', () => {
      expect(() => calculateSeverityWeightedFilePressure([], 1.5)).toThrow(
        'analyzedFileCount must be a non-negative integer',
      );
    });
  });

  describe('scalePressureToPoints', () => {
    it('scales normalized pressure into deduction points', () => {
      expect(scalePressureToPoints(0.4, 25)).toBe(10);
    });

    it('rounds deduction points to the nearest integer', () => {
      expect(scalePressureToPoints(0.26, 20)).toBe(5);
    });

    it('returns zero when pressure is zero', () => {
      expect(scalePressureToPoints(0, 20)).toBe(0);
    });

    it('returns the maximum points when pressure is one', () => {
      expect(scalePressureToPoints(1, 20)).toBe(20);
    });

    it('clamps pressure above one', () => {
      expect(scalePressureToPoints(2, 20)).toBe(20);
    });

    it('clamps negative pressure to zero', () => {
      expect(scalePressureToPoints(-0.5, 20)).toBe(0);
    });

    it('rejects non-finite pressure', () => {
      expect(() => scalePressureToPoints(Number.POSITIVE_INFINITY, 20)).toThrow(
        'pressure must be finite',
      );
    });

    it('rejects negative maxPoints', () => {
      expect(() => scalePressureToPoints(0.5, -1)).toThrow(
        'maxPoints must be a non-negative integer',
      );
    });

    it('rejects fractional maxPoints', () => {
      expect(() => scalePressureToPoints(0.5, 10.5)).toThrow(
        'maxPoints must be a non-negative integer',
      );
    });
  });
});
