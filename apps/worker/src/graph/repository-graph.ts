import { buildFileDependencyGraph } from './file-graph-builder.js';

import { detectDependencyCycles } from './cycle-detector.js';

import { FileGraphIndex } from './file-graph-index.js';

import { resolveRepositoryImports } from '../resolution/repository-import-resolver.js';

import type { ParseSourceResult } from '../parsing/types.js';

import type { ResolvedImport } from '../resolution/types.js';

import type { FileDependencyCycle } from './cycle-detector.js';

import type { FileDependencyGraph } from './types.js';

export interface RepositoryGraphAnalysis {
  graph: FileDependencyGraph;

  graphIndex: FileGraphIndex;

  resolvedImports: ResolvedImport[];

  cycles: FileDependencyCycle[];
}

export function buildRepositoryGraph(
  parsedFiles: readonly ParseSourceResult[],
): RepositoryGraphAnalysis {
  /*
   * B6:
   *
   * ParsedImport[]
   *      ↓
   * ResolvedImport[]
   */
  const resolution = resolveRepositoryImports(parsedFiles);

  /*
   * B7:
   *
   * parsed files
   * +
   * internal resolved imports
   *
   *      ↓
   *
   * nodes + directed edges
   */
  const graph = buildFileDependencyGraph(parsedFiles, resolution.imports);

  /*
   * Build once here so later B8 metrics can
   * reuse the same graph lookup structure.
   */
  const graphIndex = new FileGraphIndex(graph);

  /*
   * Detect dependency cycles immediately while
   * graph structure is available.
   */
  const cycles = detectDependencyCycles(graph);

  return {
    graph,
    graphIndex,

    resolvedImports: resolution.imports,

    cycles,
  };
}
