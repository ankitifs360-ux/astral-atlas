import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { buildRepositoryGraph } from './repository-graph.js';

describe('repository graph integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-graph-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    /*
     * Create a real dependency cycle:
     *
     * app.ts
     *   ↓
     * service.ts
     *   ↓
     * repository.ts
     *   ↓
     * app.ts
     */

    await writeFile(
      join(repositoryRoot, 'src', 'app.ts'),
      `
import {
  Service,
} from './service.js';

import express from 'express';

export class App {
  public start() {
    return new Service();
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'service.ts'),
      `
import {
  Repository,
} from './repository.js';

export class Service {
  public run() {
    return new Repository();
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'repository.ts'),
      `
import {
  App,
} from './app.js';

export class Repository {
  public createApp() {
    return new App();
  }
}
          `,
    );

    await writeFile(
      join(repositoryRoot, 'src', 'logger.ts'),
      `
export function log(
  message: string,
) {
  console.log(message);
}
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

  it('builds a dependency graph and detects cycles from real source files', async () => {
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/logger.ts',
      },

      {
        relativePath: 'src/repository.ts',
      },

      {
        relativePath: 'src/app.ts',
      },

      {
        relativePath: 'src/service.ts',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    const analysis = buildRepositoryGraph(parsed.parsed);

    expect(analysis.graph.nodes.map((node) => node.id)).toEqual([
      'src/app.ts',
      'src/logger.ts',
      'src/repository.ts',
      'src/service.ts',
    ]);

    /*
     * Only repository-internal imports
     * become graph edges.
     *
     * "express" remains external and is
     * therefore not represented as a file
     * graph edge.
     */
    expect(analysis.graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['src/app.ts', 'src/service.ts'],

      ['src/repository.ts', 'src/app.ts'],

      ['src/service.ts', 'src/repository.ts'],
    ]);

    expect(
      analysis.resolvedImports.map((item) => ({
        sourceFilePath: item.sourceFilePath,

        specifier: item.specifier,

        kind: item.kind,

        targetFilePath: item.targetFilePath,
      })),
    ).toEqual([
      {
        sourceFilePath: 'src/app.ts',

        specifier: './service.js',

        kind: 'internal',

        targetFilePath: 'src/service.ts',
      },

      {
        sourceFilePath: 'src/app.ts',

        specifier: 'express',

        kind: 'external',

        targetFilePath: null,
      },

      {
        sourceFilePath: 'src/repository.ts',

        specifier: './app.js',

        kind: 'internal',

        targetFilePath: 'src/app.ts',
      },

      {
        sourceFilePath: 'src/service.ts',

        specifier: './repository.js',

        kind: 'internal',

        targetFilePath: 'src/repository.ts',
      },
    ]);

    expect(analysis.cycles).toHaveLength(1);

    expect(analysis.cycles[0]?.nodeIds).toEqual([
      'src/app.ts',
      'src/repository.ts',
      'src/service.ts',
    ]);

    /*
     * logger.ts is isolated and should not
     * appear in the cyclic component.
     */
    expect(analysis.cycles[0]?.nodeIds).not.toContain('src/logger.ts');

    expect(analysis.graphIndex.getOutgoingNeighborIds('src/app.ts')).toEqual(['src/service.ts']);

    expect(analysis.graphIndex.getIncomingNeighborIds('src/app.ts')).toEqual(['src/repository.ts']);
  }, 20_000);
});
