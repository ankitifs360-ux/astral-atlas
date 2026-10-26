import { describe, expect, it } from 'vitest';

import { buildFileDependencyGraph } from './file-graph-builder.js';

import type { ParseSourceResult, SourceRange } from '../parsing/types.js';

import type { ResolvedImport } from '../resolution/types.js';

function createRange(row = 0, column = 0): SourceRange {
  return {
    start: {
      row,
      column,
    },

    end: {
      row,
      column: column + 10,
    },
  };
}

function createParsedFile(
  filePath: string,
  language: ParseSourceResult['language'] = 'typescript',
): ParseSourceResult {
  return {
    filePath,
    language,

    imports: [],

    functions: [],

    classes: [],

    calls: [],

    hasSyntaxErrors: false,
  };
}

function createResolvedImport(overrides: Partial<ResolvedImport> = {}): ResolvedImport {
  return {
    sourceFilePath: 'src/app.ts',

    sourceLanguage: 'typescript',

    specifier: './service.js',

    range: createRange(),

    kind: 'internal',

    targetFilePath: 'src/service.ts',

    reason: null,

    ...overrides,
  };
}

describe('buildFileDependencyGraph', () => {
  it('creates one node for each parsed file', () => {
    const graph = buildFileDependencyGraph(
      [
        createParsedFile('src/service.ts'),

        createParsedFile('src/app.ts'),

        createParsedFile('src/main.py', 'python'),
      ],
      [],
    );

    expect(graph.nodes).toEqual([
      {
        id: 'src/app.ts',

        kind: 'file',

        filePath: 'src/app.ts',

        language: 'typescript',

        hasSyntaxErrors: false,
      },

      {
        id: 'src/main.py',

        kind: 'file',

        filePath: 'src/main.py',

        language: 'python',

        hasSyntaxErrors: false,
      },

      {
        id: 'src/service.ts',

        kind: 'file',

        filePath: 'src/service.ts',

        language: 'typescript',

        hasSyntaxErrors: false,
      },
    ]);
  });

  it('preserves syntax-error state on nodes', () => {
    const broken = createParsedFile('src/broken.ts');

    broken.hasSyntaxErrors = true;

    const graph = buildFileDependencyGraph([broken], []);

    expect(graph.nodes[0]).toMatchObject({
      id: 'src/broken.ts',

      hasSyntaxErrors: true,
    });
  });

  it('creates directed edges for internal imports', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/app.ts'), createParsedFile('src/service.ts')],
      [createResolvedImport()],
    );

    expect(graph.edges).toHaveLength(1);

    expect(graph.edges[0]).toMatchObject({
      kind: 'imports',

      source: 'src/app.ts',

      target: 'src/service.ts',

      specifier: './service.js',

      range: createRange(),
    });

    expect(graph.edges[0]?.id).toMatch(/^edge:[a-f0-9]{24}$/);
  });

  it('does not create edges for external imports', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/app.ts')],
      [
        createResolvedImport({
          specifier: 'express',

          kind: 'external',

          targetFilePath: null,

          reason: 'external-package',
        }),
      ],
    );

    expect(graph.edges).toEqual([]);
  });

  it('does not create edges for unresolved imports', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/app.ts')],
      [
        createResolvedImport({
          specifier: './missing.js',

          kind: 'unresolved',

          targetFilePath: null,

          reason: 'target-not-found',
        }),
      ],
    );

    expect(graph.edges).toEqual([]);
  });

  it('does not create an edge when the source node is missing', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/service.ts')],
      [createResolvedImport()],
    );

    expect(graph.edges).toEqual([]);
  });

  it('does not create an edge when the target node is missing', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/app.ts')],
      [createResolvedImport()],
    );

    expect(graph.edges).toEqual([]);
  });

  it('produces stable edge IDs for the same dependency', () => {
    const parsedFiles = [createParsedFile('src/app.ts'), createParsedFile('src/service.ts')];

    const resolvedImports = [
      createResolvedImport({
        range: createRange(3, 4),
      }),
    ];

    const first = buildFileDependencyGraph(parsedFiles, resolvedImports);

    const second = buildFileDependencyGraph(parsedFiles, resolvedImports);

    expect(first.edges[0]?.id).toBe(second.edges[0]?.id);
  });

  it('produces different edge IDs when source locations differ', () => {
    const parsedFiles = [createParsedFile('src/app.ts'), createParsedFile('src/service.ts')];

    const graph = buildFileDependencyGraph(parsedFiles, [
      createResolvedImport({
        range: createRange(1, 0),
      }),

      createResolvedImport({
        range: createRange(5, 2),
      }),
    ]);

    expect(graph.edges).toHaveLength(2);

    expect(graph.edges[0]?.id).not.toBe(graph.edges[1]?.id);
  });

  it('sorts nodes and edges deterministically', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/z.ts'), createParsedFile('src/a.ts'), createParsedFile('src/m.ts')],
      [
        createResolvedImport({
          sourceFilePath: 'src/z.ts',

          targetFilePath: 'src/m.ts',

          specifier: './m.js',

          range: createRange(10, 0),
        }),

        createResolvedImport({
          sourceFilePath: 'src/a.ts',

          targetFilePath: 'src/m.ts',

          specifier: './m.js',

          range: createRange(2, 0),
        }),

        createResolvedImport({
          sourceFilePath: 'src/a.ts',

          targetFilePath: 'src/z.ts',

          specifier: './z.js',

          range: createRange(1, 0),
        }),
      ],
    );

    expect(graph.nodes.map((node) => node.id)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);

    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['src/a.ts', 'src/m.ts'],

      ['src/a.ts', 'src/z.ts'],

      ['src/z.ts', 'src/m.ts'],
    ]);
  });

  it('keeps multiple imports between the same files as separate edges', () => {
    const graph = buildFileDependencyGraph(
      [createParsedFile('src/app.ts'), createParsedFile('src/service.ts')],
      [
        createResolvedImport({
          range: createRange(1, 0),
        }),

        createResolvedImport({
          range: createRange(10, 0),
        }),
      ],
    );

    expect(graph.edges).toHaveLength(2);

    expect(graph.edges[0]?.source).toBe('src/app.ts');

    expect(graph.edges[1]?.source).toBe('src/app.ts');
  });
});
