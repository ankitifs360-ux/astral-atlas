import { describe, expect, it } from 'vitest';

import { RepositoryFileIndex } from './file-index.js';

import { resolveImport, resolveImports } from './import-resolver.js';

import type { ImportResolutionRequest } from './types.js';

function createRange() {
  return {
    start: {
      row: 1,
      column: 0,
    },

    end: {
      row: 1,
      column: 10,
    },
  };
}

function createRequest(overrides: Partial<ImportResolutionRequest> = {}): ImportResolutionRequest {
  return {
    sourceFilePath: 'src/app.ts',

    sourceLanguage: 'typescript',

    specifier: './service.js',

    range: createRange(),

    ...overrides,
  };
}

describe('resolveImport', () => {
  it('classifies a resolvable TypeScript dependency as internal', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/service.ts']);

    const result = resolveImport(index, createRequest());

    expect(result).toEqual({
      sourceFilePath: 'src/app.ts',

      sourceLanguage: 'typescript',

      specifier: './service.js',

      range: createRange(),

      kind: 'internal',

      targetFilePath: 'src/service.ts',

      reason: null,
    });
  });

  it('classifies a missing relative JavaScript dependency as unresolved', () => {
    const index = new RepositoryFileIndex(['src/app.js']);

    const result = resolveImport(
      index,
      createRequest({
        sourceFilePath: 'src/app.js',

        sourceLanguage: 'javascript',

        specifier: './missing.js',
      }),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'target-not-found',
    });
  });

  it('classifies external JavaScript packages as external', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: 'express',
      }),
    );

    expect(result).toMatchObject({
      kind: 'external',

      targetFilePath: null,

      reason: 'external-package',
    });
  });

  it('classifies scoped JavaScript packages as external', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: '@scope/package',
      }),
    );

    expect(result).toMatchObject({
      kind: 'external',

      reason: 'external-package',
    });
  });

  it('classifies Node built-in specifiers as external', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: 'node:fs',
      }),
    );

    expect(result).toMatchObject({
      kind: 'external',

      reason: 'external-package',
    });
  });

  it('resolves TSX relative dependencies', () => {
    const index = new RepositoryFileIndex(['src/App.tsx', 'src/components/Button.tsx']);

    const result = resolveImport(
      index,
      createRequest({
        sourceFilePath: 'src/App.tsx',

        sourceLanguage: 'tsx',

        specifier: './components/Button.js',
      }),
    );

    expect(result).toMatchObject({
      kind: 'internal',

      targetFilePath: 'src/components/Button.tsx',

      reason: null,
    });
  });

  it('classifies resolvable Python repository modules as internal', () => {
    const index = new RepositoryFileIndex(['app.py', 'services/user.py']);

    const result = resolveImport(
      index,
      createRequest({
        sourceFilePath: 'app.py',

        sourceLanguage: 'python',

        specifier: 'services.user',
      }),
    );

    expect(result).toMatchObject({
      kind: 'internal',

      targetFilePath: 'services/user.py',

      reason: null,
    });
  });

  it('classifies unresolved relative Python imports as unresolved', () => {
    const index = new RepositoryFileIndex(['services/app.py']);

    const result = resolveImport(
      index,
      createRequest({
        sourceFilePath: 'services/app.py',

        sourceLanguage: 'python',

        specifier: '.missing',
      }),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'target-not-found',
    });
  });

  it('classifies unresolved absolute Python imports as external', () => {
    const index = new RepositoryFileIndex(['app.py']);

    const result = resolveImport(
      index,
      createRequest({
        sourceFilePath: 'app.py',

        sourceLanguage: 'python',

        specifier: 'numpy',
      }),
    );

    expect(result).toMatchObject({
      kind: 'external',

      targetFilePath: null,

      reason: 'external-package',
    });
  });

  it('classifies empty specifiers as unsupported', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: '',
      }),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'unsupported-specifier',
    });
  });

  it('classifies null-byte specifiers as unsupported', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: './user\0.ts',
      }),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      reason: 'unsupported-specifier',
    });
  });

  it('classifies absolute filesystem-style JavaScript specifiers as unsupported', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    const result = resolveImport(
      index,
      createRequest({
        specifier: '/src/service',
      }),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'unsupported-specifier',
    });
  });
});

describe('resolveImports', () => {
  it('resolves multiple imports while preserving request order', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/service.ts']);

    const requests: ImportResolutionRequest[] = [
      createRequest({
        specifier: './service.js',
      }),

      createRequest({
        specifier: 'express',
      }),

      createRequest({
        specifier: './missing.js',
      }),
    ];

    const results = resolveImports(index, requests);

    expect(
      results.map((result) => ({
        specifier: result.specifier,

        kind: result.kind,

        targetFilePath: result.targetFilePath,
      })),
    ).toEqual([
      {
        specifier: './service.js',

        kind: 'internal',

        targetFilePath: 'src/service.ts',
      },

      {
        specifier: 'express',

        kind: 'external',

        targetFilePath: null,
      },

      {
        specifier: './missing.js',

        kind: 'unresolved',

        targetFilePath: null,
      },
    ]);
  });

  it('returns an empty array for no requests', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    expect(resolveImports(index, [])).toEqual([]);
  });
});
