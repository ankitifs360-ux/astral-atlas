import { describe, expect, it } from 'vitest';

import { FileGraphIndex } from './file-graph-index.js';

import type { FileDependencyGraph, FileGraphEdge, FileGraphNode } from './types.js';

function createNode(id: string): FileGraphNode {
  return {
    id,

    kind: 'file',

    filePath: id,

    language: 'typescript',

    hasSyntaxErrors: false,
  };
}

function createEdge(id: string, source: string, target: string): FileGraphEdge {
  return {
    id,

    kind: 'imports',

    source,

    target,

    specifier: `./${target}`,

    range: {
      start: {
        row: 0,
        column: 0,
      },

      end: {
        row: 0,
        column: 10,
      },
    },
  };
}

function createGraph(): FileDependencyGraph {
  return {
    nodes: [createNode('src/app.ts'), createNode('src/service.ts'), createNode('src/db.ts')],

    edges: [
      createEdge('edge:b', 'src/app.ts', 'src/service.ts'),

      createEdge('edge:a', 'src/app.ts', 'src/service.ts'),

      createEdge('edge:c', 'src/service.ts', 'src/db.ts'),
    ],
  };
}

describe('FileGraphIndex', () => {
  it('stores graph nodes by id', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.size).toBe(3);

    expect(index.hasNode('src/app.ts')).toBe(true);

    expect(index.getNode('src/service.ts')).toMatchObject({
      id: 'src/service.ts',

      filePath: 'src/service.ts',
    });

    expect(index.getNode('src/missing.ts')).toBeNull();
  });

  it('returns outgoing edges in deterministic order', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.getOutgoingEdges('src/app.ts').map((edge) => edge.id)).toEqual([
      'edge:a',
      'edge:b',
    ]);
  });

  it('returns incoming edges in deterministic order', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.getIncomingEdges('src/service.ts').map((edge) => edge.id)).toEqual([
      'edge:a',
      'edge:b',
    ]);
  });

  it('returns unique outgoing neighbor ids', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.getOutgoingNeighborIds('src/app.ts')).toEqual(['src/service.ts']);
  });

  it('returns unique incoming neighbor ids', () => {
    const graph = createGraph();

    graph.edges.push(createEdge('edge:d', 'src/db.ts', 'src/service.ts'));

    const index = new FileGraphIndex(graph);

    expect(index.getIncomingNeighborIds('src/service.ts')).toEqual(['src/app.ts', 'src/db.ts']);
  });

  it('distinguishes edge count from unique neighbor count', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.getOutgoingEdgeCount('src/app.ts')).toBe(2);

    expect(index.getOutgoingNeighborCount('src/app.ts')).toBe(1);

    expect(index.getIncomingEdgeCount('src/service.ts')).toBe(2);

    expect(index.getIncomingNeighborCount('src/service.ts')).toBe(1);
  });

  it('returns empty lookups for unknown nodes', () => {
    const index = new FileGraphIndex(createGraph());

    expect(index.getOutgoingEdges('src/missing.ts')).toEqual([]);

    expect(index.getIncomingEdges('src/missing.ts')).toEqual([]);

    expect(index.getOutgoingNeighborIds('src/missing.ts')).toEqual([]);

    expect(index.getIncomingNeighborIds('src/missing.ts')).toEqual([]);

    expect(index.getOutgoingEdgeCount('src/missing.ts')).toBe(0);

    expect(index.getIncomingEdgeCount('src/missing.ts')).toBe(0);
  });

  it('rejects duplicate node ids', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('src/app.ts'), createNode('src/app.ts')],

      edges: [],
    };

    expect(() => new FileGraphIndex(graph)).toThrow('Duplicate graph node id: src/app.ts');
  });

  it('rejects duplicate edge ids', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('src/app.ts'), createNode('src/service.ts')],

      edges: [
        createEdge('edge:duplicate', 'src/app.ts', 'src/service.ts'),

        createEdge('edge:duplicate', 'src/app.ts', 'src/service.ts'),
      ],
    };

    expect(() => new FileGraphIndex(graph)).toThrow('Duplicate graph edge id: edge:duplicate');
  });

  it('rejects edges with missing source nodes', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('src/service.ts')],

      edges: [createEdge('edge:missing-source', 'src/app.ts', 'src/service.ts')],
    };

    expect(() => new FileGraphIndex(graph)).toThrow(
      'Graph edge source node does not exist: src/app.ts',
    );
  });

  it('rejects edges with missing target nodes', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('src/app.ts')],

      edges: [createEdge('edge:missing-target', 'src/app.ts', 'src/service.ts')],
    };

    expect(() => new FileGraphIndex(graph)).toThrow(
      'Graph edge target node does not exist: src/service.ts',
    );
  });
});
