import { createHash } from 'node:crypto';

import type { ParseSourceResult } from '../parsing/types.js';

import type { ResolvedImport } from '../resolution/types.js';

import type { FileDependencyGraph, FileGraphEdge, FileGraphNode } from './types.js';

function createEdgeId(
  source: string,
  target: string,
  specifier: string,
  startRow: number,
  startColumn: number,
): string {
  /*
   * We want deterministic edge IDs.
   *
   * The same repository at the same commit
   * should produce the same graph IDs every
   * time.
   */
  const raw = [source, target, specifier, String(startRow), String(startColumn)].join('\0');

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 24);

  return `edge:${hash}`;
}

function createNodes(parsedFiles: readonly ParseSourceResult[]): FileGraphNode[] {
  return parsedFiles
    .map((file): FileGraphNode => ({
      /*
       * B6 already works with normalized
       * repository-relative paths.
       *
       * Using filePath directly as the node ID
       * keeps graph references readable and
       * deterministic.
       */
      id: file.filePath,

      kind: 'file',

      filePath: file.filePath,

      language: file.language,

      hasSyntaxErrors: file.hasSyntaxErrors,
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function createEdges(
  resolvedImports: readonly ResolvedImport[],

  nodeIds: ReadonlySet<string>,
): FileGraphEdge[] {
  const edges: FileGraphEdge[] = [];

  for (const resolvedImport of resolvedImports) {
    /*
     * B7 only creates repository dependency
     * edges for imports B6 proved are internal.
     */
    if (resolvedImport.kind !== 'internal' || resolvedImport.targetFilePath === null) {
      continue;
    }

    /*
     * Defensive consistency check:
     *
     * B6 may claim an internal target, but B7
     * should never emit an edge to a node that
     * does not actually exist in this graph.
     */
    if (
      !nodeIds.has(resolvedImport.sourceFilePath) ||
      !nodeIds.has(resolvedImport.targetFilePath)
    ) {
      continue;
    }

    const edge: FileGraphEdge = {
      id: createEdgeId(
        resolvedImport.sourceFilePath,
        resolvedImport.targetFilePath,
        resolvedImport.specifier,
        resolvedImport.range.start.row,
        resolvedImport.range.start.column,
      ),

      kind: 'imports',

      source: resolvedImport.sourceFilePath,

      target: resolvedImport.targetFilePath,

      specifier: resolvedImport.specifier,

      range: resolvedImport.range,
    };

    edges.push(edge);
  }

  /*
   * Keep output deterministic regardless of
   * the order upstream stages happened to
   * produce imports.
   */
  return edges.sort((left, right) => {
    const sourceOrder = left.source.localeCompare(right.source);

    if (sourceOrder !== 0) {
      return sourceOrder;
    }

    const targetOrder = left.target.localeCompare(right.target);

    if (targetOrder !== 0) {
      return targetOrder;
    }

    const rowOrder = left.range.start.row - right.range.start.row;

    if (rowOrder !== 0) {
      return rowOrder;
    }

    return left.range.start.column - right.range.start.column;
  });
}

export function buildFileDependencyGraph(
  parsedFiles: readonly ParseSourceResult[],

  resolvedImports: readonly ResolvedImport[],
): FileDependencyGraph {
  const nodes = createNodes(parsedFiles);

  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges = createEdges(resolvedImports, nodeIds);

  return {
    nodes,
    edges,
  };
}
