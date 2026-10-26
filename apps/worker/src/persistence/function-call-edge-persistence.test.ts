import { describe, expect, it, vi } from 'vitest';

import { edges } from '@astral-atlas/database';

import type { ParsedFunction, SourceRange } from '../parsing/types.js';

import type { ResolvedCall } from '../resolution/types.js';

import { persistFunctionCallEdges } from './function-call-edge-persistence.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

import { createPersistedSymbolKey, type SymbolIdByKey } from './symbol-persistence.js';

interface CapturedInsert {
  table: unknown;

  values: unknown;
}

function createRange(startRow: number, endRow: number): SourceRange {
  return {
    start: {
      row: startRow,
      column: 0,
    },

    end: {
      row: endRow,
      column: 1,
    },
  };
}

function createFunction(name: string | null, startRow: number): ParsedFunction {
  return {
    name,

    range: createRange(startRow, startRow + 2),

    async: false,

    isExported: true,
  };
}

function createResolvedCall(overrides: Partial<ResolvedCall> = {}): ResolvedCall {
  const sourceFunction = overrides.sourceFunction ?? createFunction('createUser', 4);

  const targetFunction = overrides.targetFunction ?? createFunction('saveUser', 9);

  return {
    sourceFilePath: 'src/app.ts',

    sourceLanguage: 'typescript',

    sourceFunction,

    callee: 'saveUser',

    range: createRange(6, 6),

    kind: 'internal',

    targetFilePath: 'src/users.ts',

    targetFunction,

    reason: null,

    ...overrides,
  };
}

function createTransaction(): {
  transaction: DatabaseTransaction;

  inserts: CapturedInsert[];

  insertSpy: ReturnType<typeof vi.fn>;
} {
  const inserts: CapturedInsert[] = [];

  const insertSpy = vi.fn((table: unknown) => {
    if (table !== edges) {
      throw new Error('Unexpected table insert');
    }

    return {
      values: vi.fn(async (values: unknown) => {
        inserts.push({
          table,

          values,
        });
      }),
    };
  });

  const transaction = {
    insert: insertSpy,
  } as unknown as DatabaseTransaction;

  return {
    transaction,

    inserts,

    insertSpy,
  };
}

function createFileIdByPath(entries: [string, string][]): FileIdByPath {
  return new Map(entries);
}

function createFunctionSymbolKey(filePath: string, functionNode: ParsedFunction): string {
  const name = functionNode.name;

  if (!name) {
    throw new Error('Expected named function in test helper');
  }

  return createPersistedSymbolKey({
    filePath,

    kind: 'function',

    qualifiedName: name,

    startLine: functionNode.range.start.row + 1,
  });
}

function createSymbolIdByKey(call: ResolvedCall): SymbolIdByKey {
  if (call.targetFilePath === null || call.targetFunction === null) {
    throw new Error('Expected internal resolved call');
  }

  return new Map([
    [
      createFunctionSymbolKey(call.sourceFilePath, call.sourceFunction),
      '11111111-1111-1111-1111-111111111111',
    ],

    [
      createFunctionSymbolKey(call.targetFilePath, call.targetFunction),
      '22222222-2222-2222-2222-222222222222',
    ],
  ]);
}

describe('persistFunctionCallEdges', () => {
  it('persists a resolved internal function call edge', async () => {
    const call = createResolvedCall();

    const fileIdByPath = createFileIdByPath([
      ['src/app.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/users.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, inserts } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [call],
      fileIdByPath,
      createSymbolIdByKey(call),
    );

    expect(count).toBe(1);

    expect(inserts).toHaveLength(1);

    expect(inserts[0]?.values).toEqual([
      {
        analysisId: '99999999-9999-9999-9999-999999999999',

        fromFileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        toFileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        fromSymbolId: '11111111-1111-1111-1111-111111111111',

        toSymbolId: '22222222-2222-2222-2222-222222222222',

        type: 'call',

        weight: 1,

        isDynamic: false,
      },
    ]);
  });

  it('collapses repeated calls between the same symbols into weight', async () => {
    const call = createResolvedCall();

    const fileIdByPath = createFileIdByPath([
      ['src/app.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/users.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, inserts } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [call, call, call],
      fileIdByPath,
      createSymbolIdByKey(call),
    );

    expect(count).toBe(1);

    expect(inserts[0]?.values).toEqual([
      expect.objectContaining({
        type: 'call',

        weight: 3,
      }),
    ]);
  });

  it('does not persist unresolved calls', async () => {
    const call = createResolvedCall({
      kind: 'unresolved',

      targetFilePath: null,

      targetFunction: null,

      reason: 'target-not-found',
    });

    const { transaction, insertSpy } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [call],
      createFileIdByPath([]),
      new Map(),
    );

    expect(count).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('skips calls whose source function is anonymous', async () => {
    const call = createResolvedCall({
      sourceFunction: createFunction(null, 4),
    });

    const { transaction, insertSpy } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [call],
      createFileIdByPath([]),
      new Map(),
    );

    expect(count).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('skips calls whose target function is anonymous', async () => {
    const call = createResolvedCall({
      targetFunction: createFunction(null, 9),
    });

    const { transaction, insertSpy } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [call],
      createFileIdByPath([]),
      new Map(),
    );

    expect(count).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a call whose source file was not persisted', async () => {
    const call = createResolvedCall();

    const fileIdByPath = createFileIdByPath([
      ['src/users.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistFunctionCallEdges(
        transaction,
        '99999999-9999-9999-9999-999999999999',
        [call],
        fileIdByPath,
        createSymbolIdByKey(call),
      ),
    ).rejects.toThrow('Function call edge references unknown persisted file "src/app.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a call whose target file was not persisted', async () => {
    const call = createResolvedCall();

    const fileIdByPath = createFileIdByPath([
      ['src/app.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistFunctionCallEdges(
        transaction,
        '99999999-9999-9999-9999-999999999999',
        [call],
        fileIdByPath,
        createSymbolIdByKey(call),
      ),
    ).rejects.toThrow('Function call edge references unknown persisted file "src/users.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a call whose source symbol was not persisted', async () => {
    const call = createResolvedCall();

    if (call.targetFilePath === null || call.targetFunction === null) {
      throw new Error('Expected resolved target');
    }

    const fileIdByPath = createFileIdByPath([
      ['src/app.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/users.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const symbolIdByKey: SymbolIdByKey = new Map([
      [
        createFunctionSymbolKey(call.targetFilePath, call.targetFunction),
        '22222222-2222-2222-2222-222222222222',
      ],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistFunctionCallEdges(
        transaction,
        '99999999-9999-9999-9999-999999999999',
        [call],
        fileIdByPath,
        symbolIdByKey,
      ),
    ).rejects.toThrow('Function call edge references unknown persisted symbol');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a call whose target symbol was not persisted', async () => {
    const call = createResolvedCall();

    const fileIdByPath = createFileIdByPath([
      ['src/app.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

      ['src/users.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
    ]);

    const symbolIdByKey: SymbolIdByKey = new Map([
      [
        createFunctionSymbolKey(call.sourceFilePath, call.sourceFunction),
        '11111111-1111-1111-1111-111111111111',
      ],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistFunctionCallEdges(
        transaction,
        '99999999-9999-9999-9999-999999999999',
        [call],
        fileIdByPath,
        symbolIdByKey,
      ),
    ).rejects.toThrow('Function call edge references unknown persisted symbol');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('does not insert anything for an empty call list', async () => {
    const { transaction, insertSpy } = createTransaction();

    const count = await persistFunctionCallEdges(
      transaction,
      '99999999-9999-9999-9999-999999999999',
      [],
      createFileIdByPath([]),
      new Map(),
    );

    expect(count).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
