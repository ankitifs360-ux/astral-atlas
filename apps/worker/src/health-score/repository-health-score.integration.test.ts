import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRepositoryGraph } from '../graph/repository-graph.js';

import { createChurnInputsFromGitHistory } from '../metrics/git-history-churn.js';

import { calculateRepositoryMetrics } from '../metrics/repository-metrics.js';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { analyzeRepositoryDeeply } from '../deep-analysis/repository-deep-analysis.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from '../deep-analysis/thresholds.js';

import { calculateRepositoryHealthScore } from './repository-health-score.js';

import type { DeepAnalysisThresholds } from '../deep-analysis/thresholds.js';

describe('repository health score integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-health-score-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    /*
     * core.ts:
     *
     * - complexity = 2
     * - imports service.ts
     * - unresolved import
     * - part of a dependency cycle
     */
    await writeFile(
      join(repositoryRoot, 'src', 'core.ts'),
      `
import {
  runService,
} from './service.js';

import {
  missingHelper,
} from './missing-helper.js';

export function runCore(
  enabled: boolean,
) {
  if (enabled) {
    return runService();
  }

  return missingHelper();
}
          `,
      'utf8',
    );

    /*
     * Creates:
     *
     * core.ts -> service.ts
     * service.ts -> core.ts
     */
    await writeFile(
      join(repositoryRoot, 'src', 'service.ts'),
      `
import {
  runCore,
} from './core.js';

export function runService() {
  return runCore(false);
}
          `,
      'utf8',
    );

    /*
     * Adds another dependent of core.ts and
     * one valid external package import.
     */
    await writeFile(
      join(repositoryRoot, 'src', 'entry.ts'),
      `
import express from 'express';

import {
  runCore,
} from './core.js';

export function start() {
  const app = express();

  runCore(true);

  return app;
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

  it('calculates an explainable health score from real repository analysis', async () => {
    /*
     * B5
     */
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/core.ts',
      },

      {
        relativePath: 'src/service.ts',
      },

      {
        relativePath: 'src/entry.ts',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    /*
     * B6 + B7
     */
    const graphAnalysis = buildRepositoryGraph(parsed.parsed);

    expect(graphAnalysis.cycles).toHaveLength(1);

    /*
     * B8 structure inputs.
     */
    const structureInputs = await Promise.all(
      parsed.parsed.map(async (parsedFile) => ({
        parsedFile,

        source: await readFile(join(repositoryRoot, parsedFile.filePath), 'utf8'),
      })),
    );

    /*
     * Simulated bounded Git history:
     *
     * core.ts    = 3 commits
     * service.ts = 1 commit
     * entry.ts   = 0 commits
     */
    const churnInputs = createChurnInputsFromGitHistory(
      graphAnalysis.graph.nodes.map((node) => node.filePath),
      [
        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/core.ts',
        },

        {
          commitSha: 'b'.repeat(40),

          filePath: 'src/core.ts',
        },

        {
          commitSha: 'c'.repeat(40),

          filePath: 'src/core.ts',
        },

        {
          commitSha: 'd'.repeat(40),

          filePath: 'src/service.ts',
        },
      ],
    );

    const metrics = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs,

      churnInputs,
    });

    expect(metrics.summary).toMatchObject({
      fileCount: 3,

      internalDependencyCount: 3,

      externalImportCount: 1,

      unresolvedImportCount: 1,

      cyclicComponentCount: 1,

      cyclicFileCount: 2,

      historyAvailable: true,
    });

    /*
     * Use lower thresholds because this is a
     * deliberately tiny repository.
     *
     * Production defaults remain unchanged.
     */
    const thresholds: DeepAnalysisThresholds = {
      ...DEFAULT_DEEP_ANALYSIS_THRESHOLDS,

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

        high: 2,
      },

      hotspotSignalCount: {
        medium: 2,

        high: 3,
      },
    };

    /*
     * B9
     */
    const deepAnalysis = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,

      thresholds,
    });

    expect(deepAnalysis.findings.length).toBeGreaterThan(0);

    expect(
      deepAnalysis.hotspots.some(
        (hotspot) => hotspot.filePath === 'src/core.ts' && hotspot.signalCount === 5,
      ),
    ).toBe(true);

    /*
     * B10
     */
    const healthScore = calculateRepositoryHealthScore({
      deepAnalysis,

      analyzedFileCount: metrics.summary.fileCount,
    });

    /*
     * Expected breakdown:
     *
     * Maintainability
     * medium complexity on core.ts
     *
     * 25 - 5 = 20
     *
     *
     * Change Risk
     * core.ts is medium churn but also a
     * high hotspot containing churn
     *
     * 20 - 7 = 13
     *
     *
     * Dependency Health
     * core/service affected by cycle and
     * blast-radius findings
     *
     * 25 - 10 = 15
     *
     *
     * Coupling
     * core/service/entry all participate in
     * fan-in or fan-out findings
     *
     * 20 - 15 = 5
     *
     *
     * Resolution Quality
     * core.ts has one low unresolved-import
     * finding
     *
     * 10 - 1 = 9
     *
     *
     * TOTAL
     *
     * 20 + 13 + 15 + 5 + 9
     * = 62
     */
    expect(healthScore).toMatchObject({
      score: 62,

      rating: 'fair',

      analyzedFileCount: 3,
    });

    expect(
      healthScore.dimensions.map((dimension) => ({
        dimension: dimension.dimension,

        score: dimension.score,

        maxScore: dimension.maxScore,

        deductedPoints: dimension.deductedPoints,
      })),
    ).toEqual([
      {
        dimension: 'maintainability',

        score: 20,

        maxScore: 25,

        deductedPoints: 5,
      },

      {
        dimension: 'change-risk',

        score: 13,

        maxScore: 20,

        deductedPoints: 7,
      },

      {
        dimension: 'dependency-health',

        score: 15,

        maxScore: 25,

        deductedPoints: 10,
      },

      {
        dimension: 'coupling',

        score: 5,

        maxScore: 20,

        deductedPoints: 15,
      },

      {
        dimension: 'resolution-quality',

        score: 9,

        maxScore: 10,

        deductedPoints: 1,
      },
    ]);

    /*
     * Every deduction remains explainable.
     */
    expect(
      healthScore.dimensions.every(
        (dimension) => dimension.deductedPoints === 0 || dimension.deductions.length > 0,
      ),
    ).toBe(true);

    /*
     * Dimension scores must always add up
     * exactly to the repository score.
     */
    expect(healthScore.dimensions.reduce((total, dimension) => total + dimension.score, 0)).toBe(
      healthScore.score,
    );
  }, 20_000);
});
