import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import type { FastifyInstance } from 'fastify';

import type {
  GitHubClient,
  ResolvedGitHubRepository,
} from '../src/modules/ingestion/github-client.js';
import type { AnalysisSubmissionService } from '../src/modules/analysis-submission/analysis-submission-service.js';

import { registerAnalysisSubmissionRoutes } from '../src/routes/analysis-submission.js';

const REQUESTS_PER_ROUND = 100;
const BENCHMARK_ROUNDS = 5;
const WARMUP_REQUESTS = 20;

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';
const REPOSITORY_ID = '22222222-2222-2222-2222-222222222222';

const REPOSITORY_URL = 'https://github.com/facebook/react';

interface BenchmarkCounters {
  resolveRepositoryCalls: number;
  submitGitHubCalls: number;
}

interface BenchmarkApp {
  app: FastifyInstance;
  counters: BenchmarkCounters;
}

interface BatchResult {
  durationMs: number;
  latenciesMs: number[];
  throughputRequestsPerSecond: number;
  peakRssBytes: number;
  peakRssDeltaBytes: number;
}

function createResolvedRepository(): ResolvedGitHubRepository {
  return {
    owner: 'facebook',
    repo: 'react',
    canonicalUrl: REPOSITORY_URL,
    sourceKey: 'github:facebook/react',
    defaultBranch: 'main',
    commitSha: 'a'.repeat(40),
    cloneUrl: 'https://github.com/facebook/react.git',
    repositorySizeKb: 1_000,
  };
}

async function createBenchmarkApp(): Promise<BenchmarkApp> {
  const repository = createResolvedRepository();

  const counters: BenchmarkCounters = {
    resolveRepositoryCalls: 0,
    submitGitHubCalls: 0,
  };

  const githubClient = {
    resolveRepository: async () => {
      counters.resolveRepositoryCalls += 1;

      return repository;
    },
  } as unknown as GitHubClient;

  const submissionService = {
    submitGitHub: async () => {
      counters.submitGitHubCalls += 1;

      return {
        analysisId: ANALYSIS_ID,
        repositoryId: REPOSITORY_ID,
        status: 'queued' as const,
        state: 'created' as const,
        cacheHit: false,
      };
    },

    submitZip: async () => ({
      analysisId: ANALYSIS_ID,
      repositoryId: REPOSITORY_ID,
      status: 'queued' as const,
      state: 'created' as const,
      cacheHit: false,
    }),
  } as unknown as AnalysisSubmissionService;

  const app = Fastify({
    logger: false,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
    },
  });

  registerAnalysisSubmissionRoutes(app, {
    githubClient,
    submissionService,
    zipStagingDirectory: '/tmp/astral-atlas-benchmark',

    stageZip: async () => ({
      sourceKey: `zip:${'b'.repeat(64)}`,
      contentSha256: 'b'.repeat(64),
      archivePath: '/tmp/astral-atlas-benchmark/repository.zip',
      sizeBytes: 100,
    }),
  });

  await app.ready();

  return {
    app,
    counters,
  };
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) {
    throw new Error('Cannot calculate a percentile from an empty data set.');
  }

  const sorted = [...values].sort((left, right) => left - right);

  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);

  return sorted[index] ?? 0;
}

function median(values: readonly number[]): number {
  return percentile(values, 50);
}

function bytesToMiB(bytes: number): number {
  return bytes / (1024 * 1024);
}

async function injectSubmission(app: FastifyInstance): Promise<number> {
  const startedAt = performance.now();

  const response = await app.inject({
    method: 'POST',
    url: '/api/analyses/github',

    payload: {
      repositoryUrl: REPOSITORY_URL,
    },
  });

  const durationMs = performance.now() - startedAt;

  if (response.statusCode !== 202) {
    throw new Error(
      `Expected submission status 202, received ${response.statusCode}: ${response.body}`,
    );
  }

  return durationMs;
}

async function runBatch(app: FastifyInstance, requestCount: number): Promise<BatchResult> {
  const baselineRssBytes = process.memoryUsage().rss;

  let peakRssBytes = baselineRssBytes;

  const memorySampler = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  }, 1);

  const startedAt = performance.now();

  try {
    const latenciesMs = await Promise.all(
      Array.from(
        {
          length: requestCount,
        },
        () => injectSubmission(app),
      ),
    );

    const durationMs = performance.now() - startedAt;

    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);

    return {
      durationMs,
      latenciesMs,
      throughputRequestsPerSecond: requestCount / (durationMs / 1_000),
      peakRssBytes,
      peakRssDeltaBytes: Math.max(0, peakRssBytes - baselineRssBytes),
    };
  } finally {
    clearInterval(memorySampler);
  }
}

async function warmUp(app: FastifyInstance): Promise<void> {
  await Promise.all(
    Array.from(
      {
        length: WARMUP_REQUESTS,
      },
      () => injectSubmission(app),
    ),
  );
}

async function main(): Promise<void> {
  const { app, counters } = await createBenchmarkApp();

  try {
    console.log('Astral Atlas API submission benchmark');
    console.log('------------------------------------');
    console.log(`Warm-up requests: ${WARMUP_REQUESTS}`);
    console.log(`Requests per round: ${REQUESTS_PER_ROUND}`);
    console.log(`Benchmark rounds: ${BENCHMARK_ROUNDS}`);
    console.log('');

    await warmUp(app);

    counters.resolveRepositoryCalls = 0;
    counters.submitGitHubCalls = 0;

    const rounds: BatchResult[] = [];

    for (let round = 1; round <= BENCHMARK_ROUNDS; round += 1) {
      const result = await runBatch(app, REQUESTS_PER_ROUND);

      rounds.push(result);

      console.log(
        `Round ${round}: ${result.durationMs.toFixed(2)} ms, ` +
          `${result.throughputRequestsPerSecond.toFixed(2)} req/s`,
      );
    }

    const allLatencies = rounds.flatMap((round) => round.latenciesMs);
    const batchDurations = rounds.map((round) => round.durationMs);

    const throughputs = rounds.map((round) => round.throughputRequestsPerSecond);

    const maximumPeakRssBytes = Math.max(...rounds.map((round) => round.peakRssBytes));

    const maximumPeakRssDeltaBytes = Math.max(...rounds.map((round) => round.peakRssDeltaBytes));

    const expectedCalls = REQUESTS_PER_ROUND * BENCHMARK_ROUNDS;

    if (counters.resolveRepositoryCalls !== expectedCalls) {
      throw new Error(
        `Expected ${expectedCalls} repository resolutions, ` +
          `received ${counters.resolveRepositoryCalls}.`,
      );
    }

    if (counters.submitGitHubCalls !== expectedCalls) {
      throw new Error(
        `Expected ${expectedCalls} submission calls, ` + `received ${counters.submitGitHubCalls}.`,
      );
    }

    console.log('');
    console.log('Results');
    console.log('-------');
    console.log(`Measured requests: ${expectedCalls}`);

    console.log(`Request latency p50: ${percentile(allLatencies, 50).toFixed(2)} ms`);

    console.log(`Request latency p95: ${percentile(allLatencies, 95).toFixed(2)} ms`);

    console.log(`Request latency p99: ${percentile(allLatencies, 99).toFixed(2)} ms`);

    console.log(`Median 100-request batch: ${median(batchDurations).toFixed(2)} ms`);

    console.log(`Median throughput: ${median(throughputs).toFixed(2)} req/s`);

    console.log(`Peak process RSS: ${bytesToMiB(maximumPeakRssBytes).toFixed(2)} MiB`);

    console.log(
      `Maximum observed RSS increase: ${bytesToMiB(maximumPeakRssDeltaBytes).toFixed(2)} MiB`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('API submission benchmark failed.');
  console.error(error);

  process.exitCode = 1;
});
