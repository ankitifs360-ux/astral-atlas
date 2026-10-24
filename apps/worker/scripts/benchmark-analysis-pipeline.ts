import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { analyzeRepositoryDeeply } from '../src/deep-analysis/repository-deep-analysis.js';
import { buildRepositoryGraph } from '../src/graph/repository-graph.js';
import { calculateRepositoryHealthScore } from '../src/health-score/repository-health-score.js';
import { calculateRepositoryMetrics } from '../src/metrics/repository-metrics.js';
import { buildRepositoryOnboardingPath } from '../src/onboarding/repository-onboarding.js';
import { ParserThreadPool } from '../src/parsing/parser-thread-pool.js';
import { parseRepositoryFiles } from '../src/parsing/repository-parser.js';
import { scanRepositorySourceFiles } from '../src/parsing/repository-source-files.js';

const DEFAULT_FILE_COUNT = 500;
const DEFAULT_MEASURED_ROUNDS = 3;
const DEFAULT_WARMUP_ROUNDS = 1;

interface PhaseTimings {
  scanMs: number;
  parseMs: number;
  sourceLoadMs: number;
  graphMs: number;
  metricsMs: number;
  deepAnalysisMs: number;
  healthScoreMs: number;
  onboardingMs: number;
  parserCloseMs: number;
  totalMs: number;
}

interface BenchmarkRoundResult {
  timings: PhaseTimings;
  analyzedFileCount: number;
  edgeCount: number;
  findingCount: number;
  onboardingStepCount: number;
  healthScore: number;
  throughputFilesPerSecond: number;
  rssBeforeBytes: number;
  peakObservedRssBytes: number;
  rssAfterBytes: number;
}

function readPositiveIntegerEnvironmentVariable(name: string, defaultValue: number): number {
  const rawValue = process.env[name];

  if (rawValue === undefined) {
    return defaultValue;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function formatFileIndex(index: number): string {
  return index.toString().padStart(4, '0');
}

function createModuleSource(index: number): string {
  const currentSuffix = formatFileIndex(index);

  if (index === 0) {
    return [
      `export function compute${currentSuffix}(input: number): number {`,
      '  if (input < 0) {',
      '    return -input;',
      '  }',
      '',
      `  return input + ${index};`,
      '}',
      '',
    ].join('\n');
  }

  const previousSuffix = formatFileIndex(index - 1);

  const imports = [`import { compute${previousSuffix} } from './module${previousSuffix}.js';`];

  const expressions = [`compute${previousSuffix}(input)`];

  /*
   * Add a second internal dependency periodically.
   *
   * This prevents the benchmark repository from being only
   * one trivial linear chain while still remaining deterministic.
   */
  if (index >= 10 && index % 10 === 0) {
    const secondarySuffix = formatFileIndex(index - 10);

    imports.push(`import { compute${secondarySuffix} } from './module${secondarySuffix}.js';`);

    expressions.push(`compute${secondarySuffix}(input)`);
  }

  return [
    ...imports,
    '',
    `export function compute${currentSuffix}(input: number): number {`,
    '  if (input % 2 === 0) {',
    `    return ${expressions.join(' + ')} + ${index};`,
    '  }',
    '',
    `  return input + ${index};`,
    '}',
    '',
    `export class Service${currentSuffix} {`,
    '  run(input: number): number {',
    `    return compute${currentSuffix}(input);`,
    '  }',
    '}',
    '',
  ].join('\n');
}

function createEntrySource(lastModuleIndex: number): string {
  const lastSuffix = formatFileIndex(lastModuleIndex);

  return [
    `import { compute${lastSuffix} } from './module${lastSuffix}.js';`,
    '',
    'export function start(input: number): number {',
    `  return compute${lastSuffix}(input);`,
    '}',
    '',
  ].join('\n');
}

async function createBenchmarkRepository(requestedFileCount: number): Promise<string> {
  /*
   * Keep one file reserved for the repository entry point.
   */
  if (requestedFileCount < 2) {
    throw new Error('Benchmark repository must contain at least 2 files.');
  }

  const repositoryRoot = await mkdtemp(join(tmpdir(), 'astral-atlas-worker-benchmark-'));

  const sourceDirectory = join(repositoryRoot, 'src');

  await mkdir(sourceDirectory, {
    recursive: true,
  });

  const moduleCount = requestedFileCount - 1;

  await Promise.all(
    Array.from(
      {
        length: moduleCount,
      },
      async (_unused, index) => {
        const suffix = formatFileIndex(index);

        await writeFile(
          join(sourceDirectory, `module${suffix}.ts`),
          createModuleSource(index),
          'utf8',
        );
      },
    ),
  );

  await writeFile(join(sourceDirectory, 'entry.ts'), createEntrySource(moduleCount - 1), 'utf8');

  return repositoryRoot;
}

function observeRss(currentPeakBytes: number): number {
  return Math.max(currentPeakBytes, process.memoryUsage().rss);
}

async function measureAsync<T>(operation: () => Promise<T>): Promise<{
  value: T;
  durationMs: number;
}> {
  const startedAt = performance.now();

  const value = await operation();

  return {
    value,
    durationMs: performance.now() - startedAt,
  };
}

function measureSync<T>(operation: () => T): {
  value: T;
  durationMs: number;
} {
  const startedAt = performance.now();

  const value = operation();

  return {
    value,
    durationMs: performance.now() - startedAt,
  };
}

async function runAnalysisRound(repositoryRoot: string): Promise<BenchmarkRoundResult> {
  const totalStartedAt = performance.now();

  const rssBeforeBytes = process.memoryUsage().rss;

  let peakObservedRssBytes = rssBeforeBytes;

  const pool = new ParserThreadPool();

  try {
    const scanResult = await measureAsync(() => scanRepositorySourceFiles(repositoryRoot));

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const parseResult = await measureAsync(() =>
      parseRepositoryFiles(
        pool,
        repositoryRoot,
        scanResult.value.sourceFiles.map((file) => ({
          relativePath: file.relativePath,
        })),
      ),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    if (parseResult.value.parsed.length === 0) {
      throw new Error('Benchmark parser produced zero analyzed files.');
    }

    if (parseResult.value.skipped.length > 0) {
      throw new Error(
        `Benchmark unexpectedly skipped ${parseResult.value.skipped.length} parser files.`,
      );
    }

    if (scanResult.value.skippedFiles.length > 0) {
      throw new Error(
        `Benchmark unexpectedly skipped ${scanResult.value.skippedFiles.length} scanner files.`,
      );
    }

    const sourceLoadResult = await measureAsync(async () =>
      Promise.all(
        parseResult.value.parsed.map(async (parsedFile) => ({
          parsedFile,

          source: await readFile(join(repositoryRoot, parsedFile.filePath), 'utf8'),
        })),
      ),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const graphResult = measureSync(() => buildRepositoryGraph(parseResult.value.parsed));

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const metricsResult = measureSync(() =>
      calculateRepositoryMetrics({
        graphAnalysis: graphResult.value,

        structureInputs: sourceLoadResult.value,
      }),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const deepAnalysisResult = measureSync(() =>
      analyzeRepositoryDeeply({
        metrics: metricsResult.value,

        graphAnalysis: graphResult.value,
      }),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const healthScoreResult = measureSync(() =>
      calculateRepositoryHealthScore({
        deepAnalysis: deepAnalysisResult.value,

        analyzedFileCount: metricsResult.value.summary.fileCount,
      }),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const onboardingResult = measureSync(() =>
      buildRepositoryOnboardingPath({
        graphAnalysis: graphResult.value,

        metrics: metricsResult.value,

        deepAnalysis: deepAnalysisResult.value,
      }),
    );

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const parserCloseResult = await measureAsync(async () => {
      await pool.close();
    });

    const parserCloseMs = parserCloseResult.durationMs;

    peakObservedRssBytes = observeRss(peakObservedRssBytes);

    const totalMs = performance.now() - totalStartedAt;

    const analyzedFileCount = metricsResult.value.summary.fileCount;

    return {
      timings: {
        scanMs: scanResult.durationMs,
        parseMs: parseResult.durationMs,
        sourceLoadMs: sourceLoadResult.durationMs,
        graphMs: graphResult.durationMs,
        metricsMs: metricsResult.durationMs,
        deepAnalysisMs: deepAnalysisResult.durationMs,
        healthScoreMs: healthScoreResult.durationMs,
        onboardingMs: onboardingResult.durationMs,
        parserCloseMs,
        totalMs,
      },

      analyzedFileCount,

      edgeCount: graphResult.value.graph.edges.length,

      findingCount: deepAnalysisResult.value.findings.length,

      onboardingStepCount: onboardingResult.value.steps.length,

      healthScore: healthScoreResult.value.score,

      throughputFilesPerSecond: analyzedFileCount / (totalMs / 1_000),

      rssBeforeBytes,

      peakObservedRssBytes,

      rssAfterBytes: process.memoryUsage().rss,
    };
  } catch (error) {
    /*
     * close() is idempotent enough for the benchmark cleanup path.
     * If normal close already happened, this is never reached.
     */
    await pool.close().catch(() => undefined);

    throw error;
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate median of an empty value set.');
  }

  const sorted = [...values].sort((left, right) => left - right);

  const middleIndex = Math.floor(sorted.length / 2);

  const middleValue = sorted[middleIndex];

  if (middleValue === undefined) {
    throw new Error('Median calculation produced an invalid middle index.');
  }

  if (sorted.length % 2 === 1) {
    return middleValue;
  }

  const leftValue = sorted[middleIndex - 1];

  if (leftValue === undefined) {
    throw new Error('Median calculation produced an invalid left index.');
  }

  return (leftValue + middleValue) / 2;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate percentile of an empty value set.');
  }

  const sorted = [...values].sort((left, right) => left - right);

  const rank = Math.ceil((percentileValue / 100) * sorted.length);

  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));

  const value = sorted[index];

  if (value === undefined) {
    throw new Error('Percentile calculation produced an invalid index.');
  }

  return value;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate average of an empty value set.');
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toMiB(bytes: number): number {
  return bytes / (1024 * 1024);
}

function printRound(roundNumber: number, result: BenchmarkRoundResult): void {
  console.log(
    [
      `Round ${roundNumber}:`,
      `${result.timings.totalMs.toFixed(2)} ms total`,
      `${result.throughputFilesPerSecond.toFixed(2)} files/s`,
      `${toMiB(result.peakObservedRssBytes).toFixed(2)} MiB peak observed RSS`,
    ].join(' '),
  );
}

function printPhaseSummary(results: readonly BenchmarkRoundResult[]): void {
  const phases: {
    label: string;
    select: (result: BenchmarkRoundResult) => number;
  }[] = [
    {
      label: 'scan',
      select: (result) => result.timings.scanMs,
    },
    {
      label: 'parse',
      select: (result) => result.timings.parseMs,
    },
    {
      label: 'source load',
      select: (result) => result.timings.sourceLoadMs,
    },
    {
      label: 'graph',
      select: (result) => result.timings.graphMs,
    },
    {
      label: 'metrics',
      select: (result) => result.timings.metricsMs,
    },
    {
      label: 'deep analysis',
      select: (result) => result.timings.deepAnalysisMs,
    },
    {
      label: 'health score',
      select: (result) => result.timings.healthScoreMs,
    },
    {
      label: 'onboarding',
      select: (result) => result.timings.onboardingMs,
    },
    {
      label: 'parser close',
      select: (result) => result.timings.parserCloseMs,
    },
  ];

  console.log('\nMedian phase timings:');

  for (const phase of phases) {
    const values = results.map(phase.select);

    console.log(`  ${phase.label.padEnd(15)} ${median(values).toFixed(2)} ms`);
  }
}

function printSummary(results: readonly BenchmarkRoundResult[]): void {
  if (results.length === 0) {
    throw new Error('Cannot print benchmark summary without measured results.');
  }

  const totalTimes = results.map((result) => result.timings.totalMs);

  const throughputs = results.map((result) => result.throughputFilesPerSecond);

  const peakRssValues = results.map((result) => result.peakObservedRssBytes);

  const rssGrowthValues = results.map((result) => result.rssAfterBytes - result.rssBeforeBytes);

  const representativeResult = results.at(-1);

  if (representativeResult === undefined) {
    throw new Error('Benchmark summary is missing a representative result.');
  }

  console.log('\nWorker analysis benchmark summary');

  console.log(`  analyzed files       ${representativeResult.analyzedFileCount}`);

  console.log(`  graph edges          ${representativeResult.edgeCount}`);

  console.log(`  findings             ${representativeResult.findingCount}`);

  console.log(`  onboarding steps     ${representativeResult.onboardingStepCount}`);

  console.log(`  health score         ${representativeResult.healthScore}`);

  console.log('');

  console.log(`  median total         ${median(totalTimes).toFixed(2)} ms`);

  console.log(`  p95 total            ${percentile(totalTimes, 95).toFixed(2)} ms`);

  console.log(`  average total        ${average(totalTimes).toFixed(2)} ms`);

  console.log(`  median throughput    ${median(throughputs).toFixed(2)} files/s`);

  console.log(`  max observed RSS     ${toMiB(Math.max(...peakRssValues)).toFixed(2)} MiB`);

  console.log(`  max RSS delta        ${toMiB(Math.max(...rssGrowthValues)).toFixed(2)} MiB`);

  printPhaseSummary(results);
}

async function main(): Promise<void> {
  const fileCount = readPositiveIntegerEnvironmentVariable('BENCHMARK_FILES', DEFAULT_FILE_COUNT);

  const measuredRounds = readPositiveIntegerEnvironmentVariable(
    'BENCHMARK_ROUNDS',
    DEFAULT_MEASURED_ROUNDS,
  );

  const warmupRounds = readPositiveIntegerEnvironmentVariable(
    'BENCHMARK_WARMUP_ROUNDS',
    DEFAULT_WARMUP_ROUNDS,
  );

  console.log('Astral Atlas worker analysis benchmark');

  console.log(`Fixture: ${fileCount} deterministic TypeScript files`);

  console.log(`Rounds: ${measuredRounds} measured + ${warmupRounds} warmup`);

  console.log(
    'Pipeline: scan -> Tree-sitter parse -> graph -> metrics -> deep analysis -> health -> onboarding',
  );

  const repositoryRoot = await createBenchmarkRepository(fileCount);

  try {
    for (let warmupIndex = 0; warmupIndex < warmupRounds; warmupIndex += 1) {
      await runAnalysisRound(repositoryRoot);
    }

    const results: BenchmarkRoundResult[] = [];

    for (let roundIndex = 0; roundIndex < measuredRounds; roundIndex += 1) {
      const result = await runAnalysisRound(repositoryRoot);

      results.push(result);

      printRound(roundIndex + 1, result);
    }

    printSummary(results);
  } finally {
    await rm(repositoryRoot, {
      recursive: true,

      force: true,
    });
  }
}

await main().catch((error: unknown) => {
  console.error(
    'Worker analysis benchmark failed:',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );

  process.exitCode = 1;
});
