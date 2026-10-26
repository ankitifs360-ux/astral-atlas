import { describe, expect, it } from 'vitest';

import { parseSource } from '../parsing/parser.js';

import { resolveRepositoryImports } from './repository-import-resolver.js';

import { resolveNamedImportedFunctionCall } from './imported-function-call-resolver.js';

import type { CallResolutionRequest } from './types.js';

function createRequest(
  sourceFile: ReturnType<typeof parseSource>,
  callee: string,
): CallResolutionRequest {
  const sourceFunction = sourceFile.functions.find(
    (functionNode) => functionNode.name === 'createUser',
  );

  if (!sourceFunction) {
    throw new Error('Expected createUser function');
  }

  const parsedCall = sourceFile.calls.find((call) => call.callee === callee);

  if (!parsedCall) {
    throw new Error(`Expected call "${callee}"`);
  }

  return {
    sourceFilePath: sourceFile.filePath,

    sourceLanguage: sourceFile.language,

    sourceFunction,

    callee,

    range: parsedCall.range,
  };
}

describe('resolveNamedImportedFunctionCall', () => {
  it('resolves a named imported function', () => {
    const app = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
        import { saveUser } from './users.js';

        function createUser() {
          saveUser();
        }
      `,
    });

    const users = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
        export function saveUser() {}
      `,
    });

    const parsedFiles = [app, users];

    const importResolution = resolveRepositoryImports(parsedFiles);

    const result = resolveNamedImportedFunctionCall(
      createRequest(app, 'saveUser'),
      app,
      importResolution.imports,
      new Map(parsedFiles.map((file) => [file.filePath, file] as const)),
    );

    expect(result).toMatchObject({
      sourceFilePath: 'src/app.ts',

      callee: 'saveUser',

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      reason: null,
    });

    expect(result.targetFunction?.name).toBe('saveUser');
  });

  it('resolves an aliased named import by its local call name', () => {
    const app = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
        import {
          saveUser as persistUser,
        } from './users.js';

        function createUser() {
          persistUser();
        }
      `,
    });

    const users = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
        export function saveUser() {}
      `,
    });

    const parsedFiles = [app, users];

    const importResolution = resolveRepositoryImports(parsedFiles);

    const result = resolveNamedImportedFunctionCall(
      createRequest(app, 'persistUser'),
      app,
      importResolution.imports,
      new Map(parsedFiles.map((file) => [file.filePath, file] as const)),
    );

    expect(result).toMatchObject({
      callee: 'persistUser',

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      reason: null,
    });

    expect(result.targetFunction?.name).toBe('saveUser');
  });

  it('does not resolve a non-exported target function', () => {
    const app = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
        import { saveUser } from './users.js';

        function createUser() {
          saveUser();
        }
      `,
    });

    const users = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
        function saveUser() {}
      `,
    });

    const parsedFiles = [app, users];

    const importResolution = resolveRepositoryImports(parsedFiles);

    const result = resolveNamedImportedFunctionCall(
      createRequest(app, 'saveUser'),
      app,
      importResolution.imports,
      new Map(parsedFiles.map((file) => [file.filePath, file] as const)),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'target-not-found',
    });
  });

  it('keeps namespace member calls unsupported', () => {
    const app = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
        import * as users from './users.js';

        function createUser() {
          users.saveUser();
        }
      `,
    });

    const users = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
        export function saveUser() {}
      `,
    });

    const parsedFiles = [app, users];

    const importResolution = resolveRepositoryImports(parsedFiles);

    const result = resolveNamedImportedFunctionCall(
      createRequest(app, 'users.saveUser'),
      app,
      importResolution.imports,
      new Map(parsedFiles.map((file) => [file.filePath, file] as const)),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'unsupported-callee',
    });
  });

  it('returns target-not-found when the imported module cannot resolve internally', () => {
    const app = parseSource({
      filePath: 'src/app.ts',

      language: 'typescript',

      source: `
        import { saveUser } from './missing.js';

        function createUser() {
          saveUser();
        }
      `,
    });

    const parsedFiles = [app];

    const importResolution = resolveRepositoryImports(parsedFiles);

    const result = resolveNamedImportedFunctionCall(
      createRequest(app, 'saveUser'),
      app,
      importResolution.imports,
      new Map([[app.filePath, app]]),
    );

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'target-not-found',
    });
  });
});
