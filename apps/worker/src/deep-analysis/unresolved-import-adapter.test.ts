import { describe, expect, it } from 'vitest';

import { createUnresolvedImportFindingInputs } from './unresolved-import-adapter.js';

import { RepositoryFileIndex } from '../resolution/file-index.js';

import type { RepositoryImportResolution } from '../resolution/repository-import-resolver.js';

import type { ResolvedImport } from '../resolution/types.js';

interface TestImportInput {
  sourceFilePath: string;

  specifier: string;

  kind: ResolvedImport['kind'];

  reason: ResolvedImport['reason'];

  targetFilePath?: string | null;
}

function createImport(input: TestImportInput): ResolvedImport {
  return {
    sourceFilePath: input.sourceFilePath,

    sourceLanguage: 'typescript',

    specifier: input.specifier,

    range: {
      start: {
        row: 0,

        column: 0,
      },

      end: {
        row: 0,

        column: 1,
      },
    },

    kind: input.kind,

    targetFilePath: input.targetFilePath ?? null,

    reason: input.reason,
  };
}

function createResolution(imports: ResolvedImport[]): RepositoryImportResolution {
  return {
    /*
     * The adapter only reads resolution.imports,
     * but RepositoryImportResolution still requires
     * the real B6 RepositoryFileIndex type.
     */
    fileIndex: new RepositoryFileIndex([]),

    imports,
  };
}

describe('createUnresolvedImportFindingInputs', () => {
  it('converts target-not-found imports into B9 inputs', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/service.ts',

        specifier: './missing',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([
      {
        filePath: 'src/service.ts',

        specifier: './missing',

        reason: 'target-not-found',
      },
    ]);
  });

  it('converts unsupported specifiers into B9 inputs', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/service.ts',

        specifier: 'virtual:generated',

        kind: 'unresolved',

        reason: 'unsupported-specifier',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([
      {
        filePath: 'src/service.ts',

        specifier: 'virtual:generated',

        reason: 'unsupported-specifier',
      },
    ]);
  });

  it('ignores internal imports', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/app.ts',

        specifier: './service',

        kind: 'internal',

        reason: null,

        targetFilePath: 'src/service.ts',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([]);
  });

  it('ignores external packages', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/app.ts',

        specifier: 'express',

        kind: 'external',

        reason: 'external-package',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([]);
  });

  it('returns only unresolved imports from mixed resolver results', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/app.ts',

        specifier: './service',

        kind: 'internal',

        reason: null,

        targetFilePath: 'src/service.ts',
      }),

      createImport({
        sourceFilePath: 'src/app.ts',

        specifier: 'fastify',

        kind: 'external',

        reason: 'external-package',
      }),

      createImport({
        sourceFilePath: 'src/service.ts',

        specifier: './missing',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([
      {
        filePath: 'src/service.ts',

        specifier: './missing',

        reason: 'target-not-found',
      },
    ]);
  });

  it('returns inputs in deterministic file and specifier order', () => {
    const resolution = createResolution([
      createImport({
        sourceFilePath: 'src/z.ts',

        specifier: './z',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),

      createImport({
        sourceFilePath: 'src/a.ts',

        specifier: 'virtual:b',

        kind: 'unresolved',

        reason: 'unsupported-specifier',
      }),

      createImport({
        sourceFilePath: 'src/a.ts',

        specifier: './a',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),
    ]);

    expect(createUnresolvedImportFindingInputs(resolution)).toEqual([
      {
        filePath: 'src/a.ts',

        specifier: './a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/a.ts',

        specifier: 'virtual:b',

        reason: 'unsupported-specifier',
      },

      {
        filePath: 'src/z.ts',

        specifier: './z',

        reason: 'target-not-found',
      },
    ]);
  });

  it('returns the same output regardless of resolver import order', () => {
    const first = createResolution([
      createImport({
        sourceFilePath: 'src/b.ts',

        specifier: './missing-b',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),

      createImport({
        sourceFilePath: 'src/a.ts',

        specifier: './missing-a',

        kind: 'unresolved',

        reason: 'target-not-found',
      }),
    ]);

    const firstImport = first.imports[0];

    const secondImport = first.imports[1];

    if (firstImport === undefined || secondImport === undefined) {
      throw new Error('Expected two resolver imports');
    }

    const second = createResolution([secondImport, firstImport]);

    expect(createUnresolvedImportFindingInputs(first)).toEqual(
      createUnresolvedImportFindingInputs(second),
    );
  });

  it('returns an empty array when there are no imports', () => {
    expect(createUnresolvedImportFindingInputs(createResolution([]))).toEqual([]);
  });
});
