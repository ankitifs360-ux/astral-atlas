import { randomUUID } from 'node:crypto';

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
} from '@astral-atlas/shared';

import { UnrecoverableError } from 'bullmq';

import type { Redis } from 'ioredis';

import { describe, expect, it, vi } from 'vitest';

import * as analysisLockModule from './analysis-lock.js';

import {
  createAnalysisJobProcessor,
  processAnalysisJob,
  type AnalysisProcessorDependencies,
} from './analysis-processor.js';

import type { AnalysisJob } from './analysis-worker.js';

import { WORKER_REPOSITORY_SCAN_LIMITS } from './parsing/repository-source-files.js';

import type { PersistCompletedAnalysisInput } from './persistence/types.js';

import {
  createPreparedGitHubRepository,
  createPreparedZipRepository,
  type AnalysisSourcePreparer,
} from './repository-source-preparer.js';

vi.mock('./analysis-lock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof analysisLockModule>();

  return {
    ...actual,

    acquireAnalysisLock: vi.fn(),
  };
});

function createValidJobData(): AnalysisJobData {
  return {
    schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

    analysisId: randomUUID(),

    repositoryId: randomUUID(),

    source: {
      sourceType: 'github',

      owner: 'facebook',

      repo: 'react',

      canonicalUrl: 'https://github.com/facebook/react',

      sourceKey: 'github:facebook/react',

      commitSha: 'a'.repeat(40),
    },
  };
}

function createValidZipJobData(): AnalysisJobData {
  const contentSha256 = 'b'.repeat(64);

  return {
    schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

    analysisId: randomUUID(),

    repositoryId: randomUUID(),

    source: {
      sourceType: 'zip',

      sourceKey: `zip:${contentSha256}`,

      contentSha256,

      archivePath: '/tmp/astral-atlas-upload/example/repository.zip',
    },
  };
}

function createJob(
  options: {
    name?: string;

    data?: unknown;
  } = {},
): AnalysisJob {
  const updateProgress = vi.fn(async () => undefined);

  return {
    name: options.name ?? ANALYSIS_JOB_NAME,

    data: options.data ?? createValidJobData(),

    updateProgress,
  } as unknown as AnalysisJob;
}

function mockAcquiredAnalysisLock() {
  const lock = {
    key: 'analysis-lock:test',

    token: 'test-lock-token',

    extend: vi.fn(async () => true),

    release: vi.fn(async () => true),
  };

  vi.mocked(analysisLockModule.acquireAnalysisLock).mockResolvedValue(
    lock as unknown as NonNullable<
      Awaited<ReturnType<typeof analysisLockModule.acquireAnalysisLock>>
    >,
  );

  return lock;
}

function createAnalysisStore(
  options: {
    completed?: boolean;

    putError?: Error;
  } = {},
) {
  const getCompletedById = vi.fn(async () => {
    if (!options.completed) {
      return null;
    }

    /*
     * The processor only needs a non-null result
     * to know that this analysis already completed.
     *
     * Full reconstruction is covered by
     * AnalysisStore persistence tests.
     */
    return {};
  });

  const put = vi.fn(async (input: PersistCompletedAnalysisInput) => {
    /*
     * Keep the argument in the mock signature because
     * later tests inspect put.mock.calls[0][0].
     */
    void input;

    if (options.putError) {
      throw options.putError;
    }

    return {};
  });

  const store = {
    getCompletedById,

    put,
  } as unknown as AnalysisProcessorDependencies['analysisStore'];

  return {
    store,

    getCompletedById,

    put,
  };
}

async function createGitHubRepositoryFixture(data: AnalysisJobData) {
  if (data.source.sourceType !== 'github') {
    throw new Error('GitHub fixture requires a GitHub analysis source');
  }

  const rootDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-processor-test-'));

  const sourceDirectory = join(rootDirectory, 'src');

  await mkdir(sourceDirectory, {
    recursive: true,
  });

  await writeFile(
    join(sourceDirectory, 'helper.ts'),
    ['export function helper() {', "  return 'hello';", '}', ''].join('\n'),
    'utf8',
  );

  await writeFile(
    join(sourceDirectory, 'app.ts'),
    [
      "import { helper } from './helper.js';",
      '',
      'export function runApp() {',
      '  return helper();',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  const cleanup = vi.fn(async () => {
    await rm(rootDirectory, {
      recursive: true,

      force: true,
    });
  });

  const prepared = createPreparedGitHubRepository(
    data.source,

    rootDirectory,

    cleanup,
  );

  const prepare = vi.fn(async () => prepared);

  const sourcePreparer = {
    prepare,
  } as unknown as AnalysisSourcePreparer;

  return {
    rootDirectory,

    sourcePreparer,

    prepare,

    cleanup,
  };
}

async function createZipRepositoryFixture(data: AnalysisJobData) {
  if (data.source.sourceType !== 'zip') {
    throw new Error('ZIP fixture requires a ZIP analysis source');
  }

  const rootDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-processor-zip-test-'));

  const sourceDirectory = join(rootDirectory, 'src');

  await mkdir(sourceDirectory, {
    recursive: true,
  });

  await writeFile(
    join(sourceDirectory, 'index.ts'),
    ['export function start() {', '  return true;', '}', ''].join('\n'),
    'utf8',
  );

  const cleanup = vi.fn(async () => {
    await rm(rootDirectory, {
      recursive: true,

      force: true,
    });
  });

  const prepared = createPreparedZipRepository(
    data.source,

    rootDirectory,

    cleanup,
  );

  const prepare = vi.fn(async () => prepared);

  const sourcePreparer = {
    prepare,
  } as unknown as AnalysisSourcePreparer;

  return {
    rootDirectory,

    sourcePreparer,

    prepare,

    cleanup,
  };
}

describe('processAnalysisJob', () => {
  it('accepts a valid analysis job', async () => {
    const data = createValidJobData();

    const job = createJob({
      data,
    });

    const result = await processAnalysisJob(job);

    expect(result).toEqual({
      analysisId: data.analysisId,

      status: 'partial',
    });
  });

  it('reports structured ingestion progress', async () => {
    const data = createValidJobData();

    const job = createJob({
      data,
    });

    await processAnalysisJob(job);

    expect(job.updateProgress).toHaveBeenCalledTimes(1);

    expect(job.updateProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: data.analysisId,

        stage: 'ingesting',

        percent: 5,

        message: 'Worker accepted the analysis job.',
      }),
    );

    const updateProgressMock = vi.mocked(job.updateProgress);

    const progress = updateProgressMock.mock.calls[0]?.[0];

    expect(progress).toEqual(
      expect.objectContaining({
        timestamp: expect.any(String),
      }),
    );

    expect(
      Number.isNaN(
        Date.parse(
          (
            progress as {
              timestamp: string;
            }
          ).timestamp,
        ),
      ),
    ).toBe(false);
  });

  it('rejects an unsupported job name as unrecoverable', async () => {
    const job = createJob({
      name: 'something-else',
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('rejects an invalid commit SHA as unrecoverable', async () => {
    const validData = createValidJobData();

    const job = createJob({
      data: {
        ...validData,

        source: {
          ...validData.source,

          commitSha: 'not-a-valid-sha',
        },
      },
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('rejects an unsupported schema version as unrecoverable', async () => {
    const validData = createValidJobData();

    const job = createJob({
      data: {
        ...validData,

        schemaVersion: 999,
      },
    });

    await expect(processAnalysisJob(job)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(job.updateProgress).not.toHaveBeenCalled();
  });

  it('accepts a valid ZIP analysis job', async () => {
    const data = createValidZipJobData();

    const job = createJob({
      data,
    });

    const result = await processAnalysisJob(job);

    expect(result).toEqual({
      analysisId: data.analysisId,

      status: 'partial',
    });

    expect(job.updateProgress).toHaveBeenCalledTimes(1);
  });
});

describe('createAnalysisJobProcessor full pipeline', () => {
  it('analyses and persists a prepared GitHub repository', async () => {
    const data = createValidJobData();

    const repository = await createGitHubRepositoryFixture(data);

    const analysisStore = createAnalysisStore();

    const loadGitHistoryTouches = vi.fn(async () => {
      if (data.source.sourceType !== 'github') {
        throw new Error('Expected GitHub source');
      }

      return [
        {
          commitSha: data.source.commitSha,

          filePath: 'src/app.ts',
        },

        {
          commitSha: data.source.commitSha,

          filePath: 'src/helper.ts',
        },
      ];
    });

    const lock = mockAcquiredAnalysisLock();

    const processor = createAnalysisJobProcessor(
      {} as Redis,

      {
        sourcePreparer: repository.sourcePreparer,

        analysisStore: analysisStore.store,

        loadGitHistoryTouches,
      },
    );

    const job = createJob({
      data,
    });

    try {
      const result = await processor(job);

      expect(result).toEqual({
        analysisId: data.analysisId,

        status: 'completed',
      });

      expect(analysisStore.getCompletedById).toHaveBeenCalledWith(data.analysisId);

      expect(repository.prepare).toHaveBeenCalledTimes(1);

      expect(repository.prepare).toHaveBeenCalledWith(data.source);

      expect(loadGitHistoryTouches).toHaveBeenCalledTimes(1);

      expect(loadGitHistoryTouches).toHaveBeenCalledWith(repository.rootDirectory);

      expect(analysisStore.put).toHaveBeenCalledTimes(1);

      const persistenceInput = analysisStore.put.mock.calls[0]?.[0];

      expect(persistenceInput).toBeDefined();

      expect(persistenceInput).toEqual(
        expect.objectContaining({
          analysisId: data.analysisId,

          files: expect.any(Array),

          symbols: expect.any(Array),

          graphAnalysis: expect.any(Object),

          resolvedCalls: expect.any(Array),

          metrics: expect.any(Object),

          architectureRiskScores: expect.any(Array),

          findings: expect.any(Array),

          healthScore: expect.any(Object),

          onboarding: expect.any(Object),

          goodFirstTasks: expect.any(Object),

          newcomerChangeGuidance: expect.any(Object),
        }),
      );

      expect(persistenceInput?.files.map((file) => file.filePath)).toEqual([
        'src/app.ts',
        'src/helper.ts',
      ]);

      expect(persistenceInput?.architectureRiskScores).toEqual([
        {
          filePath: 'src/app.ts',

          riskScore: expect.any(Number),
        },

        {
          filePath: 'src/helper.ts',

          riskScore: expect.any(Number),
        },
      ]);

      for (const risk of persistenceInput?.architectureRiskScores ?? []) {
        expect(risk.riskScore).toBeGreaterThanOrEqual(0);

        expect(risk.riskScore).toBeLessThanOrEqual(100);
      }

      expect(persistenceInput?.goodFirstTasks.consideredFileCount).toBe(2);

      expect(persistenceInput?.goodFirstTasks.maxRecommendations).toBe(5);

      expect(
        persistenceInput?.goodFirstTasks.recommendations.map(
          (recommendation) => recommendation.filePath,
        ),
      ).toEqual(['src/app.ts', 'src/helper.ts']);

      for (const recommendation of persistenceInput?.goodFirstTasks.recommendations ?? []) {
        expect(recommendation.score).toBeGreaterThanOrEqual(0);

        expect(recommendation.score).toBeLessThanOrEqual(100);

        expect(recommendation.architectureRiskScore).toBeGreaterThanOrEqual(0);

        expect(recommendation.architectureRiskScore).toBeLessThanOrEqual(100);
      }

      expect(persistenceInput?.newcomerChangeGuidance?.consideredFileCount).toBe(2);

      expect(persistenceInput?.newcomerChangeGuidance?.maxRecommendations).toBe(5);

      expect(
        persistenceInput?.newcomerChangeGuidance?.recommendations.map(
          (recommendation) => recommendation.filePath,
        ),
      ).toEqual(['src/app.ts', 'src/helper.ts']);

      for (const recommendation of persistenceInput?.newcomerChangeGuidance?.recommendations ??
        []) {
        expect(recommendation.safetyScore).toBeGreaterThanOrEqual(0);

        expect(recommendation.safetyScore).toBeLessThanOrEqual(100);

        expect(['low', 'medium', 'high']).toContain(recommendation.riskLevel);

        expect(recommendation.blastRadius).toBeGreaterThanOrEqual(0);

        expect(recommendation.blastMaxDistance).toBeGreaterThanOrEqual(0);

        expect(recommendation.reviewFilePaths).toEqual(expect.any(Array));

        expect(recommendation.signals).toEqual(expect.any(Array));
      }

      const helperChangeGuidance = persistenceInput?.newcomerChangeGuidance?.recommendations.find(
        (recommendation) => recommendation.filePath === 'src/helper.ts',
      );

      expect(helperChangeGuidance?.reviewFilePaths).toEqual(['src/app.ts']);

      expect(persistenceInput?.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: 'src/app.ts',

            language: 'typescript',

            sourceContent: expect.stringContaining('runApp'),

            contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),

            isSupported: true,

            parseStatus: 'analyzed',
          }),

          expect.objectContaining({
            filePath: 'src/helper.ts',

            sourceContent: expect.stringContaining('helper'),

            contentHash: expect.stringMatching(/^[0-9a-f]{64}$/),

            isSupported: true,

            parseStatus: 'analyzed',
          }),
        ]),
      );

      /*
       * Export metadata must survive the complete:
       *
       * Tree-sitter parser
       *   -> ParseSourceResult
       *   -> analysis processor
       *   -> persistence payload
       *
       * pipeline.
       *
       * This protects against accidentally reverting to
       * hardcoded `isExported: false` during persistence.
       */
      expect(persistenceInput?.symbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: 'src/app.ts',

            kind: 'function',

            name: 'runApp',

            isExported: true,
          }),

          expect.objectContaining({
            filePath: 'src/helper.ts',

            kind: 'function',

            name: 'helper',

            isExported: true,
          }),
        ]),
      );

      expect(persistenceInput?.metrics.summary).toEqual(
        expect.objectContaining({
          fileCount: 2,

          historyAvailable: true,
        }),
      );

      expect(persistenceInput?.graphAnalysis.graph.nodes).toHaveLength(2);

      expect(persistenceInput?.graphAnalysis.graph.edges.length).toBeGreaterThanOrEqual(1);

      /*
       * B15 function-call resolution must survive the complete:
       *
       * Tree-sitter parsing
       *   -> import binding extraction
       *   -> repository call resolution
       *   -> analysis processor
       *   -> persistence payload
       *
       * The fixture contains:
       *
       * src/app.ts:runApp()
       *   -> src/helper.ts:helper()
       */
      expect(persistenceInput?.resolvedCalls).toHaveLength(1);

      expect(persistenceInput?.resolvedCalls?.[0]).toMatchObject({
        sourceFilePath: 'src/app.ts',

        callee: 'helper',

        kind: 'internal',

        targetFilePath: 'src/helper.ts',

        reason: null,
      });

      expect(persistenceInput?.resolvedCalls?.[0]?.sourceFunction.name).toBe('runApp');

      expect(persistenceInput?.resolvedCalls?.[0]?.targetFunction?.name).toBe('helper');

      expect(repository.cleanup).toHaveBeenCalledTimes(1);

      expect(lock.release).toHaveBeenCalledTimes(1);

      expect(job.updateProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisId: data.analysisId,

          stage: 'ingesting',

          percent: 5,
        }),
      );
    } finally {
      await rm(repository.rootDirectory, {
        recursive: true,

        force: true,
      });
    }
  });

  it('persists scanner-skipped files as unsupported or partial metadata', async () => {
    const data = createValidJobData();

    const repository = await createGitHubRepositoryFixture(data);

    /*
     * Unsupported file.
     */
    const readmeContents = '# Astral Atlas fixture\n';

    await writeFile(join(repository.rootDirectory, 'README.md'), readmeContents, 'utf8');

    /*
     * Generated/minified JavaScript.
     */
    const publicDirectory = join(repository.rootDirectory, 'public');

    await mkdir(publicDirectory, {
      recursive: true,
    });

    const generatedContents = 'console.log("generated");\n';

    await writeFile(join(publicDirectory, 'runtime.min.js'), generatedContents, 'utf8');

    /*
     * Supported TypeScript, but deliberately one byte over
     * the worker's safe analyzable-file limit.
     */
    const oversizedContents = Buffer.alloc(
      WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileBytes + 1,
      0x61,
    );

    await writeFile(join(repository.rootDirectory, 'src', 'too-large.ts'), oversizedContents);

    const analysisStore = createAnalysisStore();

    const loadGitHistoryTouches = vi.fn(async () => []);

    const lock = mockAcquiredAnalysisLock();

    const processor = createAnalysisJobProcessor(
      {} as Redis,

      {
        sourcePreparer: repository.sourcePreparer,

        analysisStore: analysisStore.store,

        loadGitHistoryTouches,
      },
    );

    const job = createJob({
      data,
    });

    try {
      await expect(processor(job)).resolves.toEqual({
        analysisId: data.analysisId,

        status: 'completed',
      });

      expect(analysisStore.put).toHaveBeenCalledTimes(1);

      const persistenceInput = analysisStore.put.mock.calls[0]?.[0];

      expect(persistenceInput).toBeDefined();

      /*
       * Two deeply analyzed files plus three scanner-level
       * skipped files must all survive into persistence.
       */
      expect(persistenceInput?.files).toHaveLength(5);

      expect(persistenceInput?.files.map((file) => file.filePath)).toEqual([
        'public/runtime.min.js',

        'README.md',

        'src/app.ts',

        'src/helper.ts',

        'src/too-large.ts',
      ]);

      const readmeFile = persistenceInput?.files.find((file) => file.filePath === 'README.md');

      expect(readmeFile).toEqual(
        expect.objectContaining({
          filePath: 'README.md',

          language: 'unknown',

          sizeBytes: Buffer.byteLength(readmeContents),

          isSupported: false,

          parseStatus: 'unsupported',
        }),
      );

      /*
       * Scanner-level unsupported files deliberately remain
       * metadata-only instead of loading source text into
       * worker memory.
       */
      expect(readmeFile?.sourceContent).toBeUndefined();

      expect(readmeFile?.contentHash).toBeUndefined();

      const generatedFile = persistenceInput?.files.find(
        (file) => file.filePath === 'public/runtime.min.js',
      );

      expect(generatedFile).toEqual(
        expect.objectContaining({
          filePath: 'public/runtime.min.js',

          language: 'javascript',

          sizeBytes: Buffer.byteLength(generatedContents),

          isSupported: true,

          parseStatus: 'partial',
        }),
      );

      expect(generatedFile?.sourceContent).toBeUndefined();

      expect(generatedFile?.contentHash).toBeUndefined();

      const oversizedFile = persistenceInput?.files.find(
        (file) => file.filePath === 'src/too-large.ts',
      );

      expect(oversizedFile).toEqual(
        expect.objectContaining({
          filePath: 'src/too-large.ts',

          language: 'typescript',

          sizeBytes: WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileBytes + 1,

          isSupported: true,

          parseStatus: 'partial',
        }),
      );

      expect(oversizedFile?.sourceContent).toBeUndefined();

      expect(oversizedFile?.contentHash).toBeUndefined();

      /*
       * Unsupported/partial files remain visible in
       * persistence, but they must NOT inflate the
       * dependency graph or analyzed-file metrics.
       */
      expect(persistenceInput?.metrics.summary.fileCount).toBe(2);

      expect(persistenceInput?.graphAnalysis.graph.nodes.map((node) => node.filePath)).toEqual([
        'src/app.ts',
        'src/helper.ts',
      ]);

      expect(repository.cleanup).toHaveBeenCalledTimes(1);

      expect(lock.release).toHaveBeenCalledTimes(1);
    } finally {
      await rm(repository.rootDirectory, {
        recursive: true,

        force: true,
      });
    }
  });

  it('returns an already-completed analysis without preparing the repository again', async () => {
    const data = createValidJobData();

    const prepare = vi.fn();

    const sourcePreparer = {
      prepare,
    } as unknown as AnalysisSourcePreparer;

    const analysisStore = createAnalysisStore({
      completed: true,
    });

    const lock = mockAcquiredAnalysisLock();

    const processor = createAnalysisJobProcessor(
      {} as Redis,

      {
        sourcePreparer,

        analysisStore: analysisStore.store,
      },
    );

    const job = createJob({
      data,
    });

    const result = await processor(job);

    expect(result).toEqual({
      analysisId: data.analysisId,

      status: 'completed',
    });

    expect(analysisStore.getCompletedById).toHaveBeenCalledTimes(1);

    expect(analysisStore.getCompletedById).toHaveBeenCalledWith(data.analysisId);

    expect(prepare).not.toHaveBeenCalled();

    expect(analysisStore.put).not.toHaveBeenCalled();

    expect(job.updateProgress).not.toHaveBeenCalled();

    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it('does not request Git history for a ZIP analysis', async () => {
    const data = createValidZipJobData();

    const repository = await createZipRepositoryFixture(data);

    const analysisStore = createAnalysisStore();

    const loadGitHistoryTouches = vi.fn(async () => []);

    const lock = mockAcquiredAnalysisLock();

    const processor = createAnalysisJobProcessor(
      {} as Redis,

      {
        sourcePreparer: repository.sourcePreparer,

        analysisStore: analysisStore.store,

        loadGitHistoryTouches,
      },
    );

    const job = createJob({
      data,
    });

    try {
      await expect(processor(job)).resolves.toEqual({
        analysisId: data.analysisId,

        status: 'completed',
      });

      expect(loadGitHistoryTouches).not.toHaveBeenCalled();

      expect(analysisStore.put).toHaveBeenCalledTimes(1);

      const persistenceInput = analysisStore.put.mock.calls[0]?.[0];

      expect(persistenceInput?.metrics.summary.historyAvailable).toBe(false);

      expect(repository.cleanup).toHaveBeenCalledTimes(1);

      expect(lock.release).toHaveBeenCalledTimes(1);
    } finally {
      await rm(repository.rootDirectory, {
        recursive: true,

        force: true,
      });
    }
  });

  it('cleans the prepared repository and releases the lock when persistence fails', async () => {
    const data = createValidJobData();

    const repository = await createGitHubRepositoryFixture(data);

    const persistenceError = new Error('Simulated persistence failure');

    const analysisStore = createAnalysisStore({
      putError: persistenceError,
    });

    const lock = mockAcquiredAnalysisLock();

    const processor = createAnalysisJobProcessor(
      {} as Redis,

      {
        sourcePreparer: repository.sourcePreparer,

        analysisStore: analysisStore.store,

        loadGitHistoryTouches: vi.fn(async () => []),
      },
    );

    const job = createJob({
      data,
    });

    try {
      await expect(processor(job)).rejects.toBe(persistenceError);

      expect(analysisStore.put).toHaveBeenCalledTimes(1);

      expect(repository.cleanup).toHaveBeenCalledTimes(1);

      expect(lock.release).toHaveBeenCalledTimes(1);
    } finally {
      await rm(repository.rootDirectory, {
        recursive: true,

        force: true,
      });
    }
  });
});
