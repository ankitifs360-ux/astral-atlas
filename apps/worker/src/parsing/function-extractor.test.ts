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

    expect(
      result.functions.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'createService',
        isExported: false,
      },
      {
        name: 'findUser',
        isExported: false,
      },
    ]);
  });

  it('marks directly exported named functions as exported', () => {
    const result = parseSource({
      filePath: 'src/main.ts',

      language: 'typescript',

      source: `
              export function run(): string {
                return 'ready';
              }

              export default function start(): void {}
            `,
    });

    expect(
      result.functions.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'run',
        isExported: true,
      },
      {
        name: 'start',
        isExported: true,
      },
    ]);
  });

  it('marks exported variable-assigned functions as exported', () => {
    const result = parseSource({
      filePath: 'src/handlers.ts',

      language: 'typescript',

      source: `
              export const handler =
                async () => {
                  return true;
                };

              export const validate =
                function () {
                  return true;
                };
            `,
    });

    expect(
      result.functions.map((item) => ({
        name: item.name,
        async: item.async,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'handler',
        async: true,
        isExported: true,
      },
      {
        name: 'validate',
        async: false,
        isExported: true,
      },
    ]);
  });

  it('does not mark nested functions inside an exported function as exported', () => {
    const result = parseSource({
      filePath: 'src/nested.ts',

      language: 'typescript',

      source: `
              export function outer(): void {
                function inner(): void {}
              }
            `,
    });

    expect(
      result.functions.map((item) => ({
        name: item.name,
        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'outer',
        isExported: true,
      },
      {
        name: 'inner',
        isExported: false,
      },
    ]);
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

      isExported: false,
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

      isExported: false,
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

    expect(result.functions[0]).toMatchObject({
      name: 'handler',

      isExported: false,
    });
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

        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'save',

        async: false,

        isExported: false,
      },

      {
        name: 'delete',

        async: false,

        isExported: false,
      },

      {
        name: 'refresh',

        async: true,

        isExported: false,
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

    expect(result.functions[0]).toMatchObject({
      name: null,

      isExported: false,
    });
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

    expect(result.functions[0]).toMatchObject({
      name: null,

      isExported: false,
    });
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

        isExported: item.isExported,
      })),
    ).toEqual([
      {
        name: 'fetch_user',

        async: true,

        isExported: false,
      },

      {
        name: 'create_user',

        async: false,

        isExported: false,
      },
    ]);
  });
});
