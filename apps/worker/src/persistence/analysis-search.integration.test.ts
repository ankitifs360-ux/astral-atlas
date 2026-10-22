import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyses, createDatabase, eq, files, repositories, symbols } from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import { AnalysisSearchStore } from './analysis-search.js';

const runDatabaseIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true';

const describeDatabase = runDatabaseIntegrationTests ? describe : describe.skip;

let databaseClient: ReturnType<typeof createDatabase> | undefined;

function requireDatabase(): Database {
  if (databaseClient === undefined) {
    throw new Error('Integration-test database has not been initialized.');
  }

  return databaseClient.db;
}

function createRevision(value: string): string {
  return value.replaceAll('-', '').padEnd(64, '0').slice(0, 64);
}

async function createRepository(): Promise<string> {
  const db = requireDatabase();

  const uniqueId = crypto.randomUUID();

  const rows = await db
    .insert(repositories)
    .values({
      sourceType: 'zip',
      sourceKey: `zip:b12-search:${uniqueId}`,
    })
    .returning({
      id: repositories.id,
    });

  const row = rows[0];

  if (row === undefined) {
    throw new Error('Failed to create search integration-test repository.');
  }

  return row.id;
}

async function createAnalysis(
  repositoryId: string,
  status: 'running' | 'completed',
): Promise<string> {
  const db = requireDatabase();

  const uniqueId = crypto.randomUUID();

  const rows = await db
    .insert(analyses)
    .values({
      repositoryId,
      commitSha: createRevision(uniqueId),
      status,
      completedAt: status === 'completed' ? new Date() : null,
    })
    .returning({
      id: analyses.id,
    });

  const row = rows[0];

  if (row === undefined) {
    throw new Error('Failed to create search integration-test analysis.');
  }

  return row.id;
}

async function seedCompletedAnalysis(analysisId: string): Promise<void> {
  const db = requireDatabase();

  const fileRows = await db
    .insert(files)
    .values([
      {
        analysisId,
        path: 'src/alpha.ts',
        language: 'typescript',
        sizeBytes: 100,
        contentHash: 'a'.repeat(64),
        isSupported: true,
        parseStatus: 'analyzed',
      },
      {
        analysisId,
        path: 'src/percent%file.ts',
        language: 'typescript',
        sizeBytes: 120,
        contentHash: 'b'.repeat(64),
        isSupported: true,
        parseStatus: 'analyzed',
      },
      {
        analysisId,
        path: 'src/user_service.ts',
        language: 'typescript',
        sizeBytes: 140,
        contentHash: 'c'.repeat(64),
        isSupported: true,
        parseStatus: 'analyzed',
      },
    ])
    .returning({
      id: files.id,
      path: files.path,
    });

  const fileIdByPath = new Map(fileRows.map((row) => [row.path, row.id]));

  const alphaFileId = fileIdByPath.get('src/alpha.ts');

  const percentFileId = fileIdByPath.get('src/percent%file.ts');

  const underscoreFileId = fileIdByPath.get('src/user_service.ts');

  if (alphaFileId === undefined || percentFileId === undefined || underscoreFileId === undefined) {
    throw new Error('Failed to seed search integration-test files.');
  }

  await db.insert(symbols).values([
    {
      fileId: alphaFileId,
      kind: 'function',
      name: 'alphaFunction',
      qualifiedName: 'alphaFunction',
      startLine: 1,
      startColumn: 0,
      endLine: 5,
      endColumn: 1,
      isExported: true,
      complexity: 1,
    },
    {
      fileId: percentFileId,
      kind: 'function',
      name: 'percent%Helper',
      qualifiedName: 'percent%Helper',
      startLine: 10,
      startColumn: 0,
      endLine: 20,
      endColumn: 1,
      isExported: false,
      complexity: 2,
    },
    {
      fileId: underscoreFileId,
      kind: 'class',
      name: 'User_Service',
      qualifiedName: 'User_Service',
      startLine: 3,
      startColumn: 0,
      endLine: 30,
      endColumn: 1,
      isExported: true,
      complexity: 3,
    },
  ]);
}

async function deleteRepository(repositoryId: string): Promise<void> {
  await requireDatabase().delete(repositories).where(eq(repositories.id, repositoryId));
}

describeDatabase('AnalysisSearchStore PostgreSQL integration', () => {
  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;

    if (connectionString === undefined || connectionString.trim().length === 0) {
      throw new Error('DATABASE_URL must be set when RUN_DB_INTEGRATION_TESTS=true.');
    }

    databaseClient = createDatabase(connectionString, {
      maxConnections: 2,
      connectionTimeoutMs: 5_000,
    });

    await databaseClient.ping();
  });

  afterAll(async () => {
    if (databaseClient !== undefined) {
      await databaseClient.close();

      databaseClient = undefined;
    }
  });

  it('searches persisted files and symbols case-insensitively', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'completed');

      await seedCompletedAnalysis(analysisId);

      const store = new AnalysisSearchStore(requireDatabase());

      const result = await store.search(analysisId, 'SERVICE');

      expect(result).not.toBeNull();

      expect(result?.files.map((file) => file.path)).toEqual(['src/user_service.ts']);

      expect(
        result?.symbols.map((symbol) => ({
          filePath: symbol.filePath,
          kind: symbol.kind,
          name: symbol.name,
          complexity: symbol.complexity,
        })),
      ).toEqual([
        {
          filePath: 'src/user_service.ts',
          kind: 'class',
          name: 'User_Service',
          complexity: 3,
        },
      ]);
    } finally {
      await deleteRepository(repositoryId);
    }
  });

  it('treats percent and underscore as literal search characters', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'completed');

      await seedCompletedAnalysis(analysisId);

      const store = new AnalysisSearchStore(requireDatabase());

      const percentResult = await store.search(analysisId, '%');

      expect(percentResult?.files.map((file) => file.path)).toEqual(['src/percent%file.ts']);

      expect(percentResult?.symbols.map((symbol) => symbol.name)).toEqual(['percent%Helper']);

      const underscoreResult = await store.search(analysisId, '_');

      expect(underscoreResult?.files.map((file) => file.path)).toEqual(['src/user_service.ts']);

      expect(underscoreResult?.symbols.map((symbol) => symbol.name)).toEqual(['User_Service']);
    } finally {
      await deleteRepository(repositoryId);
    }
  });

  it('returns empty arrays for a completed analysis with no matches', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'completed');

      await seedCompletedAnalysis(analysisId);

      const store = new AnalysisSearchStore(requireDatabase());

      await expect(store.search(analysisId, 'does-not-exist')).resolves.toEqual({
        analysisId,
        query: 'does-not-exist',
        files: [],
        symbols: [],
      });
    } finally {
      await deleteRepository(repositoryId);
    }
  });

  it('does not expose search results for a running analysis', async () => {
    const repositoryId = await createRepository();

    try {
      const analysisId = await createAnalysis(repositoryId, 'running');

      const store = new AnalysisSearchStore(requireDatabase());

      await expect(store.search(analysisId, 'alpha')).resolves.toBeNull();
    } finally {
      await deleteRepository(repositoryId);
    }
  });
});
