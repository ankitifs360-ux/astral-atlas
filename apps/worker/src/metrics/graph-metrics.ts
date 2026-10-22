import type { FileDependencyCycle } from '../graph/cycle-detector.js';

import type { FileGraphIndex } from '../graph/file-graph-index.js';

import type { FileBlastRadiusMetrics, FileCycleMetrics, FileDependencyMetrics } from './types.js';

export interface FileGraphMetrics {
  filePath: string;

  dependencies: FileDependencyMetrics;

  blastRadius: FileBlastRadiusMetrics;

  cycles: FileCycleMetrics;
}

interface TraversalSummary {
  reachableCount: number;

  maxDistance: number;
}

type TraversalDirection = 'dependencies' | 'dependents';

interface QueueEntry {
  nodeId: string;

  distance: number;
}

function traverseGraph(
  graphIndex: FileGraphIndex,

  startNodeId: string,

  direction: TraversalDirection,
): TraversalSummary {
  const visited = new Set<string>([startNodeId]);

  const queue: QueueEntry[] = [
    {
      nodeId: startNodeId,

      distance: 0,
    },
  ];

  let queueIndex = 0;

  let reachableCount = 0;

  let maxDistance = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];

    queueIndex += 1;

    if (!current) {
      continue;
    }

    const neighborIds =
      direction === 'dependencies'
        ? graphIndex.getOutgoingNeighborIds(current.nodeId)
        : graphIndex.getIncomingNeighborIds(current.nodeId);

    for (const neighborId of neighborIds) {
      if (visited.has(neighborId)) {
        continue;
      }

      visited.add(neighborId);

      const distance = current.distance + 1;

      reachableCount += 1;

      maxDistance = Math.max(maxDistance, distance);

      queue.push({
        nodeId: neighborId,

        distance,
      });
    }
  }

  return {
    reachableCount,
    maxDistance,
  };
}

function createCycleLookup(
  cycles: readonly FileDependencyCycle[],
): Map<string, FileDependencyCycle> {
  const cycleByNode = new Map<string, FileDependencyCycle>();

  for (const cycle of cycles) {
    for (const nodeId of cycle.nodeIds) {
      /*
       * Strongly connected components are
       * disjoint, so one node should never
       * belong to multiple dependency-cycle
       * components.
       */
      if (cycleByNode.has(nodeId)) {
        throw new Error(`File belongs to multiple dependency cycles: ${nodeId}`);
      }

      cycleByNode.set(nodeId, cycle);
    }
  }

  return cycleByNode;
}

export function calculateFileGraphMetrics(
  graphIndex: FileGraphIndex,

  cycles: readonly FileDependencyCycle[],

  filePaths: readonly string[],
): FileGraphMetrics[] {
  const cycleByNode = createCycleLookup(cycles);

  const uniqueFilePaths = [...new Set(filePaths)].sort();

  const results: FileGraphMetrics[] = [];

  for (const filePath of uniqueFilePaths) {
    if (!graphIndex.hasNode(filePath)) {
      throw new Error(`Cannot calculate graph metrics for missing file node: ${filePath}`);
    }

    /*
     * Direct graph metrics.
     *
     * We intentionally count unique neighbors,
     * not raw edges.
     *
     * If app.ts imports service.ts twice:
     *
     * fanOut is still 1, because app.ts depends
     * on one unique internal file.
     */
    const fanIn = graphIndex.getIncomingNeighborCount(filePath);

    const fanOut = graphIndex.getOutgoingNeighborCount(filePath);

    /*
     * Follow outgoing edges:
     *
     * "What does this file depend on?"
     */
    const dependencyTraversal = traverseGraph(graphIndex, filePath, 'dependencies');

    /*
     * Follow incoming edges:
     *
     * "What could be affected if this
     * file changes?"
     */
    const dependentTraversal = traverseGraph(graphIndex, filePath, 'dependents');

    const cycle = cycleByNode.get(filePath);

    results.push({
      filePath,

      dependencies: {
        fanIn,
        fanOut,

        transitiveDependencyCount: dependencyTraversal.reachableCount,
      },

      blastRadius: {
        affectedFileCount: dependentTraversal.reachableCount,

        maxDistance: dependentTraversal.maxDistance,
      },

      cycles: {
        inDependencyCycle: cycle !== undefined,

        cyclicComponentSize: cycle?.nodeIds.length ?? 0,
      },
    });
  }

  return results;
}
