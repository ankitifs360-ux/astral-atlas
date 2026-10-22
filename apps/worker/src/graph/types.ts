import type { SourceRange, SupportedLanguage } from '../parsing/types.js';

export type GraphNodeKind = 'file';

export type GraphEdgeKind = 'imports';

export interface FileGraphNode {
  /*
   * Stable node identifier.
   *
   * For file-level graph nodes we use the
   * normalized repository-relative path.
   *
   * Example:
   *
   * src/app.ts
   */
  id: string;

  kind: GraphNodeKind;

  filePath: string;

  language: SupportedLanguage;

  hasSyntaxErrors: boolean;
}

export interface FileGraphEdge {
  /*
   * Stable edge identifier.
   *
   * The graph builder will generate this
   * deterministically from source, target,
   * specifier, and source range.
   */
  id: string;

  kind: GraphEdgeKind;

  /*
   * Directed dependency:
   *
   * src/app.ts
   *      ↓ imports
   * src/service.ts
   */
  source: string;

  target: string;

  /*
   * Original import text.
   *
   * Example:
   *
   * ./service.js
   */
  specifier: string;

  range: SourceRange;
}

export interface FileDependencyGraph {
  nodes: FileGraphNode[];

  edges: FileGraphEdge[];
}
