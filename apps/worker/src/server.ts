import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createAnalysisWorker } from './analysis-worker.js';
import { createAnalysisJobProcessor } from './analysis-processor.js';
import { parseWorkerConfig } from './config.js';
import { createWorkerRedisClient } from './redis.js';

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

const redis = createWorkerRedisClient(config.redis);

const processor = createAnalysisJobProcessor(redis);

const worker = createAnalysisWorker(redis, processor);
/*
 * Attach event listeners BEFORE worker.run().
 *
 * Because analysis-worker.ts uses:
 *
 * autorun: false
 *
 * no job can start before these listeners
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
 * A BullMQ Worker must always have an error
 * listener. Otherwise certain connection errors
 * can become unhandled EventEmitter errors.
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
   * worker.close() stops taking new jobs and,
   * by default, waits for the current job to
   * finish before closing.
   */
  await worker.close().catch((error: unknown) => {
    writeLog('error', 'Failed to close BullMQ worker cleanly', serializeError(error));
  });

  /*
   * Close the Redis connection only after the
   * BullMQ worker has stopped using it.
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
   * Because autorun=false, this is the point at
   * which the worker actually begins consuming
   * jobs from Redis.
   *
   * We intentionally do not await run() here:
   * it remains active for the lifetime of this
   * worker process.
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
  });
} catch (error: unknown) {
  writeLog('error', 'Analysis worker failed to start', serializeError(error));

  process.exitCode = 1;

  await shutdown('STARTUP_FAILURE');
}
