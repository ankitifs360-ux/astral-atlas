import { describe, expect, it } from 'vitest';

import { assignCallOwners, findCallOwner } from './call-owner-resolver.js';

import type { ParsedCall, ParsedFunction, SourceRange } from './types.js';

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

function createFunction(name: string, range: SourceRange): ParsedFunction {
  return {
    name,

    range,

    async: false,

    isExported: false,
  };
}

function createCall(callee: string, range: SourceRange): ParsedCall {
  return {
    callee,

    range,
  };
}

describe('findCallOwner', () => {
  it('returns the enclosing function for a call', () => {
    const functionNode = createFunction('createUser', createRange(0, 0, 4, 1));

    const call = createCall('saveUser', createRange(2, 2, 2, 12));

    expect(findCallOwner(call, [functionNode])).toEqual(functionNode);
  });

  it('returns null for a module-scope call', () => {
    const functionNode = createFunction('start', createRange(3, 0, 5, 1));

    const call = createCall('console.log', createRange(0, 0, 0, 20));

    expect(findCallOwner(call, [functionNode])).toBeNull();
  });

  it('selects the smallest enclosing function for nested functions', () => {
    const outer = createFunction('outer', createRange(0, 0, 8, 1));

    const inner = createFunction('inner', createRange(2, 2, 6, 3));

    const call = createCall('saveUser', createRange(4, 4, 4, 14));

    expect(findCallOwner(call, [outer, inner])).toEqual(inner);
  });

  it('selects the smallest enclosing function regardless of input order', () => {
    const outer = createFunction('outer', createRange(0, 0, 8, 1));

    const inner = createFunction('inner', createRange(2, 2, 6, 3));

    const call = createCall('saveUser', createRange(4, 4, 4, 14));

    expect(findCallOwner(call, [inner, outer])).toEqual(inner);
  });

  it('distinguishes functions located on the same source row', () => {
    const first = createFunction('first', createRange(0, 0, 0, 30));

    const second = createFunction('second', createRange(0, 31, 0, 60));

    const call = createCall('run', createRange(0, 45, 0, 50));

    expect(findCallOwner(call, [first, second])).toEqual(second);
  });

  it('returns null when there are no functions', () => {
    const call = createCall('run', createRange(0, 0, 0, 5));

    expect(findCallOwner(call, [])).toBeNull();
  });
});

describe('assignCallOwners', () => {
  it('associates calls with their enclosing function', () => {
    const createUser = createFunction('createUser', createRange(0, 0, 5, 1));

    const validateUser = createCall('validateUser', createRange(1, 2, 1, 16));

    const saveUser = createCall('saveUser', createRange(2, 2, 2, 12));

    expect(assignCallOwners([validateUser, saveUser], [createUser])).toEqual([
      {
        call: validateUser,

        owner: createUser,
      },

      {
        call: saveUser,

        owner: createUser,
      },
    ]);
  });

  it('keeps module-scope calls with a null owner', () => {
    const start = createFunction('start', createRange(3, 0, 5, 1));

    const moduleCall = createCall('console.log', createRange(0, 0, 0, 20));

    expect(assignCallOwners([moduleCall], [start])).toEqual([
      {
        call: moduleCall,

        owner: null,
      },
    ]);
  });

  it('assigns nested calls to the nearest function', () => {
    const outer = createFunction('outer', createRange(0, 0, 10, 1));

    const inner = createFunction('inner', createRange(3, 2, 7, 3));

    const outerCall = createCall('prepare', createRange(1, 2, 1, 11));

    const innerCall = createCall('saveUser', createRange(5, 4, 5, 14));

    expect(assignCallOwners([outerCall, innerCall], [outer, inner])).toEqual([
      {
        call: outerCall,

        owner: outer,
      },

      {
        call: innerCall,

        owner: inner,
      },
    ]);
  });

  it('preserves parsed call ordering', () => {
    const run = createFunction('run', createRange(0, 0, 6, 1));

    const first = createCall('first', createRange(1, 2, 1, 9));

    const second = createCall('second', createRange(2, 2, 2, 10));

    const third = createCall('third', createRange(3, 2, 3, 9));

    const result = assignCallOwners([first, second, third], [run]);

    expect(result.map((item) => item.call.callee)).toEqual(['first', 'second', 'third']);
  });

  it('returns an empty array when there are no calls', () => {
    const run = createFunction('run', createRange(0, 0, 3, 1));

    expect(assignCallOwners([], [run])).toEqual([]);
  });
});
