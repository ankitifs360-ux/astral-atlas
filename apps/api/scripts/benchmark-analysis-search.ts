import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import {
  analyses,
  createDatabase,
  eq,
  files,
  repositories,
  symbols,
  type Database,
} from '@astral-atlas/database';

import type { FastifyInstance } from 'fastify';

import { AnalysisSearchStore } from '../src/modules/analysis-results/analysis-search-store.js';
import { registerAnalysisSearchRoute } from '../src/routes/analysis-search.js';

const FILE_COUNT = 1_000;
const SYMBOLS_PER_FILE = 5;

const WARMUP_REQUESTS = 25;
const MEASURED_REQUESTS = 200;

const SEARCH_QUERY = 'benchmark-target';
const SEARCH_LIMIT = 20;

const INSERT_BATCH_SIZE = 500;

type FileInsert = typeof files.$inferInsert;
type SymbolInsert = typeof symbols.$inferInsert;

interface BenchmarkResult {
  latenciesMs: number[];
  totalDurationMs: number;
}

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} environment variable is required.`);
  }

  return value;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate percentile from an empty data set.');
  }

  const sorted = [...values].sort((left, right) => left - right);

  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);

  return sorted[index] ?? 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate average from an empty data set.');
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createBatches<T>(values: readonly T[], batchSize: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }

  return batches;
}

async function seedBenchmarkData(
  database: Database,
  repositoryId: string,
  analysisId: string,
): Promise<void> {
  await database.insert(repositories).values({
    id: repositoryId,
    sourceType: 'github',
    sourceKey: `github:benchmark/${repositoryId}`,
    githubOwner: 'benchmark',
    githubName: `search-${repositoryId}`,
    canonicalUrl: `https://github.com/benchmark/search-${repositoryId}`,
    defaultBranch: 'main',
  });

  const commitSha = randomUUID().replaceAll('-', '').padEnd(40, '0');

  await database.insert(analyses).values({
    id: analysisId,
    repositoryId,
    commitSha,
    status: 'completed',
    warningCount: 0,
    fileCount: FILE_COUNT,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  const fileRows: FileInsert[] = Array.from(
    {
      length: FILE_COUNT,
    },
    (_, index) => {
      const matchesSearch = index % 25 === 0;

      const path = matchesSearch
        ? `src/features/benchmark-target/file-${index}.ts`
        : `src/features/module-${index}/file-${index}.ts`;

      return {
        id: randomUUID(),
        analysisId,
        path,
        language: 'typescript',
        sizeBytes: 1_024 + index,
        contentHash: index.toString(16).padStart(64, '0'),
        sourceContent: `export const value${index} = ${index};`,
        isSupported: true,
        parseStatus: 'analyzed',
      };
    },
  );

  for (const batch of createBatches(fileRows, INSERT_BATCH_SIZE)) {
    await database.insert(files).values(batch);
  }

  const symbolRows: SymbolInsert[] = [];

  for (let fileIndex = 0; fileIndex < fileRows.length; fileIndex += 1) {
    const file = fileRows[fileIndex];

    if (file?.id === undefined) {
      throw new Error(`Seeded file ${fileIndex} does not have an ID.`);
    }

    for (let symbolIndex = 0; symbolIndex < SYMBOLS_PER_FILE; symbolIndex += 1) {
      const matchesSearch = symbolIndex === 0 && fileIndex % 20 === 0;

      const symbolName = matchesSearch
        ? `benchmark-target-handler-${fileIndex}`
        : `function${fileIndex}_${symbolIndex}`;

      const startLine = symbolIndex * 10 + 1;

      symbolRows.push({
        id: randomUUID(),
        fileId: file.id,
        kind: 'function',
        name: symbolName,
        qualifiedName: symbolName,
        startLine,
        startColumn: 0,
        endLine: startLine + 4,
        endColumn: 1,
        isExported: symbolIndex === 0,
        complexity: symbolIndex + 1,
      });
    }
  }

  for (const batch of createBatches(symbolRows, INSERT_BATCH_SIZE)) {
    await database.insert(symbols).values(batch);
  }
}

async function createBenchmarkApp(database: Database): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const searchStore = new AnalysisSearchStore(database);

  registerAnalysisSearchRoute(app, searchStore);

  await app.ready();

  return app;
}

async function executeSearch(app: FastifyInstance, analysisId: string): Promise<number> {
  const startedAt = performance.now();

  const response = await app.inject({
    method: 'GET',
    url:
      `/api/analyses/${analysisId}/search` +
      `?q=${encodeURIComponent(SEARCH_QUERY)}` +
      `&limit=${SEARCH_LIMIT}`,
  });

  const durationMs = performance.now() - startedAt;

  if (response.statusCode !== 200) {
    throw new Error(
      `Expected search status 200, received ${response.statusCode}: ${response.body}`,
    );
  }

  return durationMs;
}

async function warmUp(app: FastifyInstance, analysisId: string): Promise<void> {
  for (let request = 0; request < WARMUP_REQUESTS; request += 1) {
    await executeSearch(app, analysisId);
  }
}

async function benchmarkSearch(app: FastifyInstance, analysisId: string): Promise<BenchmarkResult> {
  const latenciesMs: number[] = [];

  const startedAt = performance.now();

  for (let request = 0; request < MEASURED_REQUESTS; request += 1) {
    latenciesMs.push(await executeSearch(app, analysisId));
  }

  return {
    latenciesMs,
    totalDurationMs: performance.now() - startedAt,
  };
}

async function main(): Promise<void> {
  const databaseUrl = requireEnvironmentVariable('DATABASE_URL');

  const repositoryId = randomUUID();
  const analysisId = randomUUID();

  const database = createDatabase(databaseUrl, {
    maxConnections: 10,
  });

  let app: FastifyInstance | undefined;

  try {
    await database.ping();

    console.log('Astral Atlas PostgreSQL search benchmark');
    console.log('----------------------------------------');
    console.log(`Files: ${FILE_COUNT}`);
    console.log(`Symbols: ${FILE_COUNT * SYMBOLS_PER_FILE}`);
    console.log(`Search query: ${SEARCH_QUERY}`);
    console.log(`Result limit: ${SEARCH_LIMIT}`);
    console.log('');

    console.log('Seeding benchmark repository...');

    await seedBenchmarkData(database.db, repositoryId, analysisId);

    console.log('Seed complete.');
    console.log('');

    app = await createBenchmarkApp(database.db);

    console.log(`Warm-up requests: ${WARMUP_REQUESTS}`);

    await warmUp(app, analysisId);

    console.log(`Measured requests: ${MEASURED_REQUESTS}`);
    console.log('');

    const result = await benchmarkSearch(app, analysisId);

    const { latenciesMs, totalDurationMs } = result;

    const requestsPerSecond = MEASURED_REQUESTS / (totalDurationMs / 1_000);

    console.log('Results');
    console.log('-------');

    console.log(`Search latency p50: ${percentile(latenciesMs, 50).toFixed(2)} ms`);
    console.log(`Search latency p95: ${percentile(latenciesMs, 95).toFixed(2)} ms`);
    console.log(`Search latency p99: ${percentile(latenciesMs, 99).toFixed(2)} ms`);
    console.log(`Search latency average: ${average(latenciesMs).toFixed(2)} ms`);
    console.log(`Search latency min: ${Math.min(...latenciesMs).toFixed(2)} ms`);
    console.log(`Search latency max: ${Math.max(...latenciesMs).toFixed(2)} ms`);
    console.log(`Sequential throughput: ${requestsPerSecond.toFixed(2)} req/s`);
  } finally {
    if (app !== undefined) {
      await app.close();
    }

    await database.db.delete(repositories).where(eq(repositories.id, repositoryId));

    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error('Search benchmark failed.');
  console.error(error);

  process.exitCode = 1;
});
