import { describe, expect, it } from 'vitest';

import { calculateChangeRiskScore } from './change-risk-score.js';

import type { AnalysisFinding, FileHotspotSignals } from '../deep-analysis/types.js';

function createChurnFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:${filePath}:churn:${severity}`,
    kind: 'high-churn',
    severity,
    title: `High churn in ${filePath}`,
    description: 'Test churn finding',
    filePaths: [filePath],
    evidence: [],
  };
}

function createHotspotFinding(
  filePath: string,
  severity: AnalysisFinding['severity'],
): AnalysisFinding {
  return {
    id: `finding:${filePath}:hotspot:${severity}`,
    kind: 'hotspot',
    severity,
    title: `Hotspot in ${filePath}`,
    description: 'Test hotspot finding',
    filePaths: [filePath],
    evidence: [],
  };
}

function createOtherFinding(filePath: string): AnalysisFinding {
  return {
    id: `finding:${filePath}:complexity`,
    kind: 'high-complexity',
    severity: 'high',
    title: `Complexity in ${filePath}`,
    description: 'Unrelated finding',
    filePaths: [filePath],
    evidence: [],
  };
}

function createHotspot(filePath: string, highChurn: boolean): FileHotspotSignals {
  return {
    filePath,
    highComplexity: true,
    highChurn,
    largeBlastRadius: false,
    highFanIn: true,
    inDependencyCycle: false,
    signalCount: highChurn ? 3 : 2,
  };
}

describe('calculateChangeRiskScore', () => {
  it('returns the full score when there is no change risk', () => {
    expect(
      calculateChangeRiskScore({
        findings: [],
        hotspots: [],
        analyzedFileCount: 10,
        maxScore: 20,
      }),
    ).toEqual({
      dimension: 'change-risk',
      maxScore: 20,
      score: 20,
      deductedPoints: 0,
      deductions: [],
    });
  });

  it('ignores unrelated finding families', () => {
    const result = calculateChangeRiskScore({
      findings: [createOtherFinding('src/core.ts')],
      hotspots: [],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    expect(result.score).toBe(20);
    expect(result.deductedPoints).toBe(0);
    expect(result.deductions).toEqual([]);
  });

  it('deducts points for a high-churn file', () => {
    const result = calculateChangeRiskScore({
      findings: [createChurnFinding('src/auth.ts', 'high')],
      hotspots: [],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    /*
     * high = 1.0
     *
     * pressure = 1 / 10 = 0.1
     *
     * round(0.1 * 20) = 2
     */
    expect(result).toMatchObject({
      dimension: 'change-risk',
      maxScore: 20,
      score: 18,
      deductedPoints: 2,
    });
  });

  it('uses medium churn severity weighting', () => {
    const result = calculateChangeRiskScore({
      findings: [createChurnFinding('src/auth.ts', 'medium')],
      hotspots: [],
      analyzedFileCount: 10,
      maxScore: 20,
    });

    /*
     * 0.6 / 10 * 20 = 1.2
     *
     * round = 1
     */
    expect(result.deductedPoints).toBe(1);
    expect(result.score).toBe(19);
  });

  it('upgrades a churn file when it is also a higher-severity hotspot', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/core.ts', 'medium'),
        createHotspotFinding('src/core.ts', 'high'),
      ],

      hotspots: [createHotspot('src/core.ts', true)],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    /*
     * Same file:
     *
     * churn   = 0.6
     * hotspot = 1.0
     *
     * highest wins = 1.0
     *
     * pressure = 0.1
     * deduction = 2
     */
    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('ignores hotspots that do not contain a churn signal', () => {
    const result = calculateChangeRiskScore({
      findings: [createHotspotFinding('src/core.ts', 'high')],

      hotspots: [createHotspot('src/core.ts', false)],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.score).toBe(20);
    expect(result.deductedPoints).toBe(0);
  });

  it('combines change risk across different files', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/auth.ts', 'high'),
        createChurnFinding('src/service.ts', 'medium'),
      ],

      hotspots: [],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    /*
     * weighted total = 1.0 + 0.6 = 1.6
     *
     * pressure = 1.6 / 10 = 0.16
     *
     * round(0.16 * 20) = 3
     */
    expect(result.deductedPoints).toBe(3);
    expect(result.score).toBe(17);
  });

  it('does not double count duplicate churn findings for the same file', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/core.ts', 'medium'),
        createChurnFinding('src/core.ts', 'high'),
      ],

      hotspots: [],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(2);
    expect(result.score).toBe(18);
  });

  it('does not invent churn risk when Git history is unavailable', () => {
    /*
     * B8 represents unavailable history as churn = null.
     *
     * Therefore B9 produces:
     *
     * - no high-churn finding
     * - highChurn = false in hotspot signals
     */
    const result = calculateChangeRiskScore({
      findings: [createHotspotFinding('src/uploaded.ts', 'high')],

      hotspots: [createHotspot('src/uploaded.ts', false)],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result).toEqual({
      dimension: 'change-risk',
      maxScore: 20,
      score: 20,
      deductedPoints: 0,
      deductions: [],
    });
  });

  it('normalizes deductions by repository size', () => {
    const finding = createChurnFinding('src/core.ts', 'high');

    const smallRepository = calculateChangeRiskScore({
      findings: [finding],
      hotspots: [],
      analyzedFileCount: 5,
      maxScore: 20,
    });

    const largeRepository = calculateChangeRiskScore({
      findings: [finding],
      hotspots: [],
      analyzedFileCount: 100,
      maxScore: 20,
    });

    expect(smallRepository.deductedPoints).toBe(4);

    expect(largeRepository.deductedPoints).toBe(0);
  });

  it('returns deterministic sorted file paths in its deduction', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/z.ts', 'high'),
        createChurnFinding('src/a.ts', 'medium'),
        createChurnFinding('src/m.ts', 'high'),
      ],

      hotspots: [],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductions[0]?.filePaths).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('creates an explainable deduction including churn-hotspot overlap', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/auth.ts', 'medium'),
        createHotspotFinding('src/auth.ts', 'high'),
        createChurnFinding('src/service.ts', 'medium'),
      ],

      hotspots: [createHotspot('src/auth.ts', true)],

      analyzedFileCount: 10,

      maxScore: 20,
    });

    expect(result.deductions).toHaveLength(1);

    expect(result.deductions[0]).toMatchObject({
      reason: 'change-risk',

      filePaths: ['src/auth.ts', 'src/service.ts'],
    });

    expect(result.deductions[0]?.description).toContain('2 frequently changed files');

    expect(result.deductions[0]?.description).toContain(
      'including 1 file where churn overlaps with other hotspot signals',
    );
  });

  it('never deducts more than the dimension maximum', () => {
    const result = calculateChangeRiskScore({
      findings: [
        createChurnFinding('src/a.ts', 'high'),
        createChurnFinding('src/b.ts', 'high'),
        createChurnFinding('src/c.ts', 'high'),
      ],

      hotspots: [],

      analyzedFileCount: 2,

      maxScore: 20,
    });

    expect(result.deductedPoints).toBe(20);
    expect(result.score).toBe(0);
  });

  it('keeps the full score for an empty repository', () => {
    expect(
      calculateChangeRiskScore({
        findings: [],
        hotspots: [],
        analyzedFileCount: 0,
        maxScore: 20,
      }),
    ).toEqual({
      dimension: 'change-risk',
      maxScore: 20,
      score: 20,
      deductedPoints: 0,
      deductions: [],
    });
  });
});
