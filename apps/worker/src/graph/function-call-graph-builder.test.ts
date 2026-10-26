import { describe, expect, it } from 'vitest';

import { buildFunctionCallGraph } from './function-call-graph-builder.js';

import type {
  ParsedCall,
  ParsedFunction,
  ParseSourceResult,
  SourceRange,
} from '../parsing/types.js';

function createRange(
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): SourceRange {
  return {
    start: {
      row: startRow,
      column: startColumn,
    },

    end: {
      row: endRow,
      column: endColumn,
    },
  };
}

function createFunction(
  name: string | null,
  range: SourceRange,
  options: {
    async?: boolean;
    isExported?: boolean;
  } = {},
): ParsedFunction {
  return {
    name,

    range,

    async: options.async ?? false,

    isExported: options.isExported ?? false,
  };
}

function createCall(callee: string, range: SourceRange): ParsedCall {
  return {
    callee,

    range,
  };
}

function createParsedFile(
  filePath: string,
  functions: ParsedFunction[] = [],
  calls: ParsedCall[] = [],
): ParseSourceResult {
  return {
    filePath,

    language: 'typescript',

    imports: [],

    functions,

    classes: [],

    calls,

    hasSyntaxErrors: false,
  };
}

describe('buildFunctionCallGraph', () => {
  it('creates one node for each parsed function', () => {
    const start = createFunction('start', createRange(0, 0, 2, 1), {
      async: true,

      isExported: true,
    });

    const stop = createFunction('stop', createRange(4, 0, 6, 1));

    const graph = buildFunctionCallGraph([createParsedFile('src/app.ts', [start, stop])]);

    expect(graph.nodes).toHaveLength(2);

    expect(
      graph.nodes.map((node) => ({
        kind: node.kind,

        filePath: node.filePath,

        name: node.name,

        async: node.async,

        isExported: node.isExported,
      })),
    ).toEqual([
      {
        kind: 'function',

        filePath: 'src/app.ts',

        name: 'start',

        async: true,

        isExported: true,
      },

      {
        kind: 'function',

        filePath: 'src/app.ts',

        name: 'stop',

        async: false,

        isExported: false,
      },
    ]);

    expect(graph.nodes[0]?.id).toMatch(/^function:[a-f0-9]{24}$/);

    expect(graph.nodes[1]?.id).toMatch(/^function:[a-f0-9]{24}$/);
  });

  it('creates call edges from the owning function', () => {
    const createUser = createFunction('createUser', createRange(0, 0, 5, 1));

    const validateUser = createCall('validateUser', createRange(1, 2, 1, 16));

    const saveUser = createCall('saveUser', createRange(2, 2, 2, 12));

    const graph = buildFunctionCallGraph([
      createParsedFile('src/users.ts', [createUser], [validateUser, saveUser]),
    ]);

    expect(graph.edges).toHaveLength(2);

    const sourceNode = graph.nodes[0];

    expect(sourceNode).toBeDefined();

    expect(
      graph.edges.map((edge) => ({
        kind: edge.kind,

        source: edge.source,

        callee: edge.callee,
      })),
    ).toEqual([
      {
        kind: 'calls',

        source: sourceNode?.id,

        callee: 'validateUser',
      },

      {
        kind: 'calls',

        source: sourceNode?.id,

        callee: 'saveUser',
      },
    ]);

    expect(graph.edges[0]?.id).toMatch(/^call-edge:[a-f0-9]{24}$/);

    expect(graph.edges[1]?.id).toMatch(/^call-edge:[a-f0-9]{24}$/);
  });

  it('ignores module-scope calls because they have no function owner', () => {
    const start = createFunction('start', createRange(3, 0, 5, 1));

    const moduleCall = createCall('console.log', createRange(0, 0, 0, 20));

    const graph = buildFunctionCallGraph([createParsedFile('src/app.ts', [start], [moduleCall])]);

    expect(graph.nodes).toHaveLength(1);

    expect(graph.edges).toEqual([]);
  });

  it('attributes nested calls to the nearest function node', () => {
    const outer = createFunction('outer', createRange(0, 0, 10, 1));

    const inner = createFunction('inner', createRange(3, 2, 7, 3));

    const outerCall = createCall('prepare', createRange(1, 2, 1, 11));

    const innerCall = createCall('saveUser', createRange(5, 4, 5, 14));

    const graph = buildFunctionCallGraph([
      createParsedFile('src/app.ts', [outer, inner], [outerCall, innerCall]),
    ]);

    const outerNode = graph.nodes.find((node) => node.name === 'outer');

    const innerNode = graph.nodes.find((node) => node.name === 'inner');

    expect(outerNode).toBeDefined();

    expect(innerNode).toBeDefined();

    expect(
      graph.edges.map((edge) => ({
        source: edge.source,

        callee: edge.callee,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          source: outerNode?.id,

          callee: 'prepare',
        },

        {
          source: innerNode?.id,

          callee: 'saveUser',
        },
      ]),
    );
  });

  it('creates function nodes across multiple files', () => {
    const graph = buildFunctionCallGraph([
      createParsedFile('src/z.ts', [createFunction('zeta', createRange(0, 0, 2, 1))]),

      createParsedFile('src/a.ts', [createFunction('alpha', createRange(0, 0, 2, 1))]),
    ]);

    expect(graph.nodes.map((node) => [node.filePath, node.name])).toEqual([
      ['src/a.ts', 'alpha'],

      ['src/z.ts', 'zeta'],
    ]);
  });

  it('produces stable graph IDs for identical input', () => {
    const run = createFunction('run', createRange(0, 0, 4, 1));

    const call = createCall('execute', createRange(2, 2, 2, 11));

    const parsedFiles = [createParsedFile('src/app.ts', [run], [call])];

    const first = buildFunctionCallGraph(parsedFiles);

    const second = buildFunctionCallGraph(parsedFiles);

    expect(first.nodes.map((node) => node.id)).toEqual(second.nodes.map((node) => node.id));

    expect(first.edges.map((edge) => edge.id)).toEqual(second.edges.map((edge) => edge.id));
  });

  it('returns deterministic output regardless of parsed file ordering', () => {
    const a = createParsedFile(
      'src/a.ts',
      [createFunction('alpha', createRange(0, 0, 3, 1))],
      [createCall('runAlpha', createRange(1, 2, 1, 12))],
    );

    const z = createParsedFile(
      'src/z.ts',
      [createFunction('zeta', createRange(0, 0, 3, 1))],
      [createCall('runZeta', createRange(1, 2, 1, 11))],
    );

    const first = buildFunctionCallGraph([z, a]);

    const second = buildFunctionCallGraph([a, z]);

    expect(first).toEqual(second);
  });

  it('returns an empty graph for an empty repository', () => {
    expect(buildFunctionCallGraph([])).toEqual({
      nodes: [],

      edges: [],
    });
  });
});
