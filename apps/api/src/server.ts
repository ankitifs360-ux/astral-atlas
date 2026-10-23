import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@astral-atlas/database';

import { buildApp } from './app.js';
import { parseApiConfig } from './config.js';

import { GitHubClient } from './modules/ingestion/github-client.js';

import { AnalysisEventHub, connectAnalysisQueueEvents } from './queues/analysis-event-hub.js';

import { createAnalysisQueueEvents } from './queues/analysis-events.js';

import { createAnalysisQueue } from './queues/analysis-queue.js';

import { createRedisClient } from './redis.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

/*
 * Validate all environment configuration once
 * during API startup.
 */
const config = parseApiConfig(process.env);

/*
 * PostgreSQL.
 */
const database = createDatabase(config.databaseUrl);

/*
 * Redis connection owned by the API.
 */
const redis = createRedisClient(config.redis);

/*
 * BullMQ producer queue.
 *
 * Submission routes add repository-analysis
 * jobs here. Heavy analysis still happens only
 * inside the worker process.
 */
const analysisQueue = createAnalysisQueue(redis);

/*
 * GitHub metadata client.
 *
 * The API uses this only to resolve:
 *
 * repository URL
 *      ↓
 * exact immutable commit SHA
 *
 * It does NOT clone or analyse the repository
 * inside the HTTP request.
 */
const githubClient = new GitHubClient(
  config.githubToken === undefined
    ? {}
    : {
        token: config.githubToken,
      },
);

/*
 * QueueEvents uses its own Redis connection.
 *
 * It receives global worker events such as:
 *
 * progress
 * completed
 * failed
 */
const analysisQueueEvents = createAnalysisQueueEvents(config.redis);

/*
 * In-memory fan-out for SSE clients.
 *
 * BullMQ QueueEvents
 *        ↓
 * AnalysisEventHub
 *        ↓
 * browser SSE connection
 */
const analysisEventHub = new AnalysisEventHub();

/*
 * Forward BullMQ events into the SSE hub.
 */
const disconnectAnalysisQueueEvents = connectAnalysisQueueEvents(
  analysisQueueEvents,
  analysisEventHub,
);

const app = await buildApp({
  config,

  /*
   * Completed-analysis REST routes and
   * submission dedupe state both use the
   * same PostgreSQL database.
   */
  database: database.db,

  /*
   * Real production submission dependencies.
   */
  analysisSubmission: {
    analysisQueue,

    githubClient,

    /*
     * ZIPs are staged here before the worker
     * consumes them.
     *
     * In Docker, API and worker will mount the
     * same shared volume at this location.
     */
    zipStagingDirectory: config.zipStagingDirectory ?? '/tmp/astral-atlas/zip-staging',
  },

  /*
   * Same hub used by QueueEvents above.
   */
  analysisEventHub,

  readinessProbe: async () => {
    const [databaseResult, redisResult] = await Promise.allSettled([database.ping(), redis.ping()]);

    return {
      database: databaseResult.status === 'fulfilled' ? 'up' : 'down',

      redis: redisResult.status === 'fulfilled' ? 'up' : 'down',
    };
  },

  closeResources: async () => {
    /*
     * Stop publishing new events into the
     * application-level SSE hub.
     */
    disconnectAnalysisQueueEvents();

    /*
     * Close BullMQ before closing the Redis
     * connection used by the producer queue.
     *
     * QueueEvents owns a separate Redis
     * connection internally.
     */
    await Promise.allSettled([analysisQueueEvents.close(), analysisQueue.close()]);

    /*
     * Finally close PostgreSQL and Redis.
     */
    await Promise.allSettled([database.close(), redis.quit()]);
  },
});

/*
 * QueueEvents is a long-running EventEmitter.
 *
 * Always listen for errors so Redis failures do
 * not become unhandled EventEmitter errors.
 */
analysisQueueEvents.on('error', (error) => {
  app.log.error(
    {
      err: error,
    },
    'BullMQ QueueEvents error',
  );
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  app.log.info(
    {
      signal,
    },
    'Shutdown signal received',
  );

  try {
    /*
     * app.close() triggers the onClose hook
     * registered in buildApp(), which then
     * runs closeResources().
     */
    await app.close();

    app.log.info('API shutdown completed');

    process.exitCode = 0;
  } catch (error: unknown) {
    app.log.error(
      {
        err: error,
      },
      'API shutdown failed',
    );

    process.exitCode = 1;
  }
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

try {
  /*
   * Connect QueueEvents before accepting HTTP
   * traffic so early analysis events are not
   * missed.
   */
  await analysisQueueEvents.waitUntilReady();

  await app.listen({
    host: config.host,

    port: config.port,
  });
} catch (error: unknown) {
  app.log.error(
    {
      err: error,
    },
    'API failed to start',
  );

  /*
   * app.close() also runs closeResources(),
   * cleaning up:
   *
   * QueueEvents
   * Queue
   * PostgreSQL
   * Redis
   */
  await app.close().catch(() => undefined);

  process.exitCode = 1;
}
