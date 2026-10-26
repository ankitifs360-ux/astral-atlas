import { describe, expect, it } from 'vitest';

import { resolveSameFileFunctionCall } from './function-call-resolver.js';

import type { ParsedFunction, SourceRange } from '../parsing/types.js';

import type { CallResolutionRequest } from './types.js';

function createRange(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): SourceRange {
  return {
    start: {
      row: startRow,
      column: startColumn,
    },

    end: {
      row: endRow,
      column: endColumn,
    },
  };
}

function createFunction(name: string | null, range: SourceRange): ParsedFunction {
  return {
    name,

    range,

    async: false,

    isExported: false,
  };
}

function createRequest(sourceFunction: ParsedFunction, callee: string): CallResolutionRequest {
  return {
    sourceFilePath: 'src/users.ts',

    sourceLanguage: 'typescript',

    sourceFunction,

    callee,

    range: createRange(5, 2, 5, 12),
  };
}

describe('resolveSameFileFunctionCall', () => {
  it('resolves a unique same-file function call', () => {
    const createUser = createFunction('createUser', createRange(3, 0, 7, 1));

    const saveUser = createFunction('saveUser', createRange(0, 0, 1, 1));

    const result = resolveSameFileFunctionCall(createRequest(createUser, 'saveUser'), [
      saveUser,
      createUser,
    ]);

    expect(result).toEqual({
      sourceFilePath: 'src/users.ts',

      sourceLanguage: 'typescript',

      sourceFunction: createUser,

      callee: 'saveUser',

      range: createRange(5, 2, 5, 12),

      kind: 'internal',

      targetFilePath: 'src/users.ts',

      targetFunction: saveUser,

      reason: null,
    });
  });

  it('returns target-not-found when no same-file function matches', () => {
    const createUser = createFunction('createUser', createRange(0, 0, 4, 1));

    const result = resolveSameFileFunctionCall(createRequest(createUser, 'saveUser'), [createUser]);

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'target-not-found',
    });
  });

  it('returns ambiguous-target when multiple functions share the callee name', () => {
    const caller = createFunction('run', createRange(10, 0, 14, 1));

    const first = createFunction('handler', createRange(0, 0, 2, 1));

    const second = createFunction('handler', createRange(4, 0, 6, 1));

    const result = resolveSameFileFunctionCall(createRequest(caller, 'handler'), [
      first,
      second,
      caller,
    ]);

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'ambiguous-target',
    });
  });

  it('does not guess a target for member calls', () => {
    const caller = createFunction('createUser', createRange(0, 0, 4, 1));

    const result = resolveSameFileFunctionCall(createRequest(caller, 'userService.save'), [caller]);

    expect(result).toMatchObject({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'unsupported-callee',
    });
  });

  it('ignores anonymous functions when matching by callee name', () => {
    const caller = createFunction('run', createRange(4, 0, 8, 1));

    const anonymous = createFunction(null, createRange(0, 0, 2, 1));

    const result = resolveSameFileFunctionCall(createRequest(caller, 'missing'), [
      anonymous,
      caller,
    ]);

    expect(result.reason).toBe('target-not-found');

    expect(result.targetFunction).toBeNull();
  });

  it('can resolve a recursive self-call', () => {
    const factorial = createFunction('factorial', createRange(0, 0, 6, 1));

    const result = resolveSameFileFunctionCall(createRequest(factorial, 'factorial'), [factorial]);

    expect(result).toMatchObject({
      kind: 'internal',

      targetFilePath: 'src/users.ts',

      targetFunction: factorial,

      reason: null,
    });
  });
});
