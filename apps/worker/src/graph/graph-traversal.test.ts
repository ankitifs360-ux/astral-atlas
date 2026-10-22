import { describe, expect, it } from 'vitest';

import { getTransitiveDependencies, getTransitiveDependents } from './graph-traversal.js';

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
    nodes: [
      createNode('app.ts'),

      createNode('service.ts'),

      createNode('database.ts'),

      createNode('logger.ts'),
    ],

    edges: [
      createEdge('edge:app-service', 'app.ts', 'service.ts'),

      createEdge('edge:service-db', 'service.ts', 'database.ts'),

      createEdge('edge:app-logger', 'app.ts', 'logger.ts'),
    ],
  };
}

describe('getTransitiveDependencies', () => {
  it('returns direct and transitive dependencies with distance', () => {
    const result = getTransitiveDependencies(createGraph(), 'app.ts');

    expect(result).toEqual([
      {
        nodeId: 'logger.ts',

        distance: 1,
      },

      {
        nodeId: 'service.ts',

        distance: 1,
      },

      {
        nodeId: 'database.ts',

        distance: 2,
      },
    ]);
  });

  it('uses the shortest distance when multiple paths reach the same node', () => {
    const graph = createGraph();

    graph.edges.push(createEdge('edge:app-db', 'app.ts', 'database.ts'));

    const result = getTransitiveDependencies(graph, 'app.ts');

    expect(result).toContainEqual({
      nodeId: 'database.ts',

      distance: 1,
    });
  });

  it('supports limiting traversal depth', () => {
    const result = getTransitiveDependencies(createGraph(), 'app.ts', {
      maxDepth: 1,
    });

    expect(result).toEqual([
      {
        nodeId: 'logger.ts',

        distance: 1,
      },

      {
        nodeId: 'service.ts',

        distance: 1,
      },
    ]);
  });

  it('returns an empty result when maxDepth is zero', () => {
    expect(
      getTransitiveDependencies(createGraph(), 'app.ts', {
        maxDepth: 0,
      }),
    ).toEqual([]);
  });

  it('handles dependency cycles without looping forever', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts')],

      edges: [
        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-c', 'b.ts', 'c.ts'),

        createEdge('edge:c-a', 'c.ts', 'a.ts'),
      ],
    };

    expect(getTransitiveDependencies(graph, 'a.ts')).toEqual([
      {
        nodeId: 'b.ts',

        distance: 1,
      },

      {
        nodeId: 'c.ts',

        distance: 2,
      },
    ]);
  });

  it('does not duplicate nodes when multiple edges connect the same files', () => {
    const graph = createGraph();

    graph.edges.push(createEdge('edge:duplicate', 'app.ts', 'service.ts'));

    const result = getTransitiveDependencies(graph, 'app.ts');

    expect(result.filter((item) => item.nodeId === 'service.ts')).toHaveLength(1);
  });
});

describe('getTransitiveDependents', () => {
  it('returns files that depend on the starting file', () => {
    const result = getTransitiveDependents(createGraph(), 'database.ts');

    expect(result).toEqual([
      {
        nodeId: 'service.ts',

        distance: 1,
      },

      {
        nodeId: 'app.ts',

        distance: 2,
      },
    ]);
  });

  it('returns immediate dependents with maxDepth one', () => {
    const result = getTransitiveDependents(createGraph(), 'database.ts', {
      maxDepth: 1,
    });

    expect(result).toEqual([
      {
        nodeId: 'service.ts',

        distance: 1,
      },
    ]);
  });

  it('returns multiple dependents in deterministic order', () => {
    const graph = createGraph();

    graph.edges.push(createEdge('edge:logger-db', 'logger.ts', 'database.ts'));

    const result = getTransitiveDependents(graph, 'database.ts');

    expect(result).toEqual([
      {
        nodeId: 'logger.ts',

        distance: 1,
      },

      {
        nodeId: 'service.ts',

        distance: 1,
      },

      {
        nodeId: 'app.ts',

        distance: 2,
      },
    ]);
  });
});

describe('graph traversal validation', () => {
  it('rejects a missing start node', () => {
    expect(() => getTransitiveDependencies(createGraph(), 'missing.ts')).toThrow(
      'Graph traversal start node does not exist: missing.ts',
    );
  });

  it('rejects negative maxDepth', () => {
    expect(() =>
      getTransitiveDependencies(createGraph(), 'app.ts', {
        maxDepth: -1,
      }),
    ).toThrow('Graph traversal maxDepth must be a non-negative integer.');
  });

  it('rejects non-integer maxDepth', () => {
    expect(() =>
      getTransitiveDependents(createGraph(), 'database.ts', {
        maxDepth: 1.5,
      }),
    ).toThrow('Graph traversal maxDepth must be a non-negative integer.');
  });
});
