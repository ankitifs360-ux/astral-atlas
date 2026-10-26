import { describe, expect, it } from 'vitest';

import { createFunctionNodeId } from './function-call-graph-id.js';

import type { ParsedFunction, SourceRange } from '../parsing/types.js';

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

function createFunction(
  name: string | null,
  range: SourceRange = createRange(0, 0, 2, 1),
): ParsedFunction {
  return {
    name,

    range,

    async: false,

    isExported: false,
  };
}

describe('createFunctionNodeId', () => {
  it('returns a deterministic ID for the same function', () => {
    const functionNode = createFunction('start');

    const first = createFunctionNodeId('src/app.ts', functionNode);

    const second = createFunctionNodeId('src/app.ts', functionNode);

    expect(first).toBe(second);

    expect(first).toMatch(/^function:[a-f0-9]{24}$/);
  });

  it('produces different IDs for the same function name in different files', () => {
    const functionNode = createFunction('start');

    const first = createFunctionNodeId('src/app.ts', functionNode);

    const second = createFunctionNodeId('src/service.ts', functionNode);

    expect(first).not.toBe(second);
  });

  it('produces different IDs for different function names', () => {
    const first = createFunctionNodeId('src/app.ts', createFunction('start'));

    const second = createFunctionNodeId('src/app.ts', createFunction('stop'));

    expect(first).not.toBe(second);
  });

  it('produces different IDs for functions with the same name at different locations', () => {
    const first = createFunctionNodeId(
      'src/app.ts',
      createFunction('handler', createRange(0, 0, 2, 1)),
    );

    const second = createFunctionNodeId(
      'src/app.ts',
      createFunction('handler', createRange(5, 0, 7, 1)),
    );

    expect(first).not.toBe(second);
  });

  it('creates stable IDs for anonymous functions', () => {
    const functionNode = createFunction(null, createRange(3, 4, 5, 8));

    const first = createFunctionNodeId('src/app.ts', functionNode);

    const second = createFunctionNodeId('src/app.ts', functionNode);

    expect(first).toBe(second);

    expect(first).toMatch(/^function:[a-f0-9]{24}$/);
  });

  it('distinguishes anonymous functions by source location', () => {
    const first = createFunctionNodeId(
      'src/app.ts',
      createFunction(null, createRange(1, 0, 1, 10)),
    );

    const second = createFunctionNodeId(
      'src/app.ts',
      createFunction(null, createRange(2, 0, 2, 10)),
    );

    expect(first).not.toBe(second);
  });
});
