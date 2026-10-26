import { describe, expect, it } from 'vitest';

import { buildRepositoryGraph } from '../graph/repository-graph.js';

import { calculateRepositoryMetrics } from './repository-metrics.js';

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
  filePath: string,
  imports: ParseSourceResult['imports'] = [],
  options: {
    functionCount?: number;
    classCount?: number;
    hasSyntaxErrors?: boolean;
  } = {},
): ParseSourceResult {
  return {
    filePath,

    language: 'typescript',

    imports,

    functions: Array.from(
      {
        length: options.functionCount ?? 0,
      },
      (_, index) => ({
        name: `function${index}`,

        async: false,

        range: createRange(index),

        isExported: false,
      }),
    ),

    classes: Array.from(
      {
        length: options.classCount ?? 0,
      },
      (_, index) => ({
        name: `Class${index}`,

        range: createRange(index),

        isExported: false,
      }),
    ),

    calls: [],

    hasSyntaxErrors: options.hasSyntaxErrors ?? false,
  };
}

describe('calculateRepositoryMetrics', () => {
  it('combines graph and structure metrics for every file', () => {
    const app = createParsedFile(
      'src/app.ts',
      [
        {
          source: './service.js',

          range: createRange(0),
        },

        {
          source: 'express',

          range: createRange(1),
        },
      ],
      {
        functionCount: 1,

        classCount: 1,
      },
    );

    const service = createParsedFile('src/service.ts', [], {
      functionCount: 1,
    });

    const graphAnalysis = buildRepositoryGraph([app, service]);

    const result = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs: [
        {
          parsedFile: app,

          source: `
import {
  Service,
} from './service.js';

import express from 'express';

class App {}

function start(
  enabled: boolean,
) {
  if (enabled) {
    return new Service();
  }

  return null;
}
                  `,
        },

        {
          parsedFile: service,

          source: `
function run() {
  return true;
}
                  `,
        },
      ],
    });

    expect(result.files).toHaveLength(2);

    expect(result.files[0]).toEqual({
      filePath: 'src/app.ts',

      dependencies: {
        fanIn: 0,

        fanOut: 1,

        transitiveDependencyCount: 1,
      },

      blastRadius: {
        affectedFileCount: 0,

        maxDistance: 0,
      },

      cycles: {
        inDependencyCycle: false,

        cyclicComponentSize: 0,
      },

      structure: {
        importCount: 2,

        functionCount: 1,

        classCount: 1,

        cyclomaticComplexity: 2,

        hasSyntaxErrors: false,
      },

      churn: null,
    });

    expect(result.files[1]).toEqual({
      filePath: 'src/service.ts',

      dependencies: {
        fanIn: 1,

        fanOut: 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: 1,

        maxDistance: 1,
      },

      cycles: {
        inDependencyCycle: false,

        cyclicComponentSize: 0,
      },

      structure: {
        importCount: 0,

        functionCount: 1,

        classCount: 0,

        cyclomaticComplexity: 1,

        hasSyntaxErrors: false,
      },

      churn: null,
    });
  });

  it('calculates repository-wide summary values without Git history', () => {
    const app = createParsedFile('src/app.ts', [
      {
        source: './service.js',

        range: createRange(0),
      },

      {
        source: 'express',

        range: createRange(1),
      },

      {
        source: './missing.js',

        range: createRange(2),
      },
    ]);

    const service = createParsedFile('src/service.ts');

    const graphAnalysis = buildRepositoryGraph([app, service]);

    const result = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs: [
        {
          parsedFile: app,

          source: `
import './service.js';
import express from 'express';
import './missing.js';

if (enabled) {
  start();
}
                  `,
        },

        {
          parsedFile: service,

          source: `
const service = true;
                  `,
        },
      ],
    });

    expect(result.summary).toEqual({
      fileCount: 2,

      internalDependencyCount: 1,

      externalImportCount: 1,

      unresolvedImportCount: 1,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: 3,

      averageCyclomaticComplexity: 1.5,

      maxCyclomaticComplexity: 2,

      historyAvailable: false,

      totalChangedCommitCount: null,

      averageChangedCommitCount: null,

      maxChangedCommitCount: null,
    });
  });

  it('summarizes dependency cycles', () => {
    const first = createParsedFile('src/a.ts', [
      {
        source: './b.js',

        range: createRange(0),
      },
    ]);

    const second = createParsedFile('src/b.ts', [
      {
        source: './a.js',

        range: createRange(0),
      },
    ]);

    const graphAnalysis = buildRepositoryGraph([first, second]);

    const result = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs: [
        {
          parsedFile: first,

          source: `
import './b.js';
                  `,
        },

        {
          parsedFile: second,

          source: `
import './a.js';
                  `,
        },
      ],
    });

    expect(result.summary.cyclicComponentCount).toBe(1);

    expect(result.summary.cyclicFileCount).toBe(2);

    expect(
      result.files.map((file) => ({
        filePath: file.filePath,

        inCycle: file.cycles.inDependencyCycle,
      })),
    ).toEqual([
      {
        filePath: 'src/a.ts',

        inCycle: true,
      },

      {
        filePath: 'src/b.ts',

        inCycle: true,
      },
    ]);
  });

  it('preserves syntax-error status in final file metrics', () => {
    const parsedFile = createParsedFile('src/broken.ts', [], {
      hasSyntaxErrors: true,
    });

    const result = calculateRepositoryMetrics({
      graphAnalysis: buildRepositoryGraph([parsedFile]),

      structureInputs: [
        {
          parsedFile,

          source: 'const value = 1;',
        },
      ],
    });

    expect(result.files[0]?.structure.hasSyntaxErrors).toBe(true);
  });

  it('returns zero structural summary values for an empty repository', () => {
    const result = calculateRepositoryMetrics({
      graphAnalysis: buildRepositoryGraph([]),

      structureInputs: [],
    });

    expect(result).toEqual({
      summary: {
        fileCount: 0,

        internalDependencyCount: 0,

        externalImportCount: 0,

        unresolvedImportCount: 0,

        cyclicComponentCount: 0,

        cyclicFileCount: 0,

        totalCyclomaticComplexity: 0,

        averageCyclomaticComplexity: 0,

        maxCyclomaticComplexity: 0,

        historyAvailable: false,

        totalChangedCommitCount: null,

        averageChangedCommitCount: null,

        maxChangedCommitCount: null,
      },

      files: [],
    });
  });

  it('rejects structure metrics for files outside the dependency graph', () => {
    const app = createParsedFile('src/app.ts');

    const extra = createParsedFile('src/extra.ts');

    expect(() =>
      calculateRepositoryMetrics({
        graphAnalysis: buildRepositoryGraph([app]),

        structureInputs: [
          {
            parsedFile: app,

            source: 'const app = true;',
          },

          {
            parsedFile: extra,

            source: 'const extra = true;',
          },
        ],
      }),
    ).toThrow('Structure metrics contain file not present in dependency graph: src/extra.ts');
  });

  it('rejects graph files that have no structure metrics', () => {
    const app = createParsedFile('src/app.ts');

    const service = createParsedFile('src/service.ts');

    expect(() =>
      calculateRepositoryMetrics({
        graphAnalysis: buildRepositoryGraph([app, service]),

        structureInputs: [
          {
            parsedFile: app,

            source: 'const app = true;',
          },
        ],
      }),
    ).toThrow('Missing structure metrics for graph file: src/service.ts');
  });

  it('returns files in deterministic path order', () => {
    const z = createParsedFile('src/z.ts');

    const a = createParsedFile('src/a.ts');

    const m = createParsedFile('src/m.ts');

    const result = calculateRepositoryMetrics({
      graphAnalysis: buildRepositoryGraph([z, a, m]),

      structureInputs: [
        {
          parsedFile: z,

          source: 'const z = 1;',
        },

        {
          parsedFile: m,

          source: 'const m = 1;',
        },

        {
          parsedFile: a,

          source: 'const a = 1;',
        },
      ],
    });

    expect(result.files.map((file) => file.filePath)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('adds Git churn metrics when history is available', () => {
    const app = createParsedFile('src/app.ts');

    const service = createParsedFile('src/service.ts');

    const result = calculateRepositoryMetrics({
      graphAnalysis: buildRepositoryGraph([app, service]),

      structureInputs: [
        {
          parsedFile: app,

          source: 'const app = true;',
        },

        {
          parsedFile: service,

          source: 'const service = true;',
        },
      ],

      churnInputs: [
        {
          filePath: 'src/app.ts',

          changedCommitCount: 4,
        },
      ],
    });

    expect(
      result.files.map((file) => ({
        filePath: file.filePath,

        churn: file.churn,
      })),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        churn: {
          changedCommitCount: 4,
        },
      },

      {
        filePath: 'src/service.ts',

        churn: {
          changedCommitCount: 0,
        },
      },
    ]);

    expect(result.summary.historyAvailable).toBe(true);

    expect(result.summary.totalChangedCommitCount).toBe(4);

    expect(result.summary.averageChangedCommitCount).toBe(2);

    expect(result.summary.maxChangedCommitCount).toBe(4);
  });

  it('distinguishes available zero-churn history from unavailable history', () => {
    const app = createParsedFile('src/app.ts');

    const result = calculateRepositoryMetrics({
      graphAnalysis: buildRepositoryGraph([app]),

      structureInputs: [
        {
          parsedFile: app,

          source: 'const app = true;',
        },
      ],

      churnInputs: [],
    });

    expect(result.files[0]?.churn).toEqual({
      changedCommitCount: 0,
    });

    expect(result.summary).toMatchObject({
      historyAvailable: true,

      totalChangedCommitCount: 0,

      averageChangedCommitCount: 0,

      maxChangedCommitCount: 0,
    });
  });

  it('rejects Git churn for files outside the dependency graph', () => {
    const app = createParsedFile('src/app.ts');

    expect(() =>
      calculateRepositoryMetrics({
        graphAnalysis: buildRepositoryGraph([app]),

        structureInputs: [
          {
            parsedFile: app,

            source: 'const app = true;',
          },
        ],

        churnInputs: [
          {
            filePath: 'src/other.ts',

            changedCommitCount: 5,
          },
        ],
      }),
    ).toThrow('Git churn contains file not present in dependency graph: src/other.ts');
  });
});
