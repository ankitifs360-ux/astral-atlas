import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyzeRepositoryDeeply } from '../deep-analysis/repository-deep-analysis.js';

import { buildRepositoryGraph } from '../graph/repository-graph.js';

import { createChurnInputsFromGitHistory } from '../metrics/git-history-churn.js';

import { calculateRepositoryMetrics } from '../metrics/repository-metrics.js';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { buildRepositoryOnboardingPath } from './repository-onboarding.js';

describe('repository onboarding integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-onboarding-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    /*
     * Expected dependency flow:
     *
     * server.ts
     *    ↓
     * routes.ts
     *    ↓
     * user-service.ts
     *    ↓
     * database.ts
     *
     * user-service.ts also participates in
     * a cycle with audit-service.ts.
     */
    await writeFile(
      join(repositoryRoot, 'src', 'server.ts'),
      `
import {
  registerRoutes,
} from './routes.js';

export function startServer() {
  return registerRoutes();
}
`,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'routes.ts'),
      `
import {
  getUser,
} from './user-service.js';

export function registerRoutes() {
  return getUser('1');
}
`,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'user-service.ts'),
      `
import {
  queryUser,
} from './database.js';

import {
  recordAudit,
} from './audit-service.js';

export function getUser(
  id: string,
) {
  if (!id) {
    throw new Error('Missing id');
  }

  recordAudit(id);

  return queryUser(id);
}
`,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'database.ts'),
      `
export function queryUser(
  id: string,
) {
  return {
    id,
  };
}
`,
      'utf8',
    );

    await writeFile(
      join(repositoryRoot, 'src', 'audit-service.ts'),
      `
import {
  getUser,
} from './user-service.js';

export function recordAudit(
  id: string,
) {
  if (id === 'reload') {
    return getUser(id);
  }

  return id;
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

  it('builds a deterministic onboarding path from real repository analysis', async () => {
    /*
     * B5
     */
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/server.ts',
      },

      {
        relativePath: 'src/routes.ts',
      },

      {
        relativePath: 'src/user-service.ts',
      },

      {
        relativePath: 'src/database.ts',
      },

      {
        relativePath: 'src/audit-service.ts',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    /*
     * B6 + B7
     */
    const graphAnalysis = buildRepositoryGraph(parsed.parsed);

    expect(graphAnalysis.graph.nodes).toHaveLength(5);

    expect(graphAnalysis.graph.edges).toHaveLength(5);

    expect(graphAnalysis.cycles).toHaveLength(1);

    /*
     * B8 structure inputs
     */
    const structureInputs = await Promise.all(
      parsed.parsed.map(async (parsedFile) => ({
        parsedFile,

        source: await readFile(join(repositoryRoot, parsedFile.filePath), 'utf8'),
      })),
    );

    /*
     * Simulated Git history.
     *
     * user-service.ts has the most churn,
     * which helps make it an architectural
     * hotspot during deep analysis.
     */
    const churnInputs = createChurnInputsFromGitHistory(
      graphAnalysis.graph.nodes.map((node) => node.filePath),
      [
        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/user-service.ts',
        },

        {
          commitSha: 'b'.repeat(40),

          filePath: 'src/user-service.ts',
        },

        {
          commitSha: 'c'.repeat(40),

          filePath: 'src/user-service.ts',
        },

        {
          commitSha: 'd'.repeat(40),

          filePath: 'src/routes.ts',
        },
      ],
    );

    const metrics = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs,

      churnInputs,
    });

    expect(metrics.summary).toMatchObject({
      fileCount: 5,

      internalDependencyCount: 5,

      cyclicComponentCount: 1,

      cyclicFileCount: 2,

      historyAvailable: true,
    });

    /*
     * B9
     *
     * Lower thresholds are intentional for
     * this tiny integration repository.
     */
    const deepAnalysis = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,

      thresholds: {
        cyclomaticComplexity: {
          medium: 2,
          high: 4,
        },

        changedCommitCount: {
          medium: 2,
          high: 4,
        },

        affectedFileCount: {
          medium: 1,
          high: 3,
        },

        fanIn: {
          medium: 1,
          high: 2,
        },

        fanOut: {
          medium: 1,
          high: 3,
        },

        hotspotSignalCount: {
          medium: 2,
          high: 3,
        },
      },
    });

    expect(deepAnalysis.findings.length).toBeGreaterThan(0);

    /*
     * B11
     */
    const onboarding = buildRepositoryOnboardingPath({
      graphAnalysis,

      metrics,

      deepAnalysis,

      maxSteps: 5,
    });

    expect(onboarding.consideredFileCount).toBe(5);

    expect(onboarding.maxSteps).toBe(5);

    /*
     * server.ts should be first because:
     *
     * - conventional name
     * - dependency root
     */
    expect(onboarding.steps[0]?.filePath).toBe('src/server.ts');

    expect(onboarding.steps[0]?.signals.some((signal) => signal.kind === 'entry-point')).toBe(true);

    /*
     * Pathfinder should then preserve the
     * natural dependency-reading flow.
     */
    expect(onboarding.steps.slice(0, 4).map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/user-service.ts',
      'src/audit-service.ts',
    ]);

    /*
     * Every connected transition after the
     * first should be explained.
     */
    expect(
      onboarding.steps[1]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(true);

    expect(
      onboarding.steps[2]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(true);

    /*
     * The cycle must never make Pathfinder
     * revisit a file.
     */
    const visitedPaths = onboarding.steps.map((step) => step.filePath);

    expect(new Set(visitedPaths).size).toBe(visitedPaths.length);

    /*
     * All five files should eventually be
     * represented because maxSteps = 5.
     */
    expect(onboarding.steps).toHaveLength(5);

    expect(onboarding.steps.map((step) => step.order)).toEqual([1, 2, 3, 4, 5]);

    /*
     * The result must be deterministic.
     */
    expect(
      buildRepositoryOnboardingPath({
        graphAnalysis,

        metrics,

        deepAnalysis,

        maxSteps: 5,
      }),
    ).toEqual(onboarding);
  }, 20_000);
});
