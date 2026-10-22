import { describe, expect, it } from 'vitest';

import { calculateFileChurnMetrics } from './churn-metrics.js';

describe('calculateFileChurnMetrics', () => {
  it('returns churn counts for files', () => {
    expect(
      calculateFileChurnMetrics([
        {
          filePath: 'src/app.ts',

          changedCommitCount: 12,
        },

        {
          filePath: 'src/service.ts',

          changedCommitCount: 5,
        },
      ]),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 12,
      },

      {
        filePath: 'src/service.ts',

        changedCommitCount: 5,
      },
    ]);
  });

  it('allows zero churn', () => {
    expect(
      calculateFileChurnMetrics([
        {
          filePath: 'src/new-file.ts',

          changedCommitCount: 0,
        },
      ]),
    ).toEqual([
      {
        filePath: 'src/new-file.ts',

        changedCommitCount: 0,
      },
    ]);
  });

  it('returns files in deterministic path order', () => {
    expect(
      calculateFileChurnMetrics([
        {
          filePath: 'src/z.ts',

          changedCommitCount: 3,
        },

        {
          filePath: 'src/a.ts',

          changedCommitCount: 7,
        },

        {
          filePath: 'src/m.ts',

          changedCommitCount: 1,
        },
      ]).map((metric) => metric.filePath),
    ).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('returns an empty array for empty input', () => {
    expect(calculateFileChurnMetrics([])).toEqual([]);
  });

  it('rejects duplicate file paths', () => {
    expect(() =>
      calculateFileChurnMetrics([
        {
          filePath: 'src/app.ts',

          changedCommitCount: 2,
        },

        {
          filePath: 'src/app.ts',

          changedCommitCount: 3,
        },
      ]),
    ).toThrow('Duplicate Git churn input for file: src/app.ts');
  });

  it('rejects negative churn counts', () => {
    expect(() =>
      calculateFileChurnMetrics([
        {
          filePath: 'src/app.ts',

          changedCommitCount: -1,
        },
      ]),
    ).toThrow('Git churn count must be a non-negative integer for file: src/app.ts');
  });

  it('rejects fractional churn counts', () => {
    expect(() =>
      calculateFileChurnMetrics([
        {
          filePath: 'src/app.ts',

          changedCommitCount: 2.5,
        },
      ]),
    ).toThrow('Git churn count must be a non-negative integer for file: src/app.ts');
  });

  it('rejects NaN churn counts', () => {
    expect(() =>
      calculateFileChurnMetrics([
        {
          filePath: 'src/app.ts',

          changedCommitCount: Number.NaN,
        },
      ]),
    ).toThrow('Git churn count must be a non-negative integer for file: src/app.ts');
  });
});
