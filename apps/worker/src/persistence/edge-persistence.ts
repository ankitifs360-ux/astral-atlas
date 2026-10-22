import { edges } from '@astral-atlas/database';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

interface CollapsedImportEdge {
  source: string;
  target: string;
  weight: number;
}

function requireFileId(fileIdByPath: FileIdByPath, filePath: string): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Graph edge references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function collapseImportEdges(graphAnalysis: RepositoryGraphAnalysis): CollapsedImportEdge[] {
  const collapsed = new Map<string, CollapsedImportEdge>();

  for (const edge of graphAnalysis.graph.edges) {
    /*
     * File paths cannot contain NUL characters, so this
     * gives us an unambiguous source/target composite key.
     */
    const key = `${edge.source}\0${edge.target}`;

    const existing = collapsed.get(key);

    if (existing === undefined) {
      collapsed.set(key, {
        source: edge.source,
        target: edge.target,
        weight: 1,
      });

      continue;
    }

    existing.weight += 1;
  }

  return [...collapsed.values()];
}

function validateGraphEdges(
  collapsedEdges: readonly CollapsedImportEdge[],
  fileIdByPath: FileIdByPath,
): void {
  for (const edge of collapsedEdges) {
    requireFileId(fileIdByPath, edge.source);
    requireFileId(fileIdByPath, edge.target);

    if (!Number.isInteger(edge.weight) || edge.weight < 1) {
      throw new Error(
        `Graph edge weight must be a positive integer for "${edge.source}" -> "${edge.target}"`,
      );
    }
  }
}

export async function persistGraphEdges(
  transaction: DatabaseTransaction,
  analysisId: string,
  graphAnalysis: RepositoryGraphAnalysis,
  fileIdByPath: FileIdByPath,
): Promise<number> {
  /*
   * Multiple import statements can connect the same two
   * files. The database stores that relationship once and
   * represents multiplicity with `weight`.
   */
  const collapsedEdges = collapseImportEdges(graphAnalysis);

  /*
   * Validate the complete batch before any insert starts.
   */
  validateGraphEdges(collapsedEdges, fileIdByPath);

  if (collapsedEdges.length === 0) {
    return 0;
  }

  const rows = collapsedEdges
    .map((edge) => ({
      analysisId,

      fromFileId: requireFileId(fileIdByPath, edge.source),

      toFileId: requireFileId(fileIdByPath, edge.target),

      fromSymbolId: null,

      toSymbolId: null,

      type: 'import' as const,

      weight: edge.weight,

      isDynamic: false,
    }))
    .sort((left, right) => {
      const sourceOrder = left.fromFileId.localeCompare(right.fromFileId);

      if (sourceOrder !== 0) {
        return sourceOrder;
      }

      return left.toFileId.localeCompare(right.toFileId);
    });

  await transaction.insert(edges).values(rows);

  return rows.length;
}
