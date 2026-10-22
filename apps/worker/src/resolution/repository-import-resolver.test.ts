import { describe, expect, it } from 'vitest';

import { resolveRepositoryImports } from './repository-import-resolver.js';

import type { ParseSourceResult, SourceRange } from '../parsing/types.js';

function createRange(): SourceRange {
  return {
    start: {
      row: 0,
      column: 0,
    },

    end: {
      row: 0,
      column: 10,
    },
  };
}

describe('resolveRepositoryImports', () => {
  it('resolves mixed JavaScript, TypeScript, Python, external, and missing dependencies', () => {
    const parsedFiles: ParseSourceResult[] = [
      {
        filePath: 'src/app.ts',

        language: 'typescript',

        imports: [
          {
            source: './service.js',

            range: createRange(),
          },

          {
            source: 'express',

            range: createRange(),
          },

          {
            source: './missing.js',

            range: createRange(),
          },
        ],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'src/service.ts',

        language: 'typescript',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'python/app.py',

        language: 'python',

        imports: [
          {
            source: 'python.services.user',

            range: createRange(),
          },

          {
            source: 'numpy',

            range: createRange(),
          },
        ],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'python/services/user.py',

        language: 'python',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },
    ];

    const result = resolveRepositoryImports(parsedFiles);

    expect(result.fileIndex.toArray()).toEqual([
      'python/app.py',
      'python/services/user.py',
      'src/app.ts',
      'src/service.ts',
    ]);

    expect(
      result.imports.map((item) => ({
        sourceFilePath: item.sourceFilePath,

        specifier: item.specifier,

        kind: item.kind,

        targetFilePath: item.targetFilePath,

        reason: item.reason,
      })),
    ).toEqual([
      {
        sourceFilePath: 'src/app.ts',

        specifier: './service.js',

        kind: 'internal',

        targetFilePath: 'src/service.ts',

        reason: null,
      },

      {
        sourceFilePath: 'src/app.ts',

        specifier: 'express',

        kind: 'external',

        targetFilePath: null,

        reason: 'external-package',
      },

      {
        sourceFilePath: 'src/app.ts',

        specifier: './missing.js',

        kind: 'unresolved',

        targetFilePath: null,

        reason: 'target-not-found',
      },

      {
        sourceFilePath: 'python/app.py',

        specifier: 'python.services.user',

        kind: 'internal',

        targetFilePath: 'python/services/user.py',

        reason: null,
      },

      {
        sourceFilePath: 'python/app.py',

        specifier: 'numpy',

        kind: 'external',

        targetFilePath: null,

        reason: 'external-package',
      },
    ]);
  });

  it('returns an empty import list when parsed files have no imports', () => {
    const parsedFiles: ParseSourceResult[] = [
      {
        filePath: 'src/app.ts',

        language: 'typescript',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'src/service.ts',

        language: 'typescript',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },
    ];

    const result = resolveRepositoryImports(parsedFiles);

    expect(result.imports).toEqual([]);

    expect(result.fileIndex.toArray()).toEqual(['src/app.ts', 'src/service.ts']);
  });

  it('preserves import ordering from parsed files', () => {
    const parsedFiles: ParseSourceResult[] = [
      {
        filePath: 'src/app.ts',

        language: 'typescript',

        imports: [
          {
            source: './a.js',

            range: createRange(),
          },

          {
            source: './b.js',

            range: createRange(),
          },
        ],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'src/a.ts',

        language: 'typescript',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },

      {
        filePath: 'src/b.ts',

        language: 'typescript',

        imports: [],

        functions: [],

        classes: [],

        hasSyntaxErrors: false,
      },
    ];

    const result = resolveRepositoryImports(parsedFiles);

    expect(result.imports.map((item) => item.specifier)).toEqual(['./a.js', './b.js']);

    expect(result.imports.map((item) => item.targetFilePath)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
