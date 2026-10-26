import { describe, expect, it } from 'vitest';

import { parseSource } from '../parsing/parser.js';

import { resolveRepositoryFunctionCalls } from './repository-function-call-resolver.js';

describe('resolveRepositoryFunctionCalls', () => {
  it('resolves same-file calls from real parsed source', () => {
    const parsedFile = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
function saveUser() {}

function createUser() {
  saveUser();
}
      `,
    });

    const result = resolveRepositoryFunctionCalls([parsedFile]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]).toMatchObject({
      sourceFilePath: 'src/users.ts',

      callee: 'saveUser',

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      reason: null,
    });

    expect(result.calls[0]?.sourceFunction.name).toBe('createUser');

    expect(result.calls[0]?.targetFunction?.name).toBe('saveUser');
  });

  it('resolves a named imported function across repository files', () => {
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

    const result = resolveRepositoryFunctionCalls([app, users]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]).toMatchObject({
      sourceFilePath: 'src/app.ts',

      callee: 'saveUser',

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      reason: null,
    });

    expect(result.calls[0]?.sourceFunction.name).toBe('createUser');

    expect(result.calls[0]?.targetFunction?.name).toBe('saveUser');
  });

  it('resolves an aliased named imported function across repository files', () => {
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

    const result = resolveRepositoryFunctionCalls([app, users]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]).toMatchObject({
      sourceFilePath: 'src/app.ts',

      callee: 'persistUser',

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      reason: null,
    });

    expect(result.calls[0]?.sourceFunction.name).toBe('createUser');

    expect(result.calls[0]?.targetFunction?.name).toBe('saveUser');
  });

  it('keeps unsupported member calls unresolved', () => {
    const parsedFile = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
function createUser() {
  userService.save();
}
      `,
    });

    const result = resolveRepositoryFunctionCalls([parsedFile]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]).toMatchObject({
      callee: 'userService.save',

      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'unsupported-callee',
    });
  });

  it('skips module-scope calls', () => {
    const parsedFile = parseSource({
      filePath: 'src/bootstrap.ts',

      language: 'typescript',

      source: `
console.log('boot');

function start() {
  runServer();
}
      `,
    });

    const result = resolveRepositoryFunctionCalls([parsedFile]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]?.callee).toBe('runServer');

    expect(result.calls[0]?.sourceFunction.name).toBe('start');
  });

  it('preserves the nearest caller for nested functions', () => {
    const parsedFile = parseSource({
      filePath: 'src/nested.ts',

      language: 'typescript',

      source: `
function saveUser() {}

function outer() {
  function inner() {
    saveUser();
  }
}
      `,
    });

    const result = resolveRepositoryFunctionCalls([parsedFile]);

    expect(result.calls).toHaveLength(1);

    expect(result.calls[0]).toMatchObject({
      callee: 'saveUser',

      kind: 'internal',

      targetFilePath: 'src/nested.ts',

      reason: null,
    });

    expect(result.calls[0]?.sourceFunction.name).toBe('inner');

    expect(result.calls[0]?.targetFunction?.name).toBe('saveUser');
  });

  it('resolves calls independently within each repository file', () => {
    const first = parseSource({
      filePath: 'src/a.ts',

      language: 'typescript',

      source: `
function helperA() {}

function runA() {
  helperA();
}
      `,
    });

    const second = parseSource({
      filePath: 'src/b.ts',

      language: 'typescript',

      source: `
function helperB() {}

function runB() {
  helperB();
}
      `,
    });

    const result = resolveRepositoryFunctionCalls([second, first]);

    expect(
      result.calls.map((call) => ({
        sourceFilePath: call.sourceFilePath,

        sourceFunction: call.sourceFunction.name,

        callee: call.callee,

        targetFunction: call.targetFunction?.name ?? null,
      })),
    ).toEqual([
      {
        sourceFilePath: 'src/b.ts',

        sourceFunction: 'runB',

        callee: 'helperB',

        targetFunction: 'helperB',
      },

      {
        sourceFilePath: 'src/a.ts',

        sourceFunction: 'runA',

        callee: 'helperA',

        targetFunction: 'helperA',
      },
    ]);
  });

  it('returns no calls for an empty repository', () => {
    expect(resolveRepositoryFunctionCalls([])).toEqual({
      calls: [],
    });
  });
});
