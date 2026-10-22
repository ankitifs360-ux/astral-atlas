import { describe, expect, it } from 'vitest';

import { parseSource } from './parser.js';

describe('function extraction', () => {
  it('extracts normal named functions and methods', () => {
    const result = parseSource({
      filePath: 'src/service.ts',

      language: 'typescript',

      source: `
              function createService() {}

              class UserService {
                findUser() {}
              }
            `,
    });

    expect(result.functions.map((item) => item.name)).toEqual(['createService', 'findUser']);
  });

  it('infers the name of an arrow function assigned to a variable', () => {
    const result = parseSource({
      filePath: 'src/handler.ts',

      language: 'typescript',

      source: `
              const handler =
                async () => {
                  return true;
                };
            `,
    });

    expect(result.functions).toHaveLength(1);

    expect(result.functions[0]).toMatchObject({
      name: 'handler',

      async: true,
    });
  });

  it('infers the name of a function expression assigned to a variable', () => {
    const result = parseSource({
      filePath: 'src/validator.js',

      language: 'javascript',

      source: `
              const validate =
                function () {
                  return true;
                };
            `,
    });

    expect(result.functions).toHaveLength(1);

    expect(result.functions[0]).toMatchObject({
      name: 'validate',

      async: false,
    });
  });

  it('infers the name of an arrow function assigned directly to an identifier', () => {
    const result = parseSource({
      filePath: 'src/runtime.js',

      language: 'javascript',

      source: `
              let handler;

              handler =
                () => {
                  return true;
                };
            `,
    });

    expect(result.functions).toHaveLength(1);

    expect(result.functions[0]?.name).toBe('handler');
  });

  it('infers function names from object property keys', () => {
    const result = parseSource({
      filePath: 'src/actions.ts',

      language: 'typescript',

      source: `
              const actions = {
                save: () => {
                  return true;
                },

                delete:
                  function () {
                    return true;
                  },

                'refresh':
                  async () => {
                    return true;
                  },
              };
            `,
    });

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'save',

        async: false,
      },

      {
        name: 'delete',

        async: false,
      },

      {
        name: 'refresh',

        async: true,
      },
    ]);
  });

  it('keeps genuinely anonymous callbacks unnamed', () => {
    const result = parseSource({
      filePath: 'src/users.ts',

      language: 'typescript',

      source: `
              const users = [
                {
                  id: 1,
                },
              ];

              users.map(
                (user) => user.id,
              );
            `,
    });

    expect(result.functions).toHaveLength(1);

    expect(result.functions[0]?.name).toBeNull();
  });

  it('does not invent a simple name for member assignments', () => {
    const result = parseSource({
      filePath: 'src/service.js',

      language: 'javascript',

      source: `
              service.handler =
                () => {
                  return true;
                };
            `,
    });

    expect(result.functions).toHaveLength(1);

    expect(result.functions[0]?.name).toBeNull();
  });

  it('continues extracting Python function names normally', () => {
    const result = parseSource({
      filePath: 'src/service.py',

      language: 'python',

      source: `
async def fetch_user(user_id):
    return user_id

def create_user():
    return {}
            `,
    });

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'fetch_user',

        async: true,
      },

      {
        name: 'create_user',

        async: false,
      },
    ]);
  });
});
