import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRepositoryGraph } from '../graph/repository-graph.js';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { createChurnInputsFromGitHistory } from './git-history-churn.js';

import { calculateRepositoryMetrics } from './repository-metrics.js';

describe('repository metrics integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-metrics-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    await writeFile(
      join(repositoryRoot, 'src', 'app.ts'),
      `
import {
  runService,
} from './service.js';

import express from 'express';

export function start(
  enabled: boolean,
) {
  if (enabled) {
    return runService();
  }

  return null;
}
          `,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'service.ts'),
      `
import {
  queryDatabase,
} from './database.js';

export function runService() {
  return queryDatabase();
}
          `,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'database.ts'),
      `
export function queryDatabase(
  cached: boolean,
) {
  return cached
    ? 'cached'
    : 'fresh';
}
          `,
      'utf8',
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

  it('calculates graph, structure, complexity, and churn metrics from a real repository', async () => {
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/database.ts',
      },

      {
        relativePath: 'src/app.ts',
      },

      {
        relativePath: 'src/service.ts',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    const graphAnalysis = buildRepositoryGraph(parsed.parsed);

    /*
     * Repository source text is required by
     * our B8 complexity calculator.
     */
    const structureInputs = await Promise.all(
      parsed.parsed.map(async (parsedFile) => ({
        parsedFile,

        source: await readFile(join(repositoryRoot, parsedFile.filePath), 'utf8'),
      })),
    );

    /*
     * Simulate bounded Git history gathered
     * by the API ingestion layer.
     *
     * app.ts was changed in two commits.
     * service.ts was changed in one.
     * database.ts was not changed in the
     * analyzed history window.
     */
    const churnInputs = createChurnInputsFromGitHistory(
      graphAnalysis.graph.nodes.map((node) => node.filePath),
      [
        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/app.ts',
        },

        {
          commitSha: 'b'.repeat(40),

          filePath: 'src/app.ts',
        },

        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/service.ts',
        },

        /*
         * Historical deleted file.
         *
         * It must not become a current
         * repository metric.
         */
        {
          commitSha: 'c'.repeat(40),

          filePath: 'src/deleted.ts',
        },
      ],
    );

    const metrics = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs,

      churnInputs,
    });

    expect(metrics.summary).toEqual({
      fileCount: 3,

      internalDependencyCount: 2,

      externalImportCount: 1,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: 5,

      averageCyclomaticComplexity: 5 / 3,

      maxCyclomaticComplexity: 2,

      historyAvailable: true,

      totalChangedCommitCount: 3,

      averageChangedCommitCount: 1,

      maxChangedCommitCount: 2,
    });

    const app = metrics.files.find((file) => file.filePath === 'src/app.ts');

    expect(app).toMatchObject({
      dependencies: {
        fanIn: 0,

        fanOut: 1,

        transitiveDependencyCount: 2,
      },

      blastRadius: {
        affectedFileCount: 0,

        maxDistance: 0,
      },

      structure: {
        importCount: 2,

        functionCount: 1,

        cyclomaticComplexity: 2,
      },

      churn: {
        changedCommitCount: 2,
      },
    });

    const service = metrics.files.find((file) => file.filePath === 'src/service.ts');

    expect(service).toMatchObject({
      dependencies: {
        fanIn: 1,

        fanOut: 1,

        transitiveDependencyCount: 1,
      },

      blastRadius: {
        affectedFileCount: 1,

        maxDistance: 1,
      },

      churn: {
        changedCommitCount: 1,
      },
    });

    const database = metrics.files.find((file) => file.filePath === 'src/database.ts');

    expect(database).toMatchObject({
      dependencies: {
        fanIn: 1,

        fanOut: 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: 2,

        maxDistance: 2,
      },

      structure: {
        cyclomaticComplexity: 2,
      },

      churn: {
        changedCommitCount: 0,
      },
    });

    expect(metrics.files.some((file) => file.filePath === 'src/deleted.ts')).toBe(false);
  }, 20_000);
});
