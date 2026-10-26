import { describe, expect, it } from 'vitest';

import { parseSource } from '../parsing/parser.js';

import { buildFunctionCallGraph } from './function-call-graph-builder.js';

describe('buildFunctionCallGraph with real parser output', () => {
  it('builds function call edges from real TypeScript source', () => {
    const parsedFile = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
function createUser() {
  validateUser();
  saveUser();
}
      `,
    });

    const graph = buildFunctionCallGraph([parsedFile]);

    expect(graph.nodes).toHaveLength(1);

    expect(graph.nodes[0]).toMatchObject({
      kind: 'function',

      filePath: 'src/users.ts',

      name: 'createUser',
    });

    expect(
      graph.edges.map((edge) => ({
        source: edge.source,

        callee: edge.callee,
      })),
    ).toEqual([
      {
        source: graph.nodes[0]?.id,

        callee: 'validateUser',
      },

      {
        source: graph.nodes[0]?.id,

        callee: 'saveUser',
      },
    ]);
  });

  it('assigns nested calls to the nearest real parsed function', () => {
    const parsedFile = parseSource({
      filePath: 'src/nested.ts',

      language: 'typescript',

      source: `
function outer() {
  prepare();

  function inner() {
    saveUser();
  }

  finish();
}
      `,
    });

    const graph = buildFunctionCallGraph([parsedFile]);

    const outerNode = graph.nodes.find((node) => node.name === 'outer');

    const innerNode = graph.nodes.find((node) => node.name === 'inner');

    expect(outerNode).toBeDefined();

    expect(innerNode).toBeDefined();

    expect(
      graph.edges.map((edge) => ({
        source: edge.source,

        callee: edge.callee,
      })),
    ).toEqual([
      {
        source: outerNode?.id,

        callee: 'prepare',
      },

      {
        source: outerNode?.id,

        callee: 'finish',
      },

      {
        source: innerNode?.id,

        callee: 'saveUser',
      },
    ]);
  });

  it('builds function call edges from real Python source', () => {
    const parsedFile = parseSource({
      filePath: 'src/service.py',

      language: 'python',

      source: `
def get_user(user_id):
    validate_user(user_id)
    return database.find(user_id)
      `,
    });

    const graph = buildFunctionCallGraph([parsedFile]);

    expect(graph.nodes).toHaveLength(1);

    expect(graph.nodes[0]).toMatchObject({
      filePath: 'src/service.py',

      language: 'python',

      name: 'get_user',
    });

    expect(graph.edges.map((edge) => edge.callee)).toEqual(['validate_user', 'database.find']);

    expect(graph.edges.every((edge) => edge.source === graph.nodes[0]?.id)).toBe(true);
  });

  it('does not create function edges for module-scope calls', () => {
    const parsedFile = parseSource({
      filePath: 'src/bootstrap.ts',

      language: 'typescript',

      source: `
console.log('boot');

function start() {
  runServer();
}
      `,
    });

    const graph = buildFunctionCallGraph([parsedFile]);

    expect(graph.nodes.map((node) => node.name)).toEqual(['start']);

    expect(graph.edges.map((edge) => edge.callee)).toEqual(['runServer']);
  });
});
