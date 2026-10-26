import { describe, expect, it } from 'vitest';

import { calculateFileArchitectureRiskScores } from './architecture-risk-score.js';

import type { AnalysisFinding } from './types.js';

function createFinding(
  id: string,

  filePath: string,

  severity: AnalysisFinding['severity'],

  kind: AnalysisFinding['kind'] = 'high-complexity',
): AnalysisFinding {
  return {
    id,

    kind,

    severity,

    title: id,

    description: id,

    filePaths: [filePath],

    evidence: [],
  };
}

describe('calculateFileArchitectureRiskScores', () => {
  it('returns zero risk for files with no findings', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 0,
      },
    ]);
  });

  it('maps one low-severity finding to 25 risk', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [createFinding('finding:low', 'src/app.ts', 'low')],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 25,
      },
    ]);
  });

  it('maps one medium-severity finding to 60 risk', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [createFinding('finding:medium', 'src/app.ts', 'medium')],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 60,
      },
    ]);
  });

  it('combines two medium findings into 84 risk', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [
          createFinding('finding:medium-1', 'src/app.ts', 'medium'),

          createFinding('finding:medium-2', 'src/app.ts', 'medium', 'high-fan-out'),
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 84,
      },
    ]);
  });

  it('caps naturally at 100 when a high-severity finding exists', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [
          createFinding('finding:high', 'src/app.ts', 'high'),

          createFinding('finding:medium', 'src/app.ts', 'medium', 'hotspot'),
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 100,
      },
    ]);
  });

  it('maps findings independently to their related files', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/a.ts', 'src/b.ts'],

        [
          createFinding('finding:a', 'src/a.ts', 'low'),

          createFinding('finding:b', 'src/b.ts', 'medium'),
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/a.ts',

        riskScore: 25,
      },

      {
        filePath: 'src/b.ts',

        riskScore: 60,
      },
    ]);
  });

  it('ignores findings for files outside the requested file set', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/app.ts'],

        [createFinding('finding:other', 'src/other.ts', 'high')],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        riskScore: 0,
      },
    ]);
  });

  it('sorts results deterministically by file path', () => {
    expect(
      calculateFileArchitectureRiskScores(
        ['src/zeta.ts', 'src/alpha.ts'],

        [],
      ),
    ).toEqual([
      {
        filePath: 'src/alpha.ts',

        riskScore: 0,
      },

      {
        filePath: 'src/zeta.ts',

        riskScore: 0,
      },
    ]);
  });
});
