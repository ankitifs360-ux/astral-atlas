import { describe, expect, it } from 'vitest';

import { detectDependencyCycles } from './cycle-detector.js';

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

describe('detectDependencyCycles', () => {
  it('returns no cycles for an acyclic graph', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts')],

      edges: [createEdge('edge:a-b', 'a.ts', 'b.ts'), createEdge('edge:b-c', 'b.ts', 'c.ts')],
    };

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it('detects a simple two-node cycle', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts')],

      edges: [createEdge('edge:a-b', 'a.ts', 'b.ts'), createEdge('edge:b-a', 'b.ts', 'a.ts')],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles).toHaveLength(1);

    expect(cycles[0]?.nodeIds).toEqual(['a.ts', 'b.ts']);

    expect(cycles[0]?.edgeIds).toEqual(['edge:a-b', 'edge:b-a']);

    expect(cycles[0]?.id).toMatch(/^cycle:[a-f0-9]{24}$/);
  });

  it('detects a larger strongly connected component', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts')],

      edges: [
        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-c', 'b.ts', 'c.ts'),

        createEdge('edge:c-a', 'c.ts', 'a.ts'),
      ],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles).toHaveLength(1);

    expect(cycles[0]?.nodeIds).toEqual(['a.ts', 'b.ts', 'c.ts']);

    expect(cycles[0]?.edgeIds).toEqual(['edge:a-b', 'edge:b-c', 'edge:c-a']);
  });

  it('detects a self-loop as a cycle', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts')],

      edges: [createEdge('edge:self', 'a.ts', 'a.ts')],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles).toHaveLength(1);

    expect(cycles[0]?.nodeIds).toEqual(['a.ts']);

    expect(cycles[0]?.edgeIds).toEqual(['edge:self']);
  });

  it('does not classify a single node without a self-loop as cyclic', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts')],

      edges: [],
    };

    expect(detectDependencyCycles(graph)).toEqual([]);
  });

  it('detects multiple disconnected cyclic components', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts'), createNode('d.ts')],

      edges: [
        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-a', 'b.ts', 'a.ts'),

        createEdge('edge:c-d', 'c.ts', 'd.ts'),

        createEdge('edge:d-c', 'd.ts', 'c.ts'),
      ],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles.map((cycle) => cycle.nodeIds)).toEqual([
      ['a.ts', 'b.ts'],

      ['c.ts', 'd.ts'],
    ]);
  });

  it('includes every internal edge inside the cyclic component', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts')],

      edges: [
        createEdge('edge:a-b-1', 'a.ts', 'b.ts'),

        createEdge('edge:a-b-2', 'a.ts', 'b.ts'),

        createEdge('edge:b-a', 'b.ts', 'a.ts'),
      ],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles[0]?.edgeIds).toEqual(['edge:a-b-1', 'edge:a-b-2', 'edge:b-a']);
  });

  it('does not include edges entering or leaving the cyclic component', () => {
    const graph: FileDependencyGraph = {
      nodes: [
        createNode('entry.ts'),

        createNode('a.ts'),

        createNode('b.ts'),

        createNode('exit.ts'),
      ],

      edges: [
        createEdge('edge:entry-a', 'entry.ts', 'a.ts'),

        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-a', 'b.ts', 'a.ts'),

        createEdge('edge:b-exit', 'b.ts', 'exit.ts'),
      ],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles).toHaveLength(1);

    expect(cycles[0]?.nodeIds).toEqual(['a.ts', 'b.ts']);

    expect(cycles[0]?.edgeIds).toEqual(['edge:a-b', 'edge:b-a']);
  });

  it('produces stable cycle ids for the same component', () => {
    const firstGraph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts')],

      edges: [createEdge('edge:a-b', 'a.ts', 'b.ts'), createEdge('edge:b-a', 'b.ts', 'a.ts')],
    };

    const secondGraph: FileDependencyGraph = {
      nodes: [createNode('b.ts'), createNode('a.ts')],

      edges: [createEdge('edge:b-a', 'b.ts', 'a.ts'), createEdge('edge:a-b', 'a.ts', 'b.ts')],
    };

    const first = detectDependencyCycles(firstGraph);

    const second = detectDependencyCycles(secondGraph);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.nodeIds).toEqual(second[0]?.nodeIds);
  });

  it('handles a graph containing both cyclic and acyclic regions', () => {
    const graph: FileDependencyGraph = {
      nodes: [createNode('a.ts'), createNode('b.ts'), createNode('c.ts'), createNode('d.ts')],

      edges: [
        createEdge('edge:a-b', 'a.ts', 'b.ts'),

        createEdge('edge:b-a', 'b.ts', 'a.ts'),

        createEdge('edge:b-c', 'b.ts', 'c.ts'),

        createEdge('edge:c-d', 'c.ts', 'd.ts'),
      ],
    };

    const cycles = detectDependencyCycles(graph);

    expect(cycles).toHaveLength(1);

    expect(cycles[0]?.nodeIds).toEqual(['a.ts', 'b.ts']);
  });
});
