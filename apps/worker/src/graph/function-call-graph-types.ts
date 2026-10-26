import type { SourceRange, SupportedLanguage } from '../parsing/types.js';

/**
 * A function-level node in the repository call graph.
 *
 * The ID must be stable for the same source file and
 * function location at the same repository commit.
 */
export interface FunctionCallGraphNode {
  id: string;

  kind: 'function';

  filePath: string;

  language: SupportedLanguage;

  name: string | null;

  range: SourceRange;

  async: boolean;

  isExported: boolean;
}

/**
 * A source-level function call made by one known
 * function.
 *
 * At this stage the callee is still the raw source-level
 * name, such as:
 *
 * saveUser
 * userService.save
 *
 * A later resolution stage will determine whether that
 * callee maps to an actual repository function.
 */
export interface FunctionCallGraphEdge {
  id: string;

  kind: 'calls';

  source: string;

  callee: string;

  range: SourceRange;
}

export interface FunctionCallGraph {
  nodes: FunctionCallGraphNode[];

  edges: FunctionCallGraphEdge[];
}
