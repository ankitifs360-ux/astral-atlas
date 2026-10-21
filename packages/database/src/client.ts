import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export interface DatabaseOptions {
  maxConnections?: number;
  connectionTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export function createDatabase(connectionString: string, options: DatabaseOptions = {}) {
  if (connectionString.trim().length === 0) {
    throw new Error('Database connection string cannot be empty.');
  }

  const pool = new Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: options.idleTimeoutMs ?? 30_000,
  });

  const db = drizzle({
    client: pool,
    schema,
  });

  return {
    db,
    pool,

    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
