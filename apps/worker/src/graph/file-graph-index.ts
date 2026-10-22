import type { FileDependencyGraph, FileGraphEdge, FileGraphNode } from './types.js';

function createNeighborIds(
  edges: readonly FileGraphEdge[],

  direction: 'incoming' | 'outgoing',
): string[] {
  const ids = new Set<string>();

  for (const edge of edges) {
    ids.add(direction === 'outgoing' ? edge.target : edge.source);
  }

  return [...ids].sort();
}

export class FileGraphIndex {
  private readonly nodesById = new Map<string, FileGraphNode>();

  private readonly outgoingByNode = new Map<string, FileGraphEdge[]>();

  private readonly incomingByNode = new Map<string, FileGraphEdge[]>();

  public constructor(graph: FileDependencyGraph) {
    for (const node of graph.nodes) {
      if (this.nodesById.has(node.id)) {
        throw new Error(`Duplicate graph node id: ${node.id}`);
      }

      this.nodesById.set(node.id, node);

      this.outgoingByNode.set(node.id, []);

      this.incomingByNode.set(node.id, []);
    }

    const edgeIds = new Set<string>();

    for (const edge of graph.edges) {
      if (edgeIds.has(edge.id)) {
        throw new Error(`Duplicate graph edge id: ${edge.id}`);
      }

      edgeIds.add(edge.id);

      const outgoing = this.outgoingByNode.get(edge.source);

      if (!outgoing) {
        throw new Error(`Graph edge source node does not exist: ${edge.source}`);
      }

      const incoming = this.incomingByNode.get(edge.target);

      if (!incoming) {
        throw new Error(`Graph edge target node does not exist: ${edge.target}`);
      }

      outgoing.push(edge);

      incoming.push(edge);
    }

    /*
     * Keep lookup results deterministic even
     * if a graph was constructed manually in
     * an arbitrary edge order.
     */
    for (const edges of this.outgoingByNode.values()) {
      edges.sort((left, right) => left.id.localeCompare(right.id));
    }

    for (const edges of this.incomingByNode.values()) {
      edges.sort((left, right) => left.id.localeCompare(right.id));
    }
  }

  public get size(): number {
    return this.nodesById.size;
  }

  public hasNode(nodeId: string): boolean {
    return this.nodesById.has(nodeId);
  }

  public getNode(nodeId: string): FileGraphNode | null {
    return this.nodesById.get(nodeId) ?? null;
  }

  public getOutgoingEdges(nodeId: string): readonly FileGraphEdge[] {
    return this.outgoingByNode.get(nodeId) ?? [];
  }

  public getIncomingEdges(nodeId: string): readonly FileGraphEdge[] {
    return this.incomingByNode.get(nodeId) ?? [];
  }

  public getOutgoingNeighborIds(nodeId: string): string[] {
    return createNeighborIds(this.getOutgoingEdges(nodeId), 'outgoing');
  }

  public getIncomingNeighborIds(nodeId: string): string[] {
    return createNeighborIds(this.getIncomingEdges(nodeId), 'incoming');
  }

  public getOutgoingEdgeCount(nodeId: string): number {
    return this.getOutgoingEdges(nodeId).length;
  }

  public getIncomingEdgeCount(nodeId: string): number {
    return this.getIncomingEdges(nodeId).length;
  }

  public getOutgoingNeighborCount(nodeId: string): number {
    return this.getOutgoingNeighborIds(nodeId).length;
  }

  public getIncomingNeighborCount(nodeId: string): number {
    return this.getIncomingNeighborIds(nodeId).length;
  }
}
