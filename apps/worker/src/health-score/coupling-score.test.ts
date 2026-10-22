import { describe, expect, it } from 'vitest';

import { calculateCouplingScore } from './coupling-score.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

function createFanInFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:fan-in:${filePath}:${severity}`,
    kind: 'high-fan-in',
    severity,
    title: 'High fan-in',
    description: 'Test fan-in finding',
    filePaths: [filePath],
    evidence: [],
  };
}

function createFanOutFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:fan-out:${filePath}:${severity}`,
    kind: 'high-fan-out',
    severity,
    title: 'High fan-out',
    description: 'Test fan-out finding',
    filePaths: [filePath],
    evidence: [],
  };
}

function createOtherFinding(filePath: string): AnalysisFinding {
  return {
    id: `finding:other:${filePath}`,
    kind: 'high-complexity',
    severity: 'high',
    title: 'Other finding',
    description: 'Unrelated finding',
    filePaths: [filePath],
    evidence: [],
  };
}

describe('calculateCouplingScore', () => {
  it('returns the full score when there are no coupling findings', () => {
    expect(
      calculateCouplingScore({
        findings: [],
        analyzedFileCount: 10,
        maxScore: 20,
      }),
    ).toEqual({
      dimension: 'coupling',
      maxScore: 20,
      score: 20,
      deductedPoints: 0,
      deductions: [],
    });
  });

  it('ignores unrelated finding families', () => {
    const result = calculateCouplingScore({
      findings: [createOtherFinding('src/core.ts')],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    expect(result.score).toBe(20);
    expect(result.deductedPoints).toBe(0);
    expect(result.deductions).toEqual([]);
  });

  it('deducts points for a high fan-in finding', () => {
    const result = calculateCouplingScore({
      findings: [createFanInFinding('src/core.ts', 'high')],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('deducts points for a high fan-out finding', () => {
    const result = calculateCouplingScore({
      findings: [createFanOutFinding('src/controller.ts', 'high')],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('uses medium severity weighting', () => {
    const result = calculateCouplingScore({
      findings: [createFanInFinding('src/shared.ts', 'medium')],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    /*
     * medium = 0.6
     *
     * pressure = 0.6 / 10
     *
     * deduction = round(0.06 * 20)
     *           = 1
     */
    expect(result.deductedPoints).toBe(1);
    expect(result.score).toBe(19);
  });

  it('combines fan-in and fan-out findings from different files', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/core.ts', 'high'),
        createFanOutFinding('src/controller.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    /*
     * core.ts       = 1.0
     * controller.ts = 0.6
     *
     * total = 1.6
     *
     * pressure = 0.16
     *
     * round(0.16 * 20) = 3
     */
    expect(result.deductedPoints).toBe(3);
    expect(result.score).toBe(17);
  });

  it('does not double count a file with both high fan-in and high fan-out', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/orchestrator.ts', 'medium'),
        createFanOutFinding('src/orchestrator.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    /*
     * Same file:
     *
     * max(0.6, 1.0) = 1.0
     *
     * NOT 1.6
     */
    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('uses the highest severity for duplicate fan-in findings', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/core.ts', 'medium'),
        createFanInFinding('src/core.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('normalizes deductions by repository size', () => {
    const finding = createFanInFinding('src/core.ts', 'high');

    const smallRepository = calculateCouplingScore({
      findings: [finding],
      analyzedFileCount: 5,
      maxScore: 20,
    });

    const largeRepository = calculateCouplingScore({
      findings: [finding],
      analyzedFileCount: 100,
      maxScore: 20,
    });

    expect(smallRepository.deductedPoints).toBe(4);

    expect(largeRepository.deductedPoints).toBe(0);
  });

  it('returns deterministic sorted file paths in the deduction', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/z.ts', 'high'),
        createFanOutFinding('src/a.ts', 'medium'),
        createFanInFinding('src/m.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductions[0]?.filePaths).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('creates an explainable deduction', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/core.ts', 'high'),
        createFanOutFinding('src/controller.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductions).toHaveLength(1);

    expect(result.deductions[0]).toMatchObject({
      reason: 'coupling',
      filePaths: ['src/controller.ts', 'src/core.ts'],
    });

    expect(result.deductions[0]?.description).toContain('1 high fan-in finding');

    expect(result.deductions[0]?.description).toContain('1 high fan-out finding');

    expect(result.deductions[0]?.description).toContain('affected 2 files');
  });

  it('handles plural wording in the explanation', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/a.ts', 'medium'),
        createFanInFinding('src/b.ts', 'medium'),
        createFanOutFinding('src/c.ts', 'medium'),
        createFanOutFinding('src/d.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductions[0]?.description).toContain('2 high fan-in findings');

    expect(result.deductions[0]?.description).toContain('2 high fan-out findings');
  });

  it('never deducts more than the dimension maximum', () => {
    const result = calculateCouplingScore({
      findings: [
        createFanInFinding('src/a.ts', 'high'),
        createFanOutFinding('src/b.ts', 'high'),
        createFanInFinding('src/c.ts', 'high'),
      ],

      analyzedFileCount: 2,

      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(20);
    expect(result.score).toBe(0);
  });

  it('keeps the full score for an empty repository', () => {
    expect(
      calculateCouplingScore({
        findings: [],
        analyzedFileCount: 0,
        maxScore: 20,
      }),
    ).toEqual({
      dimension: 'coupling',
      maxScore: 20,
      score: 20,
      deductedPoints: 0,
      deductions: [],
    });
  });
});
