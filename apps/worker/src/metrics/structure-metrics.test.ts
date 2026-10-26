import { describe, expect, it } from 'vitest';

import { calculateFileStructureMetrics } from './structure-metrics.js';

import type { ParseSourceResult, SourceRange } from '../parsing/types.js';

function createRange(row: number): SourceRange {
  return {
    start: {
      row,
      column: 0,
    },

    end: {
      row,
      column: 10,
    },
  };
}

function createParsedFile(
  overrides: Partial<ParseSourceResult> & Pick<ParseSourceResult, 'filePath'>,
): ParseSourceResult {
  return {
    filePath: overrides.filePath,

    language: overrides.language ?? 'typescript',

    imports: overrides.imports ?? [],

    functions: overrides.functions ?? [],

    classes: overrides.classes ?? [],

    calls: overrides.calls ?? [],

    hasSyntaxErrors: overrides.hasSyntaxErrors ?? false,
  };
}

describe('calculateFileStructureMetrics', () => {
  it('combines parsed counts with cyclomatic complexity', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/service.ts',

      imports: [
        {
          source: './db.js',

          range: createRange(0),
        },

        {
          source: 'express',

          range: createRange(1),
        },
      ],

      functions: [
        {
          name: 'run',

          async: false,

          range: createRange(3),

          isExported: false,
        },
      ],

      classes: [
        {
          name: 'Service',

          range: createRange(2),

          isExported: false,
        },
      ],
    });

    const result = calculateFileStructureMetrics([
      {
        parsedFile,

        source: `
import db from './db.js';
import express from 'express';

class Service {}

function run(
  enabled: boolean,
) {
  if (enabled) {
    return true;
  }

  return false;
}
                `,
      },
    ]);

    expect(result).toEqual([
      {
        filePath: 'src/service.ts',

        structure: {
          importCount: 2,

          functionCount: 1,

          classCount: 1,

          cyclomaticComplexity: 2,

          hasSyntaxErrors: false,
        },
      },
    ]);
  });

  it('propagates syntax-error information', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/broken.ts',

      hasSyntaxErrors: true,
    });

    const result = calculateFileStructureMetrics([
      {
        parsedFile,

        source: `
const value = 1;
                `,
      },
    ]);

    expect(result[0]?.structure.hasSyntaxErrors).toBe(true);
  });

  it('keeps import count separate from dependency fan-out concepts', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/app.ts',

      imports: [
        {
          source: './utils.js',

          range: createRange(0),
        },

        {
          source: './utils.js',

          range: createRange(1),
        },

        {
          source: 'express',

          range: createRange(2),
        },
      ],
    });

    const result = calculateFileStructureMetrics([
      {
        parsedFile,

        source: `
import {
  foo,
} from './utils.js';

import {
  bar,
} from './utils.js';

import express from 'express';
                `,
      },
    ]);

    expect(result[0]?.structure.importCount).toBe(3);
  });

  it('calculates complexity for Python files', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/service.py',

      language: 'python',

      functions: [
        {
          name: 'check',

          async: false,

          range: createRange(0),

          isExported: false,
        },
      ],
    });

    const result = calculateFileStructureMetrics([
      {
        parsedFile,

        source: `
def check(value):
    if value > 0:
        return True

    return False
                `,
      },
    ]);

    expect(result[0]?.structure.cyclomaticComplexity).toBe(2);
  });

  it('returns deterministic file ordering', () => {
    const result = calculateFileStructureMetrics([
      {
        parsedFile: createParsedFile({
          filePath: 'src/z.ts',
        }),

        source: 'const z = 1;',
      },

      {
        parsedFile: createParsedFile({
          filePath: 'src/a.ts',
        }),

        source: 'const a = 1;',
      },

      {
        parsedFile: createParsedFile({
          filePath: 'src/m.ts',
        }),

        source: 'const m = 1;',
      },
    ]);

    expect(result.map((item) => item.filePath)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('returns an empty array for an empty repository input', () => {
    expect(calculateFileStructureMetrics([])).toEqual([]);
  });

  it('rejects duplicate file inputs', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/app.ts',
    });

    expect(() =>
      calculateFileStructureMetrics([
        {
          parsedFile,

          source: 'const a = 1;',
        },

        {
          parsedFile,

          source: 'const b = 2;',
        },
      ]),
    ).toThrow('Duplicate structure metrics input for file: src/app.ts');
  });

  it('aggregates multiple functions and decisions into file complexity', () => {
    const parsedFile = createParsedFile({
      filePath: 'src/logic.ts',

      functions: [
        {
          name: 'first',

          async: false,

          range: createRange(0),

          isExported: false,
        },

        {
          name: 'second',

          async: false,

          range: createRange(5),

          isExported: false,
        },
      ],
    });

    const result = calculateFileStructureMetrics([
      {
        parsedFile,

        source: `
function first(
  value: number,
) {
  if (value > 0) {
    return true;
  }

  return false;
}

function second(
  items: string[],
) {
  for (const item of items) {
    console.log(item);
  }
}
                `,
      },
    ]);

    expect(result[0]?.structure).toMatchObject({
      functionCount: 2,

      cyclomaticComplexity: 4,
    });
  });
});
