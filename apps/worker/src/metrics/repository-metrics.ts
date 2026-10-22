import { calculateFileGraphMetrics } from './graph-metrics.js';

import { calculateFileStructureMetrics } from './structure-metrics.js';

import { calculateFileChurnMetrics } from './churn-metrics.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { FileMetrics, RepositoryMetrics } from './types.js';

import type { FileStructureMetricInput } from './structure-metrics.js';

import type { FileChurnInput } from './churn-metrics.js';

export interface RepositoryMetricsInput {
  graphAnalysis: RepositoryGraphAnalysis;

  structureInputs: readonly FileStructureMetricInput[];

  /*
   * undefined means Git history was not
   * available for this analysis.
   *
   * This commonly happens for ZIP uploads.
   *
   * An empty array means Git history WAS
   * available, but none of the analyzed files
   * were touched in the history window.
   */
  churnInputs?: readonly FileChurnInput[];
}

export function calculateRepositoryMetrics(input: RepositoryMetricsInput): RepositoryMetrics {
  const { graphAnalysis, structureInputs, churnInputs } = input;

  const filePaths = graphAnalysis.graph.nodes.map((node) => node.filePath).sort();

  /*
   * Calculate dependency-related metrics from
   * the graph produced in B7.
   */
  const graphMetrics = calculateFileGraphMetrics(
    graphAnalysis.graphIndex,
    graphAnalysis.cycles,
    filePaths,
  );

  /*
   * Calculate syntax/structure-related metrics
   * from parsed files + original source text.
   */
  const structureMetrics = calculateFileStructureMetrics(structureInputs);

  const structureByFile = new Map(
    structureMetrics.map((metric) => [metric.filePath, metric.structure] as const),
  );

  const graphFileSet = new Set(filePaths);

  /*
   * Protect against accidentally combining
   * structure information from another
   * repository or analysis.
   */
  for (const structureMetric of structureMetrics) {
    if (!graphFileSet.has(structureMetric.filePath)) {
      throw new Error(
        `Structure metrics contain file not present in dependency graph: ${structureMetric.filePath}`,
      );
    }
  }

  /*
   * Git history is considered available when
   * churnInputs was supplied.
   *
   * Important:
   *
   * undefined
   *   → history unavailable
   *
   * []
   *   → history available, but no files changed
   */
  const historyAvailable = churnInputs !== undefined;

  const churnMetrics = historyAvailable ? calculateFileChurnMetrics(churnInputs) : [];

  const churnByFile = new Map(churnMetrics.map((metric) => [metric.filePath, metric] as const));

  /*
   * Churn information must belong to files in
   * the same dependency graph.
   */
  for (const churnMetric of churnMetrics) {
    if (!graphFileSet.has(churnMetric.filePath)) {
      throw new Error(
        `Git churn contains file not present in dependency graph: ${churnMetric.filePath}`,
      );
    }
  }

  const files: FileMetrics[] = [];

  for (const graphMetric of graphMetrics) {
    const structure = structureByFile.get(graphMetric.filePath);

    if (!structure) {
      throw new Error(`Missing structure metrics for graph file: ${graphMetric.filePath}`);
    }

    /*
     * If history is available but this file is
     * absent from churnInputs, that means it was
     * not touched during the analyzed history
     * window.
     *
     * Therefore its churn is zero.
     */
    const churnMetric = churnByFile.get(graphMetric.filePath);

    const churn = historyAvailable
      ? {
          changedCommitCount: churnMetric?.changedCommitCount ?? 0,
        }
      : null;

    files.push({
      filePath: graphMetric.filePath,

      dependencies: graphMetric.dependencies,

      blastRadius: graphMetric.blastRadius,

      cycles: graphMetric.cycles,

      structure,

      churn,
    });
  }

  /*
   * Import-resolution summary.
   *
   * Internal imports are represented by graph
   * edges, while external and unresolved imports
   * remain available through resolvedImports.
   */
  let externalImportCount = 0;

  let unresolvedImportCount = 0;

  for (const resolvedImport of graphAnalysis.resolvedImports) {
    if (resolvedImport.kind === 'external') {
      externalImportCount += 1;
    } else if (resolvedImport.kind === 'unresolved') {
      unresolvedImportCount += 1;
    }
  }

  /*
   * SCCs are disjoint, but use a Set anyway so
   * this remains defensive if cycle information
   * is ever constructed outside our detector.
   */
  const cyclicFiles = new Set<string>();

  for (const cycle of graphAnalysis.cycles) {
    for (const nodeId of cycle.nodeIds) {
      cyclicFiles.add(nodeId);
    }
  }

  let totalCyclomaticComplexity = 0;

  let maxCyclomaticComplexity = 0;

  for (const file of files) {
    const complexity = file.structure.cyclomaticComplexity;

    totalCyclomaticComplexity += complexity;

    maxCyclomaticComplexity = Math.max(maxCyclomaticComplexity, complexity);
  }

  const fileCount = files.length;

  const averageCyclomaticComplexity = fileCount === 0 ? 0 : totalCyclomaticComplexity / fileCount;

  /*
   * Churn aggregation.
   *
   * These values remain null when history is
   * unavailable. We should never pretend that
   * unknown history means zero churn.
   */
  let totalChangedCommitCount: number | null = null;

  let averageChangedCommitCount: number | null = null;

  let maxChangedCommitCount: number | null = null;

  if (historyAvailable) {
    totalChangedCommitCount = 0;

    maxChangedCommitCount = 0;

    for (const file of files) {
      const changedCommitCount = file.churn?.changedCommitCount ?? 0;

      totalChangedCommitCount += changedCommitCount;

      maxChangedCommitCount = Math.max(maxChangedCommitCount, changedCommitCount);
    }

    averageChangedCommitCount = fileCount === 0 ? 0 : totalChangedCommitCount / fileCount;
  }

  return {
    summary: {
      fileCount,

      internalDependencyCount: graphAnalysis.graph.edges.length,

      externalImportCount,

      unresolvedImportCount,

      cyclicComponentCount: graphAnalysis.cycles.length,

      cyclicFileCount: cyclicFiles.size,

      totalCyclomaticComplexity,

      averageCyclomaticComplexity,

      maxCyclomaticComplexity,

      historyAvailable,

      totalChangedCommitCount,

      averageChangedCommitCount,

      maxChangedCommitCount,
    },

    files,
  };
}
