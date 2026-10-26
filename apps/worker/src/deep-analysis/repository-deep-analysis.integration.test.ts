import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildRepositoryGraph } from '../graph/repository-graph.js';

import { createChurnInputsFromGitHistory } from '../metrics/git-history-churn.js';

import { calculateRepositoryMetrics } from '../metrics/repository-metrics.js';

import { ParserThreadPool } from '../parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from '../parsing/repository-parser.js';

import { analyzeRepositoryDeeply } from './repository-deep-analysis.js';

import { DEFAULT_GOD_FILE_RISK_THRESHOLDS } from './god-file-risk-thresholds.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from './thresholds.js';

import type { AnalysisFindingSeverity } from './types.js';

import type { GodFileRiskThresholds } from './god-file-risk-thresholds.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

function severityRank(severity: AnalysisFindingSeverity): number {
  switch (severity) {
    case 'high':
      return 0;

    case 'medium':
      return 1;

    case 'low':
      return 2;
  }
}

describe('repository deep analysis integration', () => {
  let repositoryRoot: string;

  let pool: ParserThreadPool;

  beforeAll(async () => {
    repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-deep-analysis-'));

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    /*
     * core.ts:
     *
     * - imports service.ts
     * - has one unresolved import
     * - participates in a dependency cycle
     * - has cyclomatic complexity 2
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
     * service.ts imports core.ts.
     *
     * This creates:
     *
     * core.ts -> service.ts
     * service.ts -> core.ts
     *
     * therefore a real two-file SCC.
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
     * entry.ts depends on core.ts.
     *
     * It also has an external package import.
     * The external package must NOT become an
     * unresolved-import B9 finding.
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

  it('runs parsing, resolution, graph, metrics, and deep analysis together', async () => {
    /*
     * B5:
     * Real Tree-sitter parsing through the
     * worker-thread parser pool.
     */
    const parsed = await parseRepositoryFiles(pool, repositoryRoot, [
      {
        relativePath: 'src/service.ts',
      },

      {
        relativePath: 'src/entry.ts',
      },

      {
        relativePath: 'src/core.ts',
      },
    ]);

    expect(parsed.skipped).toEqual([]);

    expect(parsed.parsed).toHaveLength(3);

    /*
     * B6 + B7:
     *
     * Resolve imports, build dependency graph,
     * index it, and detect SCC cycles.
     */
    const graphAnalysis = buildRepositoryGraph(parsed.parsed);

    expect(graphAnalysis.graph.nodes).toHaveLength(3);

    expect(graphAnalysis.graph.edges).toHaveLength(3);

    /*
     * Internal edges:
     *
     * core    -> service
     * service -> core
     * entry   -> core
     */
    expect(graphAnalysis.cycles).toHaveLength(1);

    const dependencyCycle = graphAnalysis.cycles[0];

    if (dependencyCycle === undefined) {
      throw new Error('Expected one dependency cycle');
    }

    expect([...dependencyCycle.nodeIds].sort()).toEqual(['src/core.ts', 'src/service.ts']);

    /*
     * B6 should distinguish:
     *
     * ./missing-helper.js
     *   -> unresolved
     *
     * express
     *   -> external
     */
    expect(
      graphAnalysis.resolvedImports.some(
        (resolvedImport) =>
          resolvedImport.specifier === './missing-helper.js' &&
          resolvedImport.kind === 'unresolved' &&
          resolvedImport.reason === 'target-not-found',
      ),
    ).toBe(true);

    expect(
      graphAnalysis.resolvedImports.some(
        (resolvedImport) =>
          resolvedImport.specifier === 'express' &&
          resolvedImport.kind === 'external' &&
          resolvedImport.reason === 'external-package',
      ),
    ).toBe(true);

    /*
     * B8 structure metrics need the original
     * source text alongside the parse result.
     */
    const structureInputs = await Promise.all(
      parsed.parsed.map(async (parsedFile) => ({
        parsedFile,

        source: await readFile(join(repositoryRoot, parsedFile.filePath), 'utf8'),
      })),
    );

    /*
     * Simulated bounded Git history.
     *
     * core.ts:
     *   3 distinct commits
     *
     * service.ts:
     *   1 commit
     *
     * entry.ts:
     *   0 commits
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

    /*
     * B8:
     * Calculate actual graph, complexity,
     * structure, cycle, blast-radius, and
     * churn metrics.
     */
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

      totalChangedCommitCount: 4,

      maxChangedCommitCount: 3,
    });

    const core = metrics.files.find((file) => file.filePath === 'src/core.ts');

    expect(core).toMatchObject({
      dependencies: {
        fanIn: 2,

        fanOut: 1,
      },

      blastRadius: {
        affectedFileCount: 2,
      },

      cycles: {
        inDependencyCycle: true,

        cyclicComponentSize: 2,
      },

      structure: {
        cyclomaticComplexity: 2,
      },

      churn: {
        changedCommitCount: 3,
      },
    });

    /*
     * Lower thresholds only for this tiny
     * integration repository.
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
     * B15.3:
     *
     * Lower only the god-file thresholds for this
     * tiny integration repository.
     *
     * core.ts activates:
     *
     * - functionCount
     * - cyclomaticComplexity
     *
     * service.ts and entry.ts activate only the
     * function-count signal, so they must not be
     * classified as god-file risks.
     */
    const godFileRiskThresholds: GodFileRiskThresholds = {
      ...DEFAULT_GOD_FILE_RISK_THRESHOLDS,

      functionCount: {
        medium: 1,

        high: 2,
      },

      classCount: {
        medium: 10,

        high: 20,
      },

      cyclomaticComplexity: {
        medium: 2,

        high: 4,
      },

      fanOut: {
        medium: 3,

        high: 5,
      },

      changedCommitCount: {
        medium: 4,

        high: 6,
      },

      signalCount: {
        medium: 2,

        high: 4,
      },
    };

    /*
     * B9 + B15.3:
     * Turn B8 facts + B7 graph information
     * into explainable findings/hotspots.
     */
    const deepAnalysis = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,

      thresholds,

      godFileRiskThresholds,
    });

    const findingKinds = new Set(deepAnalysis.findings.map((finding) => finding.kind));

    expect(findingKinds).toEqual(
      new Set([
        'dependency-cycle',
        'unresolved-imports',
        'high-complexity',
        'high-churn',
        'large-blast-radius',
        'high-fan-in',
        'high-fan-out',
        'hotspot',
        'god-file-risk',
      ]),
    );

    /*
     * B15.3:
     *
     * Real parser + graph + metric output for
     * core.ts must produce exactly one
     * explainable god-file-risk finding.
     */
    const godFileRiskFindings = deepAnalysis.findings.filter(
      (finding) => finding.kind === 'god-file-risk',
    );

    expect(godFileRiskFindings).toHaveLength(1);

    expect(godFileRiskFindings[0]).toMatchObject({
      severity: 'medium',

      filePaths: ['src/core.ts'],
    });

    expect(godFileRiskFindings[0]?.evidence).toEqual([
      {
        metric: 'godFileRiskSignalCount',

        value: 2,

        threshold: 2,
      },

      {
        metric: 'functionCount',

        value: 1,

        threshold: 1,
      },

      {
        metric: 'cyclomaticComplexity',

        value: 2,

        threshold: 2,
      },
    ]);

    /*
     * The missing relative import produces
     * exactly one unresolved-import finding.
     *
     * "express" must not appear as one.
     */
    const unresolvedFindings = deepAnalysis.findings.filter(
      (finding) => finding.kind === 'unresolved-imports',
    );

    expect(unresolvedFindings).toHaveLength(1);

    expect(unresolvedFindings[0]).toMatchObject({
      severity: 'low',

      filePaths: ['src/core.ts'],

      evidence: [
        {
          metric: 'unresolvedImportCount',

          value: 1,
        },

        {
          metric: 'targetNotFoundCount',

          value: 1,
        },

        {
          metric: 'unsupportedSpecifierCount',

          value: 0,
        },
      ],
    });

    /*
     * The real SCC becomes one B9 cycle
     * finding for the pair, not duplicate
     * per-file findings.
     */
    const cycleFindings = deepAnalysis.findings.filter(
      (finding) => finding.kind === 'dependency-cycle',
    );

    expect(cycleFindings).toHaveLength(1);

    expect(cycleFindings[0]).toMatchObject({
      severity: 'medium',

      filePaths: ['src/core.ts', 'src/service.ts'],
    });

    /*
     * core.ts activates all five hotspot
     * signals:
     *
     * complexity
     * churn
     * blast radius
     * fan-in
     * cycle
     */
    const coreHotspot = deepAnalysis.hotspots.find((hotspot) => hotspot.filePath === 'src/core.ts');

    expect(coreHotspot).toEqual({
      filePath: 'src/core.ts',

      highComplexity: true,

      highChurn: true,

      largeBlastRadius: true,

      highFanIn: true,

      inDependencyCycle: true,

      signalCount: 5,
    });

    expect(
      deepAnalysis.findings.some(
        (finding) =>
          finding.kind === 'hotspot' &&
          finding.filePaths.includes('src/core.ts') &&
          finding.severity === 'high',
      ),
    ).toBe(true);

    /*
     * Final repository output must obey the
     * global deterministic severity ordering:
     *
     * high -> medium -> low
     */
    const ranks = deepAnalysis.findings.map((finding) => severityRank(finding.severity));

    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  }, 20_000);
});
