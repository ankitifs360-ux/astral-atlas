import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { resolveRepositoryImports } from './repository-import-resolver.js';

describe('repository import resolution integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-resolution-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    await mkdir(join(repositoryRoot, 'python', 'services'), {
      recursive: true,
    });

    await writeFile(
      join(repositoryRoot, 'src', 'app.ts'),
      `
import {
  UserService,
} from './user-service.js';

import express from 'express';

export function start() {
  return new UserService();
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'user-service.ts'),
      `
export class UserService {
  findUser() {
    return true;
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'python', 'app.py'),
      `
from python.services.user import UserService
import numpy

def start():
    return UserService()
          `,
    );

    await writeFile(
      join(repositoryRoot, 'python', 'services', 'user.py'),
      `
class UserService:
    pass
          `,
    );

    pool = new ParserThreadPool(2);
  });

  afterAll(async () => {
    await pool.close();

    await rm(repositoryRoot, {
      recursive: true,

      force: true,
    });
  });

  it('parses real source files and resolves their repository dependencies', async () => {
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/app.ts',
      },

      {
        relativePath: 'src/user-service.ts',
      },

      {
        relativePath: 'python/app.py',
      },

      {
        relativePath: 'python/services/user.py',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    const resolution = resolveRepositoryImports(parsed.parsed);

    expect(
      resolution.imports.map((item) => ({
        sourceFilePath: item.sourceFilePath,

        specifier: item.specifier,

        kind: item.kind,

        targetFilePath: item.targetFilePath,

        reason: item.reason,
      })),
    ).toEqual([
      {
        sourceFilePath: 'python/app.py',

        specifier: 'python.services.user',

        kind: 'internal',

        targetFilePath: 'python/services/user.py',

        reason: null,
      },

      {
        sourceFilePath: 'python/app.py',

        specifier: 'numpy',

        kind: 'external',

        targetFilePath: null,

        reason: 'external-package',
      },

      {
        sourceFilePath: 'src/app.ts',

        specifier: './user-service.js',

        kind: 'internal',

        targetFilePath: 'src/user-service.ts',

        reason: null,
      },

      {
        sourceFilePath: 'src/app.ts',

        specifier: 'express',

        kind: 'external',

        targetFilePath: null,

        reason: 'external-package',
      },
    ]);
  }, 20_000);
});
