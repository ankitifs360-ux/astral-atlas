import { edges } from '@astral-atlas/database';

import type { ParsedFunction } from '../parsing/types.js';

import type { ResolvedCall } from '../resolution/types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

import { createPersistedSymbolKey, type SymbolIdByKey } from './symbol-persistence.js';

interface CollapsedFunctionCallEdge {
  fromFileId: string;
  toFileId: string;
  fromSymbolId: string;
  toSymbolId: string;
  weight: number;
}

function requireFileId(fileIdByPath: FileIdByPath, filePath: string): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Function call edge references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function createFunctionSymbolKey(filePath: string, functionNode: ParsedFunction): string | null {
  const name = functionNode.name?.trim();

  /*
   * Anonymous functions are intentionally not persisted
   * as symbols by createPersistenceSymbols().
   *
   * Therefore they cannot participate in persisted
   * symbol-to-symbol call edges.
   */
  if (name === undefined || name.length === 0) {
    return null;
  }

  return createPersistedSymbolKey({
    filePath,

    kind: 'function',

    qualifiedName: name,

    /*
     * Tree-sitter rows are zero-based while persisted
     * symbol lines are one-based.
     *
     * This must stay identical to createPersistenceSymbols().
     */
    startLine: functionNode.range.start.row + 1,
  });
}

function requireSymbolId(symbolIdByKey: SymbolIdByKey, key: string): string {
  const symbolId = symbolIdByKey.get(key);

  if (symbolId === undefined) {
    throw new Error(`Function call edge references unknown persisted symbol "${key}"`);
  }

  return symbolId;
}

function collapseResolvedCalls(
  calls: readonly ResolvedCall[],
  fileIdByPath: FileIdByPath,
  symbolIdByKey: SymbolIdByKey,
): CollapsedFunctionCallEdge[] {
  const collapsed = new Map<string, CollapsedFunctionCallEdge>();

  for (const call of calls) {
    /*
     * Only proven repository-internal calls can become
     * persisted symbol-to-symbol edges.
     */
    if (call.kind !== 'internal' || call.targetFilePath === null || call.targetFunction === null) {
      continue;
    }

    const sourceSymbolKey = createFunctionSymbolKey(call.sourceFilePath, call.sourceFunction);

    const targetSymbolKey = createFunctionSymbolKey(call.targetFilePath, call.targetFunction);

    /*
     * Anonymous functions are not currently persisted as
     * symbols, so we safely omit those call edges rather
     * than inventing an unstable database identity.
     */
    if (sourceSymbolKey === null || targetSymbolKey === null) {
      continue;
    }

    const fromFileId = requireFileId(fileIdByPath, call.sourceFilePath);

    const toFileId = requireFileId(fileIdByPath, call.targetFilePath);

    const fromSymbolId = requireSymbolId(symbolIdByKey, sourceSymbolKey);

    const toSymbolId = requireSymbolId(symbolIdByKey, targetSymbolKey);

    /*
     * PostgreSQL stores one logical edge between the same
     * caller and callee symbols.
     *
     * Multiple call sites are represented by `weight`.
     */
    const identity = JSON.stringify([fromFileId, toFileId, fromSymbolId, toSymbolId]);

    const existing = collapsed.get(identity);

    if (existing) {
      existing.weight += 1;

      continue;
    }

    collapsed.set(identity, {
      fromFileId,

      toFileId,

      fromSymbolId,

      toSymbolId,

      weight: 1,
    });
  }

  return [...collapsed.values()];
}

export async function persistFunctionCallEdges(
  transaction: DatabaseTransaction,
  analysisId: string,
  calls: readonly ResolvedCall[],
  fileIdByPath: FileIdByPath,
  symbolIdByKey: SymbolIdByKey,
): Promise<number> {
  const collapsedEdges = collapseResolvedCalls(calls, fileIdByPath, symbolIdByKey);

  if (collapsedEdges.length === 0) {
    return 0;
  }

  const rows = collapsedEdges
    .map((edge) => ({
      analysisId,

      fromFileId: edge.fromFileId,

      toFileId: edge.toFileId,

      fromSymbolId: edge.fromSymbolId,

      toSymbolId: edge.toSymbolId,

      type: 'call' as const,

      weight: edge.weight,

      isDynamic: false,
    }))
    .sort(
      (left, right) =>
        left.fromFileId.localeCompare(right.fromFileId) ||
        left.toFileId.localeCompare(right.toFileId) ||
        left.fromSymbolId.localeCompare(right.fromSymbolId) ||
        left.toSymbolId.localeCompare(right.toSymbolId),
    );

  await transaction.insert(edges).values(rows);

  return rows.length;
}
