import { describe, expect, it, vi } from 'vitest';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

import { createPersistedSymbolKey, persistAnalysisSymbols } from './symbol-persistence.js';

import type { PersistAnalysisSymbolInput } from './symbol-persistence.js';

const SERVER_FILE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const SERVICE_FILE_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const FUNCTION_ID = '11111111-1111-1111-1111-111111111111';

const CLASS_ID = '22222222-2222-2222-2222-222222222222';

function createFileMap(): FileIdByPath {
  return new Map([
    ['src/server.ts', SERVER_FILE_ID],
    ['src/service.ts', SERVICE_FILE_ID],
  ]);
}

function createSymbol(
  overrides: Partial<PersistAnalysisSymbolInput> = {},
): PersistAnalysisSymbolInput {
  return {
    filePath: 'src/server.ts',

    kind: 'function',

    name: 'startServer',

    qualifiedName: 'startServer',

    startLine: 10,

    startColumn: 0,

    endLine: 20,

    endColumn: 1,

    isExported: true,

    complexity: 3,

    ...overrides,
  };
}

function createTransaction(
  returnedRows: readonly {
    id: string;

    fileId: string;

    kind: PersistAnalysisSymbolInput['kind'];

    qualifiedName: string;

    startLine: number;
  }[] = [],
): {
  transaction: DatabaseTransaction;

  insertSpy: ReturnType<typeof vi.fn>;

  valuesSpy: ReturnType<typeof vi.fn>;
} {
  const returningSpy = vi.fn(async () => returnedRows);

  const valuesSpy = vi.fn(() => ({
    returning: returningSpy,
  }));

  const insertSpy = vi.fn(() => ({
    values: valuesSpy,
  }));

  return {
    transaction: {
      insert: insertSpy,
    } as unknown as DatabaseTransaction,

    insertSpy,

    valuesSpy,
  };
}

describe('persistAnalysisSymbols', () => {
  it('returns an empty map without inserting when there are no symbols', async () => {
    const { transaction, insertSpy } = createTransaction();

    const result = await persistAnalysisSymbols(transaction, [], createFileMap());

    expect(result.size).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('persists symbols and returns their database IDs by deterministic key', async () => {
    const functionSymbol = createSymbol();

    const classSymbol = createSymbol({
      filePath: 'src/service.ts',

      kind: 'class',

      name: 'Service',

      qualifiedName: 'Service',

      startLine: 1,

      endLine: 30,
    });

    const { transaction } = createTransaction([
      {
        id: FUNCTION_ID,

        fileId: SERVER_FILE_ID,

        kind: 'function',

        qualifiedName: 'startServer',

        startLine: 10,
      },
      {
        id: CLASS_ID,

        fileId: SERVICE_FILE_ID,

        kind: 'class',

        qualifiedName: 'Service',

        startLine: 1,
      },
    ]);

    const result = await persistAnalysisSymbols(
      transaction,
      [functionSymbol, classSymbol],
      createFileMap(),
    );

    expect(result.get(createPersistedSymbolKey(functionSymbol))).toBe(FUNCTION_ID);

    expect(result.get(createPersistedSymbolKey(classSymbol))).toBe(CLASS_ID);
  });

  it('uses safe defaults for optional fields', async () => {
    const { transaction, valuesSpy } = createTransaction([
      {
        id: FUNCTION_ID,

        fileId: SERVER_FILE_ID,

        kind: 'function',

        qualifiedName: 'startServer',

        startLine: 10,
      },
    ]);

    /*
     * Intentionally omit isExported and complexity.
     *
     * With exactOptionalPropertyTypes enabled,
     * an optional property should be absent rather
     * than explicitly set to undefined.
     */
    const symbolWithoutOptionals: PersistAnalysisSymbolInput = {
      filePath: 'src/server.ts',

      kind: 'function',

      name: 'startServer',

      qualifiedName: 'startServer',

      startLine: 10,

      startColumn: 0,

      endLine: 20,

      endColumn: 1,
    };

    await persistAnalysisSymbols(transaction, [symbolWithoutOptionals], createFileMap());

    expect(valuesSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        isExported: false,

        complexity: null,
      }),
    ]);
  });
  it('rejects a symbol for an unknown file before inserting', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            filePath: 'src/missing.ts',
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty symbol name', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            name: '   ',
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol name cannot be empty');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an empty qualified name', async () => {
    const { transaction } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            qualifiedName: '',
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol qualifiedName cannot be empty');
  });

  it('rejects an invalid starting line', async () => {
    const { transaction } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            startLine: 0,
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol startLine must be a positive integer');
  });

  it('rejects a symbol ending before its starting line', async () => {
    const { transaction } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            startLine: 20,

            endLine: 10,
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol "startServer" ends before it starts');
  });

  it('rejects a backwards range on the same line', async () => {
    const { transaction } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            startLine: 10,

            endLine: 10,

            startColumn: 15,

            endColumn: 4,
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol "startServer" ends before it starts');
  });

  it('rejects non-positive complexity', async () => {
    const { transaction } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          createSymbol({
            complexity: 0,
          }),
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Symbol "startServer" complexity must be a positive integer');
  });

  it('rejects duplicate database symbol identities before inserting', async () => {
    const symbol = createSymbol();

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisSymbols(
        transaction,
        [
          symbol,
          {
            ...symbol,

            name: 'differentName',
          },
        ],
        createFileMap(),
      ),
    ).rejects.toThrow('Duplicate symbol persistence identity');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an unexpected inserted row count', async () => {
    const { transaction } = createTransaction([]);

    await expect(
      persistAnalysisSymbols(transaction, [createSymbol()], createFileMap()),
    ).rejects.toThrow('Expected PostgreSQL to insert 1 symbols but received 0');
  });

  it('rejects a returned symbol belonging to an unknown file ID', async () => {
    const { transaction } = createTransaction([
      {
        id: FUNCTION_ID,

        fileId: '99999999-9999-9999-9999-999999999999',

        kind: 'function',

        qualifiedName: 'startServer',

        startLine: 10,
      },
    ]);

    await expect(
      persistAnalysisSymbols(transaction, [createSymbol()], createFileMap()),
    ).rejects.toThrow('PostgreSQL returned a symbol for unknown file ID');
  });
});
