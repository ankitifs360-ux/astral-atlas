import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { validateEnv } from './env-schema.js';

const envPath = '.env';

try {
  if (!existsSync(envPath)) {
    throw new Error('Missing .env file. Create it with: cp .env.example .env');
  }

  loadEnvFile(envPath);

  validateEnv(process.env);

  console.log('Environment validation passed.');
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown environment validation error';

  console.error(message);
  process.exitCode = 1;
}
