import { describe, expect, it } from 'vitest';

import { calculateDependencyHealthScore } from './dependency-health-score.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

function createCycleFinding(
  filePaths: string[],
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:cycle:${filePaths.join('-')}:${severity}`,
    kind: 'dependency-cycle',
    severity,
    title: 'Dependency cycle',
    description: 'Test dependency cycle',
    filePaths,
    evidence: [],
  };
}

function createBlastRadiusFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:blast:${filePath}:${severity}`,
    kind: 'large-blast-radius',
    severity,
    title: 'Large blast radius',
    description: 'Test blast radius',
    filePaths: [filePath],
    evidence: [],
  };
}

function createOtherFinding(filePath: string): AnalysisFinding {
  return {
    id: `finding:other:${filePath}`,
    kind: 'high-churn',
    severity: 'high',
    title: 'Other finding',
    description: 'Unrelated finding',
    filePaths: [filePath],
    evidence: [],
  };
}

describe('calculateDependencyHealthScore', () => {
  it('returns the full score when there are no dependency findings', () => {
    expect(
      calculateDependencyHealthScore({
        findings: [],
        analyzedFileCount: 10,
        maxScore: 25,
      }),
    ).toEqual({
      dimension: 'dependency-health',
      maxScore: 25,
      score: 25,
      deductedPoints: 0,
      deductions: [],
    });
  });

  it('ignores unrelated finding families', () => {
    const result = calculateDependencyHealthScore({
      findings: [createOtherFinding('src/service.ts')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    expect(result.score).toBe(25);
    expect(result.deductedPoints).toBe(0);
    expect(result.deductions).toEqual([]);
  });

  it('deducts points for a high blast-radius file', () => {
    const result = calculateDependencyHealthScore({
      findings: [createBlastRadiusFinding('src/core.ts', 'high')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    expect(result.deductedPoints).toBe(3);
    expect(result.score).toBe(22);
  });

  it('deducts points for a medium two-file dependency cycle', () => {
    const result = calculateDependencyHealthScore({
      findings: [createCycleFinding(['src/a.ts', 'src/b.ts'], 'medium')],
      analyzedFileCount: 10,
      maxScore: 25,
    });

    /*
     * a.ts = 0.6
     * b.ts = 0.6
     *
     * total = 1.2
     *
     * pressure = 1.2 / 10 = 0.12
     *
     * round(0.12 * 25) = 3
     */
    expect(result.deductedPoints).toBe(3);
    expect(result.score).toBe(22);
  });

  it('deducts more for a high-severity multi-file cycle', () => {
    const result = calculateDependencyHealthScore({
      findings: [createCycleFinding(['src/a.ts', 'src/b.ts', 'src/c.ts'], 'high')],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    /*
     * 3 high-risk files
     *
     * pressure = 3 / 10 = 0.3
     *
     * round(0.3 * 25) = 8
     */
    expect(result.deductedPoints).toBe(8);
    expect(result.score).toBe(17);
  });

  it('combines cycle and blast-radius risk across different files', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/a.ts', 'src/b.ts'], 'medium'),
        createBlastRadiusFinding('src/core.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    /*
     * a.ts    = 0.6
     * b.ts    = 0.6
     * core.ts = 1.0
     *
     * total = 2.2
     *
     * pressure = 0.22
     *
     * round(0.22 * 25) = 6
     */
    expect(result.deductedPoints).toBe(6);
    expect(result.score).toBe(19);
  });

  it('does not double count a file appearing in both cycle and blast-radius findings', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/core.ts', 'src/service.ts'], 'medium'),
        createBlastRadiusFinding('src/core.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    /*
     * core.ts:
     * max(0.6, 1.0) = 1.0
     *
     * service.ts:
     * 0.6
     *
     * total = 1.6
     *
     * pressure = 0.16
     *
     * round(0.16 * 25) = 4
     */
    expect(result.deductedPoints).toBe(4);
    expect(result.score).toBe(21);
  });

  it('uses the highest severity when the same cycle files appear in multiple findings', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/a.ts', 'src/b.ts'], 'medium'),
        createCycleFinding(['src/a.ts', 'src/b.ts'], 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductedPoints).toBe(5);
    expect(result.score).toBe(20);
  });

  it('normalizes deductions by repository size', () => {
    const finding = createBlastRadiusFinding('src/core.ts', 'high');

    const smallRepository = calculateDependencyHealthScore({
      findings: [finding],
      analyzedFileCount: 5,
      maxScore: 25,
    });

    const largeRepository = calculateDependencyHealthScore({
      findings: [finding],
      analyzedFileCount: 100,
      maxScore: 25,
    });

    expect(smallRepository.deductedPoints).toBe(5);

    expect(largeRepository.deductedPoints).toBe(0);
  });

  it('returns deterministic sorted file paths in the deduction', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/z.ts', 'src/a.ts'], 'medium'),
        createBlastRadiusFinding('src/m.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductions[0]?.filePaths).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('creates an explainable deduction', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/a.ts', 'src/b.ts'], 'medium'),
        createBlastRadiusFinding('src/core.ts', 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductions).toHaveLength(1);

    expect(result.deductions[0]).toMatchObject({
      reason: 'dependency-health',
      filePaths: ['src/a.ts', 'src/b.ts', 'src/core.ts'],
    });

    expect(result.deductions[0]?.description).toContain('1 dependency cycle');

    expect(result.deductions[0]?.description).toContain('1 large blast-radius finding');

    expect(result.deductions[0]?.description).toContain('affected 3 files');
  });

  it('handles plural wording in the explanation', () => {
    const result = calculateDependencyHealthScore({
      findings: [
        createCycleFinding(['src/a.ts', 'src/b.ts'], 'medium'),
        createCycleFinding(['src/c.ts', 'src/d.ts'], 'medium'),
        createBlastRadiusFinding('src/e.ts', 'medium'),
        createBlastRadiusFinding('src/f.ts', 'medium'),
      ],

      analyzedFileCount: 10,

      maxScore: 25,
    });

    expect(result.deductions[0]?.description).toContain('2 dependency cycles');

    expect(result.deductions[0]?.description).toContain('2 large blast-radius findings');
  });

  it('never deducts more than the dimension maximum', () => {
    const result = calculateDependencyHealthScore({
      findings: [createCycleFinding(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'], 'high')],

      analyzedFileCount: 2,

      maxScore: 25,
    });

    expect(result.deductedPoints).toBe(25);
    expect(result.score).toBe(0);
  });

  it('keeps the full score for an empty repository', () => {
    expect(
      calculateDependencyHealthScore({
        findings: [],
        analyzedFileCount: 0,
        maxScore: 25,
      }),
    ).toEqual({
      dimension: 'dependency-health',
      maxScore: 25,
      score: 25,
      deductedPoints: 0,
      deductions: [],
    });
  });
});
