import { createHash } from 'node:crypto';

import type { ParsedFunction } from '../parsing/types.js';

/**
 * Creates a deterministic ID for a parsed function.
 *
 * The same function at the same repository commit
 * should produce the same ID every time analysis runs.
 *
 * Source location is included because:
 *
 * - multiple functions can share the same name
 * - anonymous functions have a null name
 * - methods with the same name can exist in different classes
 */
export function createFunctionNodeId(filePath: string, functionNode: ParsedFunction): string {
  const raw = [
    filePath,
    functionNode.name ?? '',
    String(functionNode.range.start.row),
    String(functionNode.range.start.column),
    String(functionNode.range.end.row),
    String(functionNode.range.end.column),
  ].join('\0');

  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 24);

  return `function:${hash}`;
}
