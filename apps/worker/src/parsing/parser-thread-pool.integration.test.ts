import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ParserThreadPool } from './parser-thread-pool.js';

describe('ParserThreadPool integration', () => {
  let pool: ParserThreadPool;

  beforeAll(() => {
    /*
     * Use exactly two real worker_threads.
     *
     * This proves that the pool can distribute
     * parsing work across multiple long-lived
     * Tree-sitter threads.
     */
    pool = new ParserThreadPool(2);
  });

  afterAll(async () => {
    await pool.close();
  });

  it('parses multiple languages through real worker threads', async () => {
    const results = await pool.parseMany([
      {
        filePath: 'src/app.ts',

        language: 'typescript',

        source: `
                import {
                  UserService,
                } from './user-service.js';

                class Application {
                  start() {
                    return new UserService();
                  }
                }
              `,
      },

      {
        filePath: 'src/service.py',

        language: 'python',

        source: `
from database.client import database

class UserService:
    async def find_user(self, user_id):
        return database.find(user_id)
              `,
      },

      {
        filePath: 'src/index.js',

        language: 'javascript',

        source: `
                import express from 'express';

                function startServer() {
                  return express();
                }
              `,
      },
    ]);

    expect(results).toHaveLength(3);

    /*
     * parseMany() must preserve input order
     * even if worker threads finish in a
     * different order.
     */
    expect(results.map((result) => result.filePath)).toEqual([
      'src/app.ts',
      'src/service.py',
      'src/index.js',
    ]);

    expect(results[0]).toMatchObject({
      filePath: 'src/app.ts',

      language: 'typescript',

      hasSyntaxErrors: false,
    });

    expect(results[0]?.imports.map((item) => item.source)).toEqual(['./user-service.js']);

    expect(results[0]?.classes.map((item) => item.name)).toEqual(['Application']);

    expect(results[1]).toMatchObject({
      filePath: 'src/service.py',

      language: 'python',

      hasSyntaxErrors: false,
    });

    expect(results[1]?.imports.map((item) => item.source)).toEqual(['database.client']);

    expect(results[1]?.classes.map((item) => item.name)).toEqual(['UserService']);

    expect(results[2]).toMatchObject({
      filePath: 'src/index.js',

      language: 'javascript',

      hasSyntaxErrors: false,
    });

    expect(results[2]?.imports.map((item) => item.source)).toEqual(['express']);

    expect(results[2]?.functions.map((item) => item.name)).toEqual(['startServer']);
  }, 20_000);

  it('keeps the pool usable across multiple batches', async () => {
    const firstBatch = await pool.parseMany([
      {
        filePath: 'src/first.ts',

        language: 'typescript',

        source: 'function first() {}',
      },

      {
        filePath: 'src/second.ts',

        language: 'typescript',

        source: 'function second() {}',
      },
    ]);

    expect(firstBatch.map((result) => result.filePath)).toEqual(['src/first.ts', 'src/second.ts']);

    /*
     * The same two worker_threads should
     * remain alive and accept another batch.
     */
    const secondBatch = await pool.parseMany([
      {
        filePath: 'src/third.py',

        language: 'python',

        source: 'def third():\n    return 3',
      },

      {
        filePath: 'src/fourth.js',

        language: 'javascript',

        source: 'function fourth() { return 4; }',
      },
    ]);

    expect(secondBatch.map((result) => result.filePath)).toEqual(['src/third.py', 'src/fourth.js']);
  }, 20_000);
});
