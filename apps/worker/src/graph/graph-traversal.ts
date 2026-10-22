import { FileGraphIndex } from './file-graph-index.js';

import type { FileDependencyGraph } from './types.js';

export interface ReachableFile {
  nodeId: string;

  /*
   * Number of dependency hops from the
   * starting file.
   *
   * Example:
   *
   * app.ts → service.ts → db.ts
   *
   * from app.ts:
   *
   * service.ts = distance 1
   * db.ts      = distance 2
   */
  distance: number;
}

export interface GraphTraversalOptions {
  /*
   * Optional maximum number of graph hops.
   *
   * undefined means:
   *
   * traverse the full reachable graph.
   */
  maxDepth?: number;
}

type TraversalDirection = 'dependencies' | 'dependents';

interface QueueEntry {
  nodeId: string;

  distance: number;
}

function validateMaxDepth(maxDepth: number | undefined): void {
  if (maxDepth === undefined) {
    return;
  }

  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error('Graph traversal maxDepth must be a non-negative integer.');
  }
}

function getNeighborIds(
  graphIndex: FileGraphIndex,

  nodeId: string,

  direction: TraversalDirection,
): string[] {
  if (direction === 'dependencies') {
    return graphIndex.getOutgoingNeighborIds(nodeId);
  }

  return graphIndex.getIncomingNeighborIds(nodeId);
}

function traverse(
  graph: FileDependencyGraph,

  startNodeId: string,

  direction: TraversalDirection,

  options: GraphTraversalOptions = {},
): ReachableFile[] {
  validateMaxDepth(options.maxDepth);

  const graphIndex = new FileGraphIndex(graph);

  if (!graphIndex.hasNode(startNodeId)) {
    throw new Error(`Graph traversal start node does not exist: ${startNodeId}`);
  }

  const visited = new Set<string>([startNodeId]);

  const queue: QueueEntry[] = [
    {
      nodeId: startNodeId,

      distance: 0,
    },
  ];

  const reachable: ReachableFile[] = [];

  /*
   * Use a queue cursor instead of shift().
   *
   * shift() repeatedly moves array elements and
   * becomes inefficient for large repositories.
   */
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];

    queueIndex += 1;

    if (!current) {
      continue;
    }

    if (options.maxDepth !== undefined && current.distance >= options.maxDepth) {
      continue;
    }

    const neighborIds = getNeighborIds(graphIndex, current.nodeId, direction);

    for (const neighborId of neighborIds) {
      /*
       * This prevents infinite traversal when
       * the repository contains dependency
       * cycles.
       */
      if (visited.has(neighborId)) {
        continue;
      }

      visited.add(neighborId);

      const distance = current.distance + 1;

      reachable.push({
        nodeId: neighborId,

        distance,
      });

      queue.push({
        nodeId: neighborId,

        distance,
      });
    }
  }

  /*
   * BFS already discovers shortest distance,
   * but sorting guarantees deterministic output
   * even if graph construction changes later.
   */
  return reachable.sort((left, right) => {
    const distanceOrder = left.distance - right.distance;

    if (distanceOrder !== 0) {
      return distanceOrder;
    }

    return left.nodeId.localeCompare(right.nodeId);
  });
}

export function getTransitiveDependencies(
  graph: FileDependencyGraph,

  startNodeId: string,

  options: GraphTraversalOptions = {},
): ReachableFile[] {
  return traverse(graph, startNodeId, 'dependencies', options);
}

export function getTransitiveDependents(
  graph: FileDependencyGraph,

  startNodeId: string,

  options: GraphTraversalOptions = {},
): ReachableFile[] {
  return traverse(graph, startNodeId, 'dependents', options);
}
