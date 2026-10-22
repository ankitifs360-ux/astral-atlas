import { describe, expect, it } from 'vitest';

import { calculateResolutionQualityScore } from './resolution-quality-score.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

function createUnresolvedFinding(
  filePath: string,
  unresolvedImportCount: number,
  severity: AnalysisFinding['severity'] = 'low',
): AnalysisFinding {
  return {
    id: `finding:unresolved:${filePath}:${unresolvedImportCount}:${severity}`,

    kind: 'unresolved-imports',

    severity,

    title: `Unresolved imports in ${filePath}`,

    description: 'Test unresolved import finding',

    filePaths: [filePath],

    evidence: [
      {
        metric: 'unresolvedImportCount',
        value: unresolvedImportCount,
      },
    ],
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

describe('calculateResolutionQualityScore', () => {
  it('returns the full score when there are no unresolved imports', () => {
    expect(
      calculateResolutionQualityScore({
        findings: [],
        analyzedFileCount: 10,
        maxScore: 10,
      }),
    ).toEqual({
      dimension: 'resolution-quality',
      maxScore: 10,
      score: 10,
      deductedPoints: 0,
      deductions: [],
    });
  });

  it('ignores unrelated finding families', () => {
    const result = calculateResolutionQualityScore({
      findings: [createOtherFinding('src/core.ts')],
      analyzedFileCount: 10,
      maxScore: 10,
    });

    expect(result.score).toBe(10);
    expect(result.deductedPoints).toBe(0);
    expect(result.deductions).toEqual([]);
  });

  it('deducts conservatively for one low-severity unresolved-import finding', () => {
    const result = calculateResolutionQualityScore({
      findings: [createUnresolvedFinding('src/service.ts', 1)],

      analyzedFileCount: 10,

      maxScore: 10,
    });

    /*
     * low = 0.25
     *
     * pressure = 0.25 / 10
     *          = 0.025
     *
     * deduction = round(0.025 * 10)
     *           = 0
     *
     * This is intentionally conservative.
     */
    expect(result.deductedPoints).toBe(0);
    expect(result.score).toBe(10);
  });

  it('deducts points when unresolved imports affect enough files', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/a.ts', 2),
        createUnresolvedFinding('src/b.ts', 1),
        createUnresolvedFinding('src/c.ts', 3),
        createUnresolvedFinding('src/d.ts', 1),
      ],

      analyzedFileCount: 10,

      maxScore: 10,
    });

    /*
     * Each low finding contributes 0.25.
     *
     * weighted total = 1.0
     *
     * pressure = 1 / 10
     *          = 0.1
     *
     * deduction = round(0.1 * 10)
     *           = 1
     */
    expect(result.deductedPoints).toBe(1);
    expect(result.score).toBe(9);
  });

  it('sums unresolved import counts from finding evidence', () => {
    const result = calculateResolutionQualityScore({
      findings: [createUnresolvedFinding('src/a.ts', 2), createUnresolvedFinding('src/b.ts', 3)],

      analyzedFileCount: 4,

      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('5 unresolved imports');
  });

  it('uses singular wording for one unresolved import', () => {
    const result = calculateResolutionQualityScore({
      findings: [createUnresolvedFinding('src/service.ts', 1, 'high')],

      analyzedFileCount: 1,

      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('1 unresolved import');
  });

  it('uses singular wording for one affected file', () => {
    const result = calculateResolutionQualityScore({
      findings: [createUnresolvedFinding('src/service.ts', 3, 'high')],

      analyzedFileCount: 1,

      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('across 1 file');
  });

  it('uses plural wording for multiple affected files', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/a.ts', 2, 'high'),
        createUnresolvedFinding('src/b.ts', 1, 'high'),
      ],

      analyzedFileCount: 2,

      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('across 2 files');
  });

  it('does not double count the same file across duplicate unresolved findings', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/service.ts', 2, 'medium'),

        createUnresolvedFinding('src/service.ts', 3, 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 10,
    });

    /*
     * Same file:
     *
     * max(0.6, 1.0) = 1.0
     *
     * pressure = 1 / 10
     *
     * deduction = 1
     */
    expect(result.deductedPoints).toBe(1);
    expect(result.score).toBe(9);
  });

  it('still reports the summed unresolved import count from duplicate findings', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/service.ts', 2, 'high'),

        createUnresolvedFinding('src/service.ts', 3, 'high'),
      ],

      analyzedFileCount: 1,

      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('5 unresolved imports');
  });

  it('ignores malformed unresolved-count evidence when calculating the descriptive total', () => {
    const malformedFinding: AnalysisFinding = {
      ...createUnresolvedFinding('src/service.ts', 1, 'high'),

      evidence: [
        {
          metric: 'unresolvedImportCount',
          value: 'unknown',
        },
      ],
    };

    const result = calculateResolutionQualityScore({
      findings: [malformedFinding],
      analyzedFileCount: 1,
      maxScore: 10,
    });

    expect(result.deductions[0]?.description).toContain('0 unresolved imports');
  });

  it('returns deterministic sorted file paths in the deduction', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/z.ts', 1, 'high'),

        createUnresolvedFinding('src/a.ts', 1, 'high'),

        createUnresolvedFinding('src/m.ts', 1, 'high'),
      ],

      analyzedFileCount: 10,

      maxScore: 10,
    });

    expect(result.deductions[0]?.filePaths).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('normalizes deductions by repository size', () => {
    const finding = createUnresolvedFinding('src/service.ts', 1, 'high');

    const smallRepository = calculateResolutionQualityScore({
      findings: [finding],
      analyzedFileCount: 2,
      maxScore: 10,
    });

    const largeRepository = calculateResolutionQualityScore({
      findings: [finding],
      analyzedFileCount: 100,
      maxScore: 10,
    });

    expect(smallRepository.deductedPoints).toBe(5);

    expect(largeRepository.deductedPoints).toBe(0);
  });

  it('creates an explainable deduction', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/a.ts', 2, 'high'),

        createUnresolvedFinding('src/b.ts', 1, 'high'),
      ],

      analyzedFileCount: 4,

      maxScore: 10,
    });

    expect(result.deductions).toHaveLength(1);

    expect(result.deductions[0]).toMatchObject({
      reason: 'unresolved-imports',
      filePaths: ['src/a.ts', 'src/b.ts'],
    });

    expect(result.deductions[0]?.description).toContain('3 unresolved imports');

    expect(result.deductions[0]?.description).toContain(
      'reduce confidence in the dependency graph',
    );
  });

  it('never deducts more than the dimension maximum', () => {
    const result = calculateResolutionQualityScore({
      findings: [
        createUnresolvedFinding('src/a.ts', 5, 'high'),

        createUnresolvedFinding('src/b.ts', 5, 'high'),

        createUnresolvedFinding('src/c.ts', 5, 'high'),
      ],

      analyzedFileCount: 2,

      maxScore: 10,
    });

    expect(result.deductedPoints).toBe(10);
    expect(result.score).toBe(0);
  });

  it('keeps the full score for an empty repository', () => {
    expect(
      calculateResolutionQualityScore({
        findings: [],
        analyzedFileCount: 0,
        maxScore: 10,
      }),
    ).toEqual({
      dimension: 'resolution-quality',
      maxScore: 10,
      score: 10,
      deductedPoints: 0,
      deductions: [],
    });
  });
});
