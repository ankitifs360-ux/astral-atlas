import { describe, expect, it } from 'vitest';

import { detectDependencyCycles } from '../graph/cycle-detector.js';

import { FileGraphIndex } from '../graph/file-graph-index.js';

import { calculateFileGraphMetrics } from './graph-metrics.js';

import type { FileDependencyCycle } from '../graph/cycle-detector.js';

import type { FileDependencyGraph, FileGraphEdge, FileGraphNode } from '../graph/types.js';

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

function calculate(
  graph: FileDependencyGraph,
  filePaths: readonly string[] = graph.nodes.map((node) => node.id),
) {
  const graphIndex = new FileGraphIndex(graph);

  const cycles = detectDependencyCycles(graph);

  return calculateFileGraphMetrics(graphIndex, cycles, filePaths);
}

describe('calculateFileGraphMetrics', () => {
  it('calculates dependency and blast-radius metrics for a linear graph', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('app.ts'), createNode('service.ts'), createNode('db.ts')],

      edges: [
        createEdge('edge:app-service', 'app.ts', 'service.ts'),

        createEdge('edge:service-db', 'service.ts', 'db.ts'),
      ],
    };

    expect(calculate(graph)).toEqual([
      {
        filePath: 'app.ts',

        dependencies: {
          fanIn: 0,

          fanOut: 1,

          transitiveDependencyCount: 2,
        },

        blastRadius: {
          affectedFileCount: 0,

          maxDistance: 0,
        },

        cycles: {
          inDependencyCycle: false,

          cyclicComponentSize: 0,
        },
      },

      {
        filePath: 'db.ts',

        dependencies: {
          fanIn: 1,

          fanOut: 0,

          transitiveDependencyCount: 0,
        },

        blastRadius: {
          affectedFileCount: 2,

          maxDistance: 2,
        },

        cycles: {
          inDependencyCycle: false,

          cyclicComponentSize: 0,
        },
      },

      {
        filePath: 'service.ts',

        dependencies: {
          fanIn: 1,

          fanOut: 1,

          transitiveDependencyCount: 1,
        },

        blastRadius: {
          affectedFileCount: 1,

          maxDistance: 1,
        },

        cycles: {
          inDependencyCycle: false,

          cyclicComponentSize: 0,
        },
      },
    ]);
  });

  it('does not inflate fan-in or fan-out when duplicate dependency edges exist', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('app.ts'), createNode('service.ts')],

      edges: [
        createEdge('edge:one', 'app.ts', 'service.ts'),

        createEdge('edge:two', 'app.ts', 'service.ts'),
      ],
    };

    const metrics = calculate(graph);

    expect(metrics[0]).toMatchObject({
      filePath: 'app.ts',

      dependencies: {
        fanIn: 0,

        fanOut: 1,

        transitiveDependencyCount: 1,
      },
    });

    expect(metrics[1]).toMatchObject({
      filePath: 'service.ts',

      dependencies: {
        fanIn: 1,

        fanOut: 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: 1,

        maxDistance: 1,
      },
    });
  });

  it('returns zero metrics for an isolated file', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('isolated.ts')],

      edges: [],
    };

    expect(calculate(graph)).toEqual([
      {
        filePath: 'isolated.ts',

        dependencies: {
          fanIn: 0,

          fanOut: 0,

          transitiveDependencyCount: 0,
        },

        blastRadius: {
          affectedFileCount: 0,

          maxDistance: 0,
        },

        cycles: {
          inDependencyCycle: false,

          cyclicComponentSize: 0,
        },
      },
    ]);
  });

  it('marks every file inside a dependency cycle', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts')],

      edges: [
        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-c', 'b.ts', 'c.ts'),

        createEdge('edge:c-a', 'c.ts', 'a.ts'),
      ],
    };

    const metrics = calculate(graph);

    expect(
      metrics.map((item) => ({
        filePath: item.filePath,

        inDependencyCycle: item.cycles.inDependencyCycle,

        cyclicComponentSize: item.cycles.cyclicComponentSize,
      })),
    ).toEqual([
      {
        filePath: 'a.ts',

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },

      {
        filePath: 'b.ts',

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },

      {
        filePath: 'c.ts',

        inDependencyCycle: true,

        cyclicComponentSize: 3,
      },
    ]);
  });

  it('handles a self-loop as a one-file cyclic component', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('self.ts')],

      edges: [createEdge('edge:self', 'self.ts', 'self.ts')],
    };

    const metrics = calculate(graph);

    expect(metrics[0]).toMatchObject({
      filePath: 'self.ts',

      dependencies: {
        fanIn: 1,

        fanOut: 1,

        /*
         * The starting file itself is not
         * counted as a transitive dependency.
         */
        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: 0,

        maxDistance: 0,
      },

      cycles: {
        inDependencyCycle: true,

        cyclicComponentSize: 1,
      },
    });
  });

  it('deduplicates and sorts requested file paths', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('z.ts'), createNode('a.ts')],

      edges: [],
    };

    const graphIndex = new FileGraphIndex(graph);

    const metrics = calculateFileGraphMetrics(graphIndex, [], ['z.ts', 'a.ts', 'z.ts']);

    expect(metrics.map((item) => item.filePath)).toEqual(['a.ts', 'z.ts']);
  });

  it('rejects file paths that do not exist in the graph', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('app.ts')],

      edges: [],
    };

    const graphIndex = new FileGraphIndex(graph);

    expect(() => calculateFileGraphMetrics(graphIndex, [], ['missing.ts'])).toThrow(
      'Cannot calculate graph metrics for missing file node: missing.ts',
    );
  });

  it('rejects overlapping cycle definitions', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts')],

      edges: [],
    };

    const graphIndex = new FileGraphIndex(graph);

    const cycles: FileDependencyCycle[] = [
      {
        id: 'cycle:one',

        nodeIds: ['a.ts', 'b.ts'],

        edgeIds: [],
      },

      {
        id: 'cycle:two',

        nodeIds: ['b.ts', 'c.ts'],

        edgeIds: [],
      },
    ];

    expect(() => calculateFileGraphMetrics(graphIndex, cycles, ['a.ts', 'b.ts', 'c.ts'])).toThrow(
      'File belongs to multiple dependency cycles: b.ts',
    );
  });
});
