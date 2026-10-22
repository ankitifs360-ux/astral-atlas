import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ParserThreadClient } from './parser-thread-client.js';

describe('ParserThreadClient integration', () => {
  let client: ParserThreadClient;

  beforeAll(() => {
    /*
     * This creates a REAL Node worker_thread.
     *
     * No mocks are used in this file.
     */
    client = new ParserThreadClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it('parses TypeScript inside a real worker thread', async () => {
    const result = await client.parse({
      filePath: 'src/user-service.ts',

      language: 'typescript',

      source: `
              import type {
                User,
              } from './types.js';

              import {
                database,
              } from './database.js';

              class UserService {
                async findUser(
                  id: string,
                ): Promise<User> {
                  return database.find(id);
                }
              }

              function createService() {
                return new UserService();
              }
            `,
    });

    expect(result.filePath).toBe('src/user-service.ts');

    expect(result.language).toBe('typescript');

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.imports.map((item) => item.source)).toEqual(['./types.js', './database.js']);

    expect(result.classes.map((item) => item.name)).toEqual(['UserService']);

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'findUser',

        async: true,
      },

      {
        name: 'createService',

        async: false,
      },
    ]);
  }, 15_000);

  it('reuses the same real worker thread for Python parsing', async () => {
    const result = await client.parse({
      filePath: 'src/service.py',

      language: 'python',

      source: `
from database.client import database

class UserService:
    async def find_user(self, user_id):
        return database.find(user_id)

def create_service():
    return UserService()
            `,
    });

    expect(result.hasSyntaxErrors).toBe(false);

    expect(result.imports.map((item) => item.source)).toEqual(['database.client']);

    expect(result.classes.map((item) => item.name)).toEqual(['UserService']);

    expect(
      result.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'find_user',

        async: true,
      },

      {
        name: 'create_service',

        async: false,
      },
    ]);
  }, 15_000);

  it('returns syntax-error information across the thread boundary', async () => {
    const result = await client.parse({
      filePath: 'src/broken.js',

      language: 'javascript',

      source: `
              function broken( {
                return 42;
              }
            `,
    });

    expect(result.hasSyntaxErrors).toBe(true);
  }, 15_000);
});
