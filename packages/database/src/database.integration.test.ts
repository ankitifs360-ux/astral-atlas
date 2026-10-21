import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';

import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

if (!process.env.DATABASE_URL && existsSync('.env')) {
  loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for database integration tests.');
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 2,
});

afterAll(async () => {
  await pool.end();
});

describe('PostgreSQL schema integration', () => {
  it('contains all required application tables', async () => {
    const result = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tableNames = result.rows.map((row) => row.table_name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        'repositories',
        'analyses',
        'files',
        'symbols',
        'metrics',
        'edges',
        'issues',
        'issue_file_matches',
      ]),
    );
  });

  it('rejects duplicate analyses for the same repository and commit', async () => {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const sourceKey = `github:test-${randomUUID()}/astral-atlas`;

      const repositoryResult = await client.query<{ id: string }>(
        `
          INSERT INTO repositories (
            source_type,
            source_key,
            github_owner,
            github_name,
            canonical_url
          )
          VALUES ('github', $1, 'test-owner', 'test-repo', $2)
          RETURNING id
        `,
        [sourceKey, 'https://github.com/test-owner/test-repo'],
      );

      const repositoryId = repositoryResult.rows[0]?.id;

      if (!repositoryId) {
        throw new Error('Test repository insert did not return an id.');
      }

      const commitSha = 'a'.repeat(40);

      await client.query(
        `
          INSERT INTO analyses (repository_id, commit_sha)
          VALUES ($1, $2)
        `,
        [repositoryId, commitSha],
      );

      await expect(
        client.query(
          `
            INSERT INTO analyses (repository_id, commit_sha)
            VALUES ($1, $2)
          `,
          [repositoryId, commitSha],
        ),
      ).rejects.toMatchObject({
        code: '23505',
      });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
