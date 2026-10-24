import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@astral-atlas/database';

import { createAnalysisJobProcessor } from './analysis-processor.js';
import { createAnalysisWorker } from './analysis-worker.js';
import { parseWorkerConfig } from './config.js';
import { NodeRepositorySourcePreparer } from './node-repository-source-preparer.js';
import { AnalysisStore } from './persistence/analysis-store.js';
import { createWorkerRedisClient } from './redis.js';
import { checkoutGitHubCommit } from './worker-git-checkout.js';
import { loadGitHistoryTouches } from './worker-git-history.js';
import { extractZipArchive } from './worker-zip-extractor.js';

type LogLevel = 'info' | 'error';

function writeLog(level: LogLevel, message: string, details: Record<string, unknown> = {}): void {
  const entry = {
    level,
    time: new Date().toISOString(),
    service: 'astral-atlas-worker',
    message,
    ...details,
  };

  const line = `${JSON.stringify(entry)}\n`;

  if (level === 'error') {
    process.stderr.write(line);

    return;
  }

  process.stdout.write(line);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    error: String(error),
  };
}

/*
 * pnpm --filter changes the working directory to
 * apps/worker, so resolve the root .env relative
 * to this source file instead of process.cwd().
 */
const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

const config = parseWorkerConfig(process.env);

/*
 * ------------------------------------------------------------------
 * Infrastructure
 * ------------------------------------------------------------------
 */

const database = createDatabase(config.databaseUrl);

const redis = createWorkerRedisClient(config.redis);

/*
 * ------------------------------------------------------------------
 * Persistence
 * ------------------------------------------------------------------
 *
 * Completed analyses are written to PostgreSQL through
 * AnalysisStore.
 */
const analysisStore = new AnalysisStore(database.db);

/*
 * ------------------------------------------------------------------
 * Repository preparation
 * ------------------------------------------------------------------
 *
 * The worker owns its Git checkout and ZIP extraction
 * implementations instead of importing API implementation files.
 */
const sourcePreparer = new NodeRepositorySourcePreparer({
  /*
   * NodeRepositorySourcePreparer only needs to know that
   * checkout completed successfully.
   *
   * checkoutGitHubCommit also returns the verified SHA,
   * which has already been checked internally.
   */
  checkoutGitHubCommit: async (input) => {
    await checkoutGitHubCommit(input);
  },

  extractZipArchive,
});

/*
 * ------------------------------------------------------------------
 * Production analysis processor
 * ------------------------------------------------------------------
 *
 * Supplying dependencies here activates the real analysis pipeline:
 *
 * repository preparation
 * → parsing
 * → dependency graph
 * → Git churn
 * → metrics
 * → deep analysis
 * → health score
 * → onboarding
 * → PostgreSQL persistence
 *
 * ZIP analyses automatically skip Git history because
 * analysis-processor only requests history for GitHub sources.
 */
const processor = createAnalysisJobProcessor(redis, {
  sourcePreparer,

  analysisStore,

  loadGitHistoryTouches,
});

const worker = createAnalysisWorker(redis, processor);

/*
 * Attach event listeners BEFORE worker.run().
 *
 * analysis-worker.ts uses:
 *
 * autorun: false
 *
 * so no job can begin before observability listeners
 * are registered.
 */
worker.on('active', (job) => {
  writeLog('info', 'Analysis job started', {
    jobId: job.id ?? null,

    analysisId: job.data.analysisId,

    attempt: job.attemptsMade + 1,
  });
});

worker.on('progress', (job, progress) => {
  writeLog('info', 'Analysis progress updated', {
    jobId: job.id ?? null,

    analysisId: job.data.analysisId,

    progress,
  });
});

worker.on('completed', (job, result) => {
  writeLog('info', 'Analysis job completed', {
    jobId: job.id ?? null,

    analysisId: job.data.analysisId,

    result,
  });
});

worker.on('failed', (job, error) => {
  writeLog('error', 'Analysis job failed', {
    jobId: job?.id ?? null,

    analysisId: job?.data.analysisId ?? null,

    ...serializeError(error),
  });
});

/*
 * BullMQ Worker must always have an error listener.
 *
 * Otherwise certain Redis/EventEmitter failures may
 * become unhandled errors.
 */
worker.on('error', (error) => {
  writeLog('error', 'BullMQ worker error', serializeError(error));
});

let shuttingDown = false;

async function shutdown(reason: NodeJS.Signals | 'STARTUP_FAILURE'): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  writeLog('info', 'Worker shutdown started', {
    reason,
  });

  /*
   * Stop accepting new BullMQ jobs first.
   *
   * worker.close() waits for the currently running
   * job to finish by default.
   */
  await worker.close().catch((error: unknown) => {
    writeLog('error', 'Failed to close BullMQ worker cleanly', serializeError(error));
  });

  /*
   * No analysis should be persisting after the
   * worker has closed, so PostgreSQL can shut down.
   */
  await database.close().catch((error: unknown) => {
    writeLog('error', 'Failed to close PostgreSQL cleanly', serializeError(error));
  });

  /*
   * Redis must close after BullMQ because the
   * worker still depends on it during shutdown.
   */
  if (redis.status === 'ready') {
    await redis.quit().catch((error: unknown) => {
      writeLog('error', 'Redis QUIT failed', serializeError(error));

      redis.disconnect();
    });
  } else {
    redis.disconnect();
  }

  writeLog('info', 'Worker shutdown completed');
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  /*
   * Fail fast before consuming jobs.
   *
   * A worker without PostgreSQL or Redis must not
   * accept analysis work that it cannot complete.
   */
  await Promise.all([database.ping(), redis.ping()]);

  /*
   * autorun=false means this is the exact point
   * where BullMQ starts consuming jobs.
   *
   * Do not await run() because it stays active for
   * the process lifetime.
   */
  void worker.run().catch(async (error: unknown) => {
    writeLog('error', 'Analysis worker stopped unexpectedly', serializeError(error));

    process.exitCode = 1;

    await shutdown('STARTUP_FAILURE');
  });

  writeLog('info', 'Analysis worker started', {
    redisHost: config.redis.host,

    redisPort: config.redis.port,

    redisDatabase: config.redis.database,

    database: 'connected',

    gitHistory: 'enabled',
  });
} catch (error: unknown) {
  writeLog('error', 'Analysis worker failed to start', serializeError(error));

  process.exitCode = 1;

  await shutdown('STARTUP_FAILURE');
}
