import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ParserThreadPool } from './parser-thread-pool.js';

import { parseRepositoryFiles } from './repository-parser.js';

describe('parseRepositoryFiles integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-repository-parser-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    await writeFile(
      join(repositoryRoot, 'src', 'app.ts'),
      `
import {
  UserService,
} from './user-service.js';

export class Application {
  public start() {
    return new UserService();
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'user-service.ts'),
      `
import type {
  User,
} from './types.js';

export class UserService {
  public async findUser(
    id: string,
  ): Promise<User> {
    return {
      id,
    };
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'service.py'),
      `
from database.client import database

class PythonService:
    async def load_user(self, user_id):
        return database.find(user_id)
          `,
    );

    await writeFile(join(repositoryRoot, 'README.md'), '# Astral Atlas\n');

    /*
     * Use two REAL parser worker_threads.
     */
    pool = new ParserThreadPool(2);
  });

  afterAll(async () => {
    await pool.close();

    await rm(repositoryRoot, {
      recursive: true,

      force: true,
    });
  });

  it('reads repository files and parses them through real Tree-sitter worker threads', async () => {
    const result = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/user-service.ts',
      },

      {
        relativePath: 'README.md',
      },

      {
        relativePath: 'src/service.py',
      },

      {
        relativePath: 'src/app.ts',
      },
    ]);

    /*
     * Results should be deterministic even
     * though the input list was deliberately
     * unordered.
     */
    expect(result.parsed.map((item) => item.filePath)).toEqual([
      'src/app.ts',
      'src/service.py',
      'src/user-service.ts',
    ]);

    expect(result.skipped).toEqual([
      {
        filePath: 'README.md',

        reason: 'unsupported-language',
      },
    ]);

    const app = result.parsed[0];

    expect(app).toBeDefined();

    expect(app?.language).toBe('typescript');

    expect(app?.hasSyntaxErrors).toBe(false);

    expect(app?.imports.map((item) => item.source)).toEqual(['./user-service.js']);

    expect(app?.classes.map((item) => item.name)).toEqual(['Application']);

    expect(app?.functions.map((item) => item.name)).toEqual(['start']);

    const python = result.parsed[1];

    expect(python).toBeDefined();

    expect(python?.language).toBe('python');

    expect(python?.imports.map((item) => item.source)).toEqual(['database.client']);

    expect(python?.classes.map((item) => item.name)).toEqual(['PythonService']);

    expect(
      python?.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'load_user',

        async: true,
      },
    ]);

    const userService = result.parsed[2];

    expect(userService).toBeDefined();

    expect(userService?.imports.map((item) => item.source)).toEqual(['./types.js']);

    expect(userService?.classes.map((item) => item.name)).toEqual(['UserService']);

    expect(
      userService?.functions.map((item) => ({
        name: item.name,

        async: item.async,
      })),
    ).toEqual([
      {
        name: 'findUser',

        async: true,
      },
    ]);
  }, 20_000);
});
