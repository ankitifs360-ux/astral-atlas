import { createHash } from 'node:crypto';

import { FileGraphIndex } from './file-graph-index.js';

import type { FileDependencyGraph } from './types.js';

export interface FileDependencyCycle {
  /*
   * Stable identifier for the cyclic component.
   */
  id: string;

  /*
   * Repository files participating in the
   * dependency cycle.
   *
   * Sorted for deterministic output.
   */
  nodeIds: string[];

  /*
   * All graph edges whose source and target are
   * both inside this cyclic component.
   */
  edgeIds: string[];
}

function createCycleId(nodeIds: readonly string[]): string {
  const hash = createHash('sha256').update(nodeIds.join('\0')).digest('hex').slice(0, 24);

  return `cycle:${hash}`;
}

function isCyclicComponent(
  graphIndex: FileGraphIndex,

  nodeIds: readonly string[],
): boolean {
  /*
   * Any strongly connected component containing
   * multiple nodes necessarily contains a cycle.
   */
  if (nodeIds.length > 1) {
    return true;
  }

  const nodeId = nodeIds[0];

  if (!nodeId) {
    return false;
  }

  /*
   * A one-node SCC is only cyclic if it has a
   * self-loop:
   *
   * app.ts ──imports──> app.ts
   */
  return graphIndex.getOutgoingEdges(nodeId).some((edge) => edge.target === nodeId);
}

function collectInternalEdgeIds(
  graphIndex: FileGraphIndex,

  nodeIds: readonly string[],
): string[] {
  const nodeSet = new Set(nodeIds);

  const edgeIds = new Set<string>();

  for (const nodeId of nodeIds) {
    for (const edge of graphIndex.getOutgoingEdges(nodeId)) {
      if (nodeSet.has(edge.target)) {
        edgeIds.add(edge.id);
      }
    }
  }

  return [...edgeIds].sort();
}

export function detectDependencyCycles(graph: FileDependencyGraph): FileDependencyCycle[] {
  const graphIndex = new FileGraphIndex(graph);

  /*
   * Tarjan's strongly connected components
   * algorithm.
   *
   * Each node gets:
   *
   * index   → discovery order
   * lowLink → earliest reachable node still
   *           inside the current DFS stack
   */
  const discoveryIndex = new Map<string, number>();

  const lowLink = new Map<string, number>();

  const stack: string[] = [];

  const onStack = new Set<string>();

  const components: string[][] = [];

  let nextIndex = 0;

  function strongConnect(nodeId: string): void {
    const currentIndex = nextIndex;

    nextIndex += 1;

    discoveryIndex.set(nodeId, currentIndex);

    lowLink.set(nodeId, currentIndex);

    stack.push(nodeId);

    onStack.add(nodeId);

    for (const neighborId of graphIndex.getOutgoingNeighborIds(nodeId)) {
      if (!discoveryIndex.has(neighborId)) {
        strongConnect(neighborId);

        const currentLowLink = lowLink.get(nodeId);

        const neighborLowLink = lowLink.get(neighborId);

        if (currentLowLink === undefined || neighborLowLink === undefined) {
          throw new Error('Cycle detector entered an invalid Tarjan state.');
        }

        lowLink.set(nodeId, Math.min(currentLowLink, neighborLowLink));
      } else if (onStack.has(neighborId)) {
        const currentLowLink = lowLink.get(nodeId);

        const neighborIndex = discoveryIndex.get(neighborId);

        if (currentLowLink === undefined || neighborIndex === undefined) {
          throw new Error('Cycle detector entered an invalid Tarjan state.');
        }

        lowLink.set(nodeId, Math.min(currentLowLink, neighborIndex));
      }
    }

    const nodeLowLink = lowLink.get(nodeId);

    const nodeIndex = discoveryIndex.get(nodeId);

    if (nodeLowLink === undefined || nodeIndex === undefined) {
      throw new Error('Cycle detector entered an invalid Tarjan state.');
    }

    /*
     * If this node is the root of an SCC,
     * pop nodes until we return to it.
     */
    if (nodeLowLink === nodeIndex) {
      const component: string[] = [];

      while (stack.length > 0) {
        const member = stack.pop();

        if (member === undefined) {
          break;
        }

        onStack.delete(member);

        component.push(member);

        if (member === nodeId) {
          break;
        }
      }

      component.sort();

      components.push(component);
    }
  }

  /*
   * Sort traversal order so identical graphs
   * produce identical SCC output.
   */
  const nodeIds = graph.nodes.map((node) => node.id).sort();

  for (const nodeId of nodeIds) {
    if (!discoveryIndex.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  const cycles: FileDependencyCycle[] = [];

  for (const component of components) {
    if (!isCyclicComponent(graphIndex, component)) {
      continue;
    }

    cycles.push({
      id: createCycleId(component),

      nodeIds: component,

      edgeIds: collectInternalEdgeIds(graphIndex, component),
    });
  }

  return cycles.sort((left, right) =>
    left.nodeIds.join('\0').localeCompare(right.nodeIds.join('\0')),
  );
}
