import { describe, expect, it } from 'vitest';

import { calculateMaintainabilityScore } from './maintainability-score.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

function createComplexityFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:${filePath}:${severity}`,

    kind: 'high-complexity',

    severity,

    title: `High complexity in ${filePath}`,

    description: 'Test complexity finding',

    filePaths: [filePath],

    evidence: [],
  };
}

function createOtherFinding(filePath: string): AnalysisFinding {
  return {
    id: `finding:${filePath}:other`,

    kind: 'high-churn',

    severity: 'high',

    title: `High churn in ${filePath}`,

    description: 'Test unrelated finding',

    filePaths: [filePath],

    evidence: [],
  };
}

describe('calculateMaintainabilityScore', () => {
  it('returns the full score when there are no complexity findings', () => {
    expect(
      calculateMaintainabilityScore({
        findings: [],
        analyzedFileCount: 10,
        maxScore: 25,
      }),
    ).toEqual({
      dimension: 'maintainability',

      maxScore: 25,

      score: 25,

      deductedPoints: 0,

      deductions: [],
    });
  });

  it('ignores findings from other B9 rule families', () => {
    expect(
      calculateMaintainabilityScore({
        findings: [createOtherFinding('src/service.ts')],
        analyzedFileCount: 10,
        maxScore: 25,
      }),
    ).toEqual({
      dimension: 'maintainability',

      maxScore: 25,

      score: 25,

      deductedPoints: 0,

      deductions: [],
    });
  });

  it('deducts points for a high complexity finding', () => {
    const result = calculateMaintainabilityScore({
      findings: [createComplexityFinding('src/auth.ts', 'high')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    /*
     * high = 1.0
     *
     * pressure = 1 / 10 = 0.1
     *
     * round(0.1 * 25) = 3
     */
    expect(result).toMatchObject({
      dimension: 'maintainability',
      maxScore: 25,
      score: 22,
      deductedPoints: 3,
    });
  });

  it('uses medium severity weighting', () => {
    const result = calculateMaintainabilityScore({
      findings: [createComplexityFinding('src/parser.ts', 'medium')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    /*
     * medium = 0.6
     *
     * pressure = 0.6 / 10 = 0.06
     *
     * round(0.06 * 25) = 2
     */
    expect(result.deductedPoints).toBe(2);

    expect(result.score).toBe(23);
  });

  it('uses low severity weighting when supplied', () => {
    const result = calculateMaintainabilityScore({
      findings: [createComplexityFinding('src/small.ts', 'low')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    /*
     * low = 0.25
     *
     * pressure = 0.025
     *
     * round(0.025 * 25) = 1
     */
    expect(result.deductedPoints).toBe(1);

    expect(result.score).toBe(24);
  });

  it('combines findings from different files', () => {
    const result = calculateMaintainabilityScore({
      findings: [
        createComplexityFinding('src/auth.ts', 'high'),
        createComplexityFinding('src/parser.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    /*
     * weighted total:
     *
     * 1.0 + 0.6 = 1.6
     *
     * pressure:
     *
     * 1.6 / 10 = 0.16
     *
     * points:
     *
     * round(0.16 * 25) = 4
     */
    expect(result.deductedPoints).toBe(4);

    expect(result.score).toBe(21);
  });

  it('does not double count the same file', () => {
    const result = calculateMaintainabilityScore({
      findings: [
        createComplexityFinding('src/core.ts', 'medium'),
        createComplexityFinding('src/core.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    /*
     * Same file:
     *
     * max(0.6, 1.0) = 1.0
     *
     * NOT:
     *
     * 0.6 + 1.0
     */
    expect(result.deductedPoints).toBe(3);

    expect(result.score).toBe(22);
  });

  it('normalizes deductions by repository size', () => {
    const finding = createComplexityFinding('src/core.ts', 'high');

    const smallRepository = calculateMaintainabilityScore({
      findings: [finding],
      analyzedFileCount: 5,
      maxScore: 25,
    });

    const largeRepository = calculateMaintainabilityScore({
      findings: [finding],
      analyzedFileCount: 100,
      maxScore: 25,
    });

    expect(smallRepository.deductedPoints).toBe(5);

    /*
     * 1 / 100 * 25 = 0.25
     *
     * Math.round(0.25) = 0
     */
    expect(largeRepository.deductedPoints).toBe(0);
  });

  it('returns deterministic sorted file paths in the deduction', () => {
    const result = calculateMaintainabilityScore({
      findings: [
        createComplexityFinding('src/z.ts', 'high'),
        createComplexityFinding('src/a.ts', 'medium'),
        createComplexityFinding('src/m.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductions[0]?.filePaths).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('creates an explainable deduction', () => {
    const result = calculateMaintainabilityScore({
      findings: [
        createComplexityFinding('src/auth.ts', 'high'),
        createComplexityFinding('src/parser.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductions).toHaveLength(1);

    expect(result.deductions[0]).toMatchObject({
      reason: 'high-complexity',

      points: 4,

      filePaths: ['src/auth.ts', 'src/parser.ts'],
    });

    expect(result.deductions[0]?.description).toContain(
      '2 files exceeded the configured cyclomatic complexity threshold',
    );
  });

  it('uses singular wording for one affected file', () => {
    const result = calculateMaintainabilityScore({
      findings: [createComplexityFinding('src/auth.ts', 'high')],
      analyzedFileCount: 5,
      maxScore: 25,
    });

    expect(result.deductions[0]?.description).toContain(
      '1 file exceeded the configured cyclomatic complexity threshold',
    );
  });

  it('never deducts more than the dimension maximum', () => {
    const findings = [
      createComplexityFinding('src/a.ts', 'high'),
      createComplexityFinding('src/b.ts', 'high'),
      createComplexityFinding('src/c.ts', 'high'),
      createComplexityFinding('src/d.ts', 'high'),
    ];

    const result = calculateMaintainabilityScore({
      findings,
      analyzedFileCount: 2,
      maxScore: 25,
    });

    expect(result.deductedPoints).toBe(25);

    expect(result.score).toBe(0);
  });

  it('keeps the full score for an empty repository', () => {
    const result = calculateMaintainabilityScore({
      findings: [],
      analyzedFileCount: 0,
      maxScore: 25,
    });

    expect(result).toEqual({
      dimension: 'maintainability',
      maxScore: 25,
      score: 25,
      deductedPoints: 0,
      deductions: [],
    });
  });
});
