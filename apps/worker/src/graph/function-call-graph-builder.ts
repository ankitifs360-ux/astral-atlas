import { createHash } from 'node:crypto';

import { assignCallOwners } from '../parsing/call-owner-resolver.js';

import type { ParseSourceResult, SourceRange } from '../parsing/types.js';

import { createFunctionNodeId } from './function-call-graph-id.js';

import type {
  FunctionCallGraph,
  FunctionCallGraphEdge,
  FunctionCallGraphNode,
} from './function-call-graph-types.js';

function createCallEdgeId(source: string, callee: string, range: SourceRange): string {
  const raw = [
    source,
    callee,
    String(range.start.row),
    String(range.start.column),
    String(range.end.row),
    String(range.end.column),
  ].join('\0');

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 24);

  return `call-edge:${hash}`;
}

function createNodes(parsedFiles: readonly ParseSourceResult[]): FunctionCallGraphNode[] {
  const nodes: FunctionCallGraphNode[] = [];

  for (const parsedFile of parsedFiles) {
    for (const functionNode of parsedFile.functions) {
      nodes.push({
        id: createFunctionNodeId(parsedFile.filePath, functionNode),

        kind: 'function',

        filePath: parsedFile.filePath,

        language: parsedFile.language,

        name: functionNode.name,

        range: functionNode.range,

        async: functionNode.async,

        isExported: functionNode.isExported,
      });
    }
  }

  return nodes.sort((left, right) => {
    const fileOrder = left.filePath.localeCompare(right.filePath);

    if (fileOrder !== 0) {
      return fileOrder;
    }

    const rowOrder = left.range.start.row - right.range.start.row;

    if (rowOrder !== 0) {
      return rowOrder;
    }

    const columnOrder = left.range.start.column - right.range.start.column;

    if (columnOrder !== 0) {
      return columnOrder;
    }

    return left.id.localeCompare(right.id);
  });
}

function createEdges(parsedFiles: readonly ParseSourceResult[]): FunctionCallGraphEdge[] {
  const edges: FunctionCallGraphEdge[] = [];

  for (const parsedFile of parsedFiles) {
    const ownedCalls = assignCallOwners(parsedFile.calls, parsedFile.functions);

    for (const ownedCall of ownedCalls) {
      if (!ownedCall.owner) {
        continue;
      }

      const source = createFunctionNodeId(parsedFile.filePath, ownedCall.owner);

      edges.push({
        id: createCallEdgeId(source, ownedCall.call.callee, ownedCall.call.range),

        kind: 'calls',

        source,

        callee: ownedCall.call.callee,

        range: ownedCall.call.range,
      });
    }
  }

  return edges.sort((left, right) => {
    const sourceOrder = left.source.localeCompare(right.source);

    if (sourceOrder !== 0) {
      return sourceOrder;
    }

    const rowOrder = left.range.start.row - right.range.start.row;

    if (rowOrder !== 0) {
      return rowOrder;
    }

    const columnOrder = left.range.start.column - right.range.start.column;

    if (columnOrder !== 0) {
      return columnOrder;
    }

    return left.callee.localeCompare(right.callee);
  });
}

export function buildFunctionCallGraph(
  parsedFiles: readonly ParseSourceResult[],
): FunctionCallGraph {
  return {
    nodes: createNodes(parsedFiles),

    edges: createEdges(parsedFiles),
  };
}
