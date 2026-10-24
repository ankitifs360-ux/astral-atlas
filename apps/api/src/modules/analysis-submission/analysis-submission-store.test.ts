import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@astral-atlas/database';

import {
  AnalysisSubmissionStore,
  type AnalysisSubmissionSource,
} from './analysis-submission-store.js';

const REPOSITORY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const ANALYSIS_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function createGitHubSource(): AnalysisSubmissionSource {
  return {
    sourceType: 'github',

    sourceKey: 'github:facebook/react',

    revision: 'a'.repeat(40),

    githubOwner: 'facebook',

    githubName: 'react',

    canonicalUrl: 'https://github.com/facebook/react',

    defaultBranch: 'main',
  };
}

function createZipSource(): AnalysisSubmissionSource {
  return {
    sourceType: 'zip',

    sourceKey: `zip:${'b'.repeat(64)}`,

    revision: 'b'.repeat(64),
  };
}

function createThenableBuilder(response: readonly unknown[]) {
  const builder: {
    values: ReturnType<typeof vi.fn>;

    onConflictDoUpdate: ReturnType<typeof vi.fn>;

    onConflictDoNothing: ReturnType<typeof vi.fn>;

    returning: ReturnType<typeof vi.fn>;

    from: ReturnType<typeof vi.fn>;

    where: ReturnType<typeof vi.fn>;

    limit: ReturnType<typeof vi.fn>;

    set: ReturnType<typeof vi.fn>;

    then: Promise<readonly unknown[]>['then'];
  } = {
    values: vi.fn(() => builder),

    onConflictDoUpdate: vi.fn(() => builder),

    onConflictDoNothing: vi.fn(() => builder),

    returning: vi.fn(() => builder),

    from: vi.fn(() => builder),

    where: vi.fn(() => builder),

    limit: vi.fn(() => builder),

    set: vi.fn(() => builder),

    then: (onFulfilled, onRejected) => Promise.resolve(response).then(onFulfilled, onRejected),
  };

  return builder;
}

interface FakeDatabaseOptions {
  insertResponses?: readonly (readonly unknown[])[];

  selectResponses?: readonly (readonly unknown[])[];

  updateResponses?: readonly (readonly unknown[])[];
}

function createFakeDatabase(options: FakeDatabaseOptions = {}) {
  const insertResponses = [...(options.insertResponses ?? [])];

  const selectResponses = [...(options.selectResponses ?? [])];

  const updateResponses = [...(options.updateResponses ?? [])];

  const insertBuilders: ReturnType<typeof createThenableBuilder>[] = [];

  const selectBuilders: ReturnType<typeof createThenableBuilder>[] = [];

  const updateBuilders: ReturnType<typeof createThenableBuilder>[] = [];

  const transactionDatabase = {
    insert: vi.fn(() => {
      const response = insertResponses.shift();

      if (response === undefined) {
        throw new Error('Unexpected insert call');
      }

      const builder = createThenableBuilder(response);

      insertBuilders.push(builder);

      return builder;
    }),

    select: vi.fn(() => {
      const response = selectResponses.shift();

      if (response === undefined) {
        throw new Error('Unexpected select call');
      }

      const builder = createThenableBuilder(response);

      selectBuilders.push(builder);

      return builder;
    }),

    update: vi.fn(() => {
      const response = updateResponses.shift();

      if (response === undefined) {
        throw new Error('Unexpected update call');
      }

      const builder = createThenableBuilder(response);

      updateBuilders.push(builder);

      return builder;
    }),
  };

  const database = {
    transaction: vi.fn(async (callback) => callback(transactionDatabase)),
  } as unknown as Database;

  return {
    database,

    transactionDatabase,

    insertBuilders,

    selectBuilders,

    updateBuilders,
  };
}

describe('AnalysisSubmissionStore', () => {
  it('atomically creates a new queued analysis when the revision does not already exist', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [
          {
            id: ANALYSIS_ID,
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'created',

      status: 'queued',
    });

    expect(fake.transactionDatabase.insert).toHaveBeenCalledTimes(2);

    expect(fake.transactionDatabase.select).not.toHaveBeenCalled();

    expect(fake.transactionDatabase.update).not.toHaveBeenCalled();

    expect(fake.insertBuilders[0]?.onConflictDoUpdate).toHaveBeenCalledTimes(1);

    expect(fake.insertBuilders[1]?.onConflictDoNothing).toHaveBeenCalledTimes(1);
  });

  it('loads the existing analysis when the atomic insert loses a duplicate-revision race', async () => {
    const fake = createFakeDatabase({
      /*
       * Repository upsert succeeds.
       *
       * Analysis INSERT returns [] because
       * ON CONFLICT DO NOTHING lost the race.
       */
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'queued',
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'existing',

      status: 'queued',
    });

    expect(fake.insertBuilders[1]?.onConflictDoNothing).toHaveBeenCalledTimes(1);

    expect(fake.transactionDatabase.select).toHaveBeenCalledTimes(1);
  });

  it('returns a persistent cache hit for a completed analysis', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'completed',
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'cached',

      status: 'completed',
    });

    expect(fake.transactionDatabase.update).not.toHaveBeenCalled();
  });

  it.each([
    ['queued', 'queued'],

    ['running', 'running'],
  ] as const)('reuses an existing %s analysis', async (_label, status) => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status,
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'existing',

      status,
    });

    expect(fake.transactionDatabase.update).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'failed'],

    ['partial', 'partial'],
  ] as const)(
    'atomically resets a %s analysis so it can be queued again',
    async (_label, status) => {
      const fake = createFakeDatabase({
        insertResponses: [
          [
            {
              id: REPOSITORY_ID,
            },
          ],

          [],
        ],

        selectResponses: [
          [
            {
              id: ANALYSIS_ID,

              status,
            },
          ],
        ],

        updateResponses: [
          [
            {
              id: ANALYSIS_ID,
            },
          ],
        ],
      });

      const store = new AnalysisSubmissionStore(fake.database);

      await expect(store.prepareSubmission(createZipSource())).resolves.toEqual({
        repositoryId: REPOSITORY_ID,

        analysisId: ANALYSIS_ID,

        state: 'requeued',

        status: 'queued',
      });

      expect(fake.transactionDatabase.update).toHaveBeenCalledTimes(1);

      expect(fake.updateBuilders[0]?.set).toHaveBeenCalledWith({
        status: 'queued',

        errorCode: null,

        errorMessage: null,

        warningCount: 0,

        fileCount: 0,

        startedAt: null,

        completedAt: null,
      });
    },
  );

  it('reuses the winner when another request claims a failed retry first', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      /*
       * First SELECT sees failed.
       *
       * Our conditional UPDATE then returns
       * no row because another request won.
       *
       * Second SELECT sees queued.
       */
      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'failed',
          },
        ],

        [
          {
            id: ANALYSIS_ID,

            status: 'queued',
          },
        ],
      ],

      updateResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'existing',

      status: 'queued',
    });

    expect(fake.transactionDatabase.select).toHaveBeenCalledTimes(2);

    expect(fake.transactionDatabase.update).toHaveBeenCalledTimes(1);
  });

  it('returns a cache hit when another concurrent retry completes before reload', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'failed',
          },
        ],

        [
          {
            id: ANALYSIS_ID,

            status: 'completed',
          },
        ],
      ],

      updateResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).resolves.toEqual({
      repositoryId: REPOSITORY_ID,

      analysisId: ANALYSIS_ID,

      state: 'cached',

      status: 'completed',
    });
  });

  it('stores ZIP repositories without GitHub metadata', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [
          {
            id: ANALYSIS_ID,
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await store.prepareSubmission(createZipSource());

    expect(fake.insertBuilders[0]?.values).toHaveBeenCalledWith({
      sourceType: 'zip',

      sourceKey: `zip:${'b'.repeat(64)}`,

      githubOwner: null,

      githubName: null,

      canonicalUrl: null,

      defaultBranch: null,
    });

    expect(fake.insertBuilders[1]?.values).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,

      commitSha: 'b'.repeat(64),

      status: 'queued',
    });
  });

  it('normalizes surrounding whitespace before repository and analysis creation', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [
          {
            id: ANALYSIS_ID,
          },
        ],
      ],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await store.prepareSubmission({
      sourceType: 'github',

      sourceKey: '  github:facebook/react  ',

      revision: `  ${'a'.repeat(40)}  `,

      githubOwner: '  facebook  ',

      githubName: '  react  ',

      canonicalUrl: '  https://github.com/facebook/react  ',

      defaultBranch: '  main  ',
    });

    expect(fake.insertBuilders[0]?.values).toHaveBeenCalledWith({
      sourceType: 'github',

      sourceKey: 'github:facebook/react',

      githubOwner: 'facebook',

      githubName: 'react',

      canonicalUrl: 'https://github.com/facebook/react',

      defaultBranch: 'main',
    });

    expect(fake.insertBuilders[1]?.values).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,

      commitSha: 'a'.repeat(40),

      status: 'queued',
    });
  });

  it.each([
    [
      'sourceKey',

      {
        ...createGitHubSource(),

        sourceKey: '   ',
      },
    ],

    [
      'revision',

      {
        ...createGitHubSource(),

        revision: '   ',
      },
    ],

    [
      'githubOwner',

      {
        ...createGitHubSource(),

        githubOwner: '   ',
      },
    ],

    [
      'githubName',

      {
        ...createGitHubSource(),

        githubName: '   ',
      },
    ],

    [
      'canonicalUrl',

      {
        ...createGitHubSource(),

        canonicalUrl: '   ',
      },
    ],

    [
      'defaultBranch',

      {
        ...createGitHubSource(),

        defaultBranch: '   ',
      },
    ],
  ] as const)('rejects empty %s before querying PostgreSQL', async (label, source) => {
    const fake = createFakeDatabase();

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(source as AnalysisSubmissionSource)).rejects.toThrow(
      `${label} cannot be empty`,
    );

    expect(fake.database.transaction).not.toHaveBeenCalled();
  });

  it('throws when repository upsert unexpectedly returns no row', async () => {
    const fake = createFakeDatabase({
      insertResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).rejects.toThrow(
      'Failed to create or load repository record',
    );
  });

  it('throws when an analysis conflict occurs but the existing row cannot be loaded', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).rejects.toThrow(
      'Analysis conflict occurred but the existing analysis could not be loaded',
    );
  });

  it('throws when a concurrently changed retry analysis disappears before reload', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'failed',
          },
        ],

        [],
      ],

      updateResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).rejects.toThrow(
      `Analysis "${ANALYSIS_ID}" disappeared while preparing retry`,
    );
  });

  it('does not enqueue another retry when the row remains terminal after losing the retry race', async () => {
    const fake = createFakeDatabase({
      insertResponses: [
        [
          {
            id: REPOSITORY_ID,
          },
        ],

        [],
      ],

      selectResponses: [
        [
          {
            id: ANALYSIS_ID,

            status: 'failed',
          },
        ],

        [
          {
            id: ANALYSIS_ID,

            status: 'partial',
          },
        ],
      ],

      updateResponses: [[]],
    });

    const store = new AnalysisSubmissionStore(fake.database);

    await expect(store.prepareSubmission(createGitHubSource())).rejects.toThrow(
      `Analysis "${ANALYSIS_ID}" remained "partial" after a concurrent retry attempt`,
    );
  });
});
