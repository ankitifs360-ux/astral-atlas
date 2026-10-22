import { symbols } from '@astral-atlas/database';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

export type PersistAnalysisSymbolKind =
  'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable';

export interface PersistAnalysisSymbolInput {
  filePath: string;

  kind: PersistAnalysisSymbolKind;

  name: string;

  qualifiedName: string;

  startLine: number;
  startColumn: number;

  endLine: number;
  endColumn: number;

  isExported?: boolean;

  complexity?: number;
}

export type SymbolIdByKey = ReadonlyMap<string, string>;

const SYMBOL_KINDS = new Set<PersistAnalysisSymbolKind>([
  'function',
  'class',
  'method',
  'interface',
  'type',
  'enum',
  'variable',
]);

export function createPersistedSymbolKey(
  symbol: Pick<PersistAnalysisSymbolInput, 'filePath' | 'kind' | 'qualifiedName' | 'startLine'>,
): string {
  /*
   * This matches the database's logical uniqueness:
   *
   * file
   * + kind
   * + qualified name
   * + starting line
   *
   * JSON.stringify avoids ambiguous separators.
   */
  return JSON.stringify([symbol.filePath, symbol.kind, symbol.qualifiedName, symbol.startLine]);
}

function requireFileId(fileIdByPath: FileIdByPath, filePath: string): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Symbol references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function validateNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateSymbol(symbol: PersistAnalysisSymbolInput, fileIdByPath: FileIdByPath): void {
  validateNonEmpty(symbol.filePath, 'Symbol filePath');

  requireFileId(fileIdByPath, symbol.filePath);

  if (!SYMBOL_KINDS.has(symbol.kind)) {
    throw new Error(`Unsupported symbol kind "${String(symbol.kind)}"`);
  }

  validateNonEmpty(symbol.name, 'Symbol name');

  validateNonEmpty(symbol.qualifiedName, 'Symbol qualifiedName');

  validatePositiveInteger(symbol.startLine, 'Symbol startLine');

  validatePositiveInteger(symbol.endLine, 'Symbol endLine');

  validateNonNegativeInteger(symbol.startColumn, 'Symbol startColumn');

  validateNonNegativeInteger(symbol.endColumn, 'Symbol endColumn');

  if (symbol.endLine < symbol.startLine) {
    throw new Error(`Symbol "${symbol.qualifiedName}" ends before it starts`);
  }

  if (symbol.endLine === symbol.startLine && symbol.endColumn < symbol.startColumn) {
    throw new Error(`Symbol "${symbol.qualifiedName}" ends before it starts`);
  }

  if (
    symbol.complexity !== undefined &&
    (!Number.isInteger(symbol.complexity) || symbol.complexity < 1)
  ) {
    throw new Error(`Symbol "${symbol.qualifiedName}" complexity must be a positive integer`);
  }
}

function validateSymbols(
  inputs: readonly PersistAnalysisSymbolInput[],
  fileIdByPath: FileIdByPath,
): void {
  const keys = new Set<string>();

  for (const symbol of inputs) {
    validateSymbol(symbol, fileIdByPath);

    const key = createPersistedSymbolKey(symbol);

    if (keys.has(key)) {
      throw new Error(
        `Duplicate symbol persistence identity for "${symbol.qualifiedName}" in "${symbol.filePath}"`,
      );
    }

    keys.add(key);
  }
}

export async function persistAnalysisSymbols(
  transaction: DatabaseTransaction,
  inputs: readonly PersistAnalysisSymbolInput[],
  fileIdByPath: FileIdByPath,
): Promise<SymbolIdByKey> {
  /*
   * Validate the complete batch before writing anything.
   *
   * That means malformed parser output cannot result in
   * a partially inserted symbols batch.
   */
  validateSymbols(inputs, fileIdByPath);

  if (inputs.length === 0) {
    return new Map();
  }

  const filePathById = new Map<string, string>();

  for (const [filePath, fileId] of fileIdByPath) {
    filePathById.set(fileId, filePath);
  }

  const rows = inputs
    .map((symbol) => ({
      fileId: requireFileId(fileIdByPath, symbol.filePath),

      kind: symbol.kind,

      name: symbol.name,

      qualifiedName: symbol.qualifiedName,

      startLine: symbol.startLine,

      startColumn: symbol.startColumn,

      endLine: symbol.endLine,

      endColumn: symbol.endColumn,

      isExported: symbol.isExported ?? false,

      complexity: symbol.complexity ?? null,
    }))
    .sort(
      (left, right) =>
        left.fileId.localeCompare(right.fileId) ||
        left.kind.localeCompare(right.kind) ||
        left.qualifiedName.localeCompare(right.qualifiedName) ||
        left.startLine - right.startLine,
    );

  const insertedRows = await transaction.insert(symbols).values(rows).returning({
    id: symbols.id,

    fileId: symbols.fileId,

    kind: symbols.kind,

    qualifiedName: symbols.qualifiedName,

    startLine: symbols.startLine,
  });

  if (insertedRows.length !== inputs.length) {
    throw new Error(
      `Expected PostgreSQL to insert ${inputs.length} symbols but received ${insertedRows.length}`,
    );
  }

  const symbolIdByKey = new Map<string, string>();

  for (const row of insertedRows) {
    const filePath = filePathById.get(row.fileId);

    if (filePath === undefined) {
      throw new Error(`PostgreSQL returned a symbol for unknown file ID "${row.fileId}"`);
    }

    const key = createPersistedSymbolKey({
      filePath,

      kind: row.kind,

      qualifiedName: row.qualifiedName,

      startLine: row.startLine,
    });

    if (symbolIdByKey.has(key)) {
      throw new Error(`PostgreSQL returned duplicate symbol identity "${key}"`);
    }

    symbolIdByKey.set(key, row.id);
  }

  return symbolIdByKey;
}
