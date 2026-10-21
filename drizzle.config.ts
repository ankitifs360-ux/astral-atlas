import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';

import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL && existsSync('.env')) {
  loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for Drizzle.');
}

if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
  throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
}

export default defineConfig({
  dialect: 'postgresql',

  schema: './packages/database/src/schema.ts',

  out: './packages/database/drizzle',

  dbCredentials: {
    url: databaseUrl,
  },

  strict: true,
  verbose: true,
});
