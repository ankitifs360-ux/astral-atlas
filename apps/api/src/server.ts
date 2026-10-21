import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '@astral-atlas/database';

import { buildApp } from './app.js';
import { parseApiConfig } from './config.js';
const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

const config = parseApiConfig(process.env);

const database = createDatabase(config.databaseUrl, {
  maxConnections: 10,
  connectionTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
});

const app = await buildApp({
  config,

  readinessProbe: async () => {
    await database.ping();
  },

  closeResources: async () => {
    await database.close();
  },
});

let shutdownStarted = false;

async function shutdown(signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;

  app.log.info(
    {
      signal,
    },
    'Graceful shutdown started',
  );

  try {
    await app.close();

    app.log.info('Graceful shutdown completed');
  } catch (error: unknown) {
    app.log.error(
      {
        err: error,
      },
      'Graceful shutdown failed',
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
  await app.listen({
    host: config.host,
    port: config.port,
  });
} catch (error: unknown) {
  app.log.fatal(
    {
      err: error,
    },
    'API failed to start',
  );

  await app.close();

  process.exitCode = 1;
}
