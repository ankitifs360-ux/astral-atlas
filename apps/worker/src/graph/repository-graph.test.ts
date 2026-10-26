import { describe, expect, it } from 'vitest';

import { buildRepositoryGraph } from './repository-graph.js';

import type { ParseSourceResult, SourceRange } from '../parsing/types.js';

function createRange(row: number): SourceRange {
  return {
    start: {
      row,
      column: 0,
    },

    end: {
      row,
      column: 10,
    },
  };
}

function createParsedFile(
  filePath: string,
  imports: ParseSourceResult['imports'] = [],
): ParseSourceResult {
  return {
    filePath,

    language: 'typescript',

    imports,

    functions: [],

    classes: [],

    calls: [],

    hasSyntaxErrors: false,
  };
}

describe('buildRepositoryGraph', () => {
  it('builds nodes and internal dependency edges', () => {
    const parsedFiles: ParseSourceResult[] = [
      createParsedFile('src/app.ts', [
        {
          source: './service.js',

          range: createRange(1),
        },
      ]),

      createParsedFile('src/service.ts'),
    ];

    const result = buildRepositoryGraph(parsedFiles);

    expect(result.graph.nodes.map((node) => node.id)).toEqual(['src/app.ts', 'src/service.ts']);

    expect(result.graph.edges).toHaveLength(1);

    expect(result.graph.edges[0]).toMatchObject({
      source: 'src/app.ts',

      target: 'src/service.ts',

      kind: 'imports',

      specifier: './service.js',
    });

    expect(result.graphIndex.getOutgoingNeighborIds('src/app.ts')).toEqual(['src/service.ts']);

    expect(result.cycles).toEqual([]);
  });

  it('keeps external and unresolved imports out of the graph', () => {
    const parsedFiles: ParseSourceResult[] = [
      createParsedFile('src/app.ts', [
        {
          source: 'express',

          range: createRange(1),
        },

        {
          source: './missing.js',

          range: createRange(2),
        },
      ]),
    ];

    const result = buildRepositoryGraph(parsedFiles);

    expect(result.graph.nodes).toHaveLength(1);

    expect(result.graph.edges).toEqual([]);

    expect(
      result.resolvedImports.map((item) => ({
        specifier: item.specifier,

        kind: item.kind,

        reason: item.reason,
      })),
    ).toEqual([
      {
        specifier: 'express',

        kind: 'external',

        reason: 'external-package',
      },

      {
        specifier: './missing.js',

        kind: 'unresolved',

        reason: 'target-not-found',
      },
    ]);
  });

  it('detects a dependency cycle from parsed repository imports', () => {
    const parsedFiles: ParseSourceResult[] = [
      createParsedFile('src/a.ts', [
        {
          source: './b.js',

          range: createRange(1),
        },
      ]),

      createParsedFile('src/b.ts', [
        {
          source: './c.js',

          range: createRange(1),
        },
      ]),

      createParsedFile('src/c.ts', [
        {
          source: './a.js',

          range: createRange(1),
        },
      ]),
    ];

    const result = buildRepositoryGraph(parsedFiles);

    expect(result.graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['src/a.ts', 'src/b.ts'],

      ['src/b.ts', 'src/c.ts'],

      ['src/c.ts', 'src/a.ts'],
    ]);

    expect(result.cycles).toHaveLength(1);

    expect(result.cycles[0]?.nodeIds).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(result.graphIndex.getIncomingNeighborIds('src/a.ts')).toEqual(['src/c.ts']);
  });
});
