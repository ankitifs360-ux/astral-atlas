import { ANALYSIS_JOB_SCHEMA_VERSION, type AnalysisJobData } from '@astral-atlas/shared';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enqueueAnalysisJob, requeueAnalysisJob } from '../../queues/enqueue-analysis.js';

import type { AnalysisQueue } from '../../queues/analysis-queue.js';

import {
  AnalysisSubmissionService,
  type GitHubSubmissionInput,
  type ZipSubmissionInput,
} from './analysis-submission-service.js';

import type {
  AnalysisSubmissionRecord,
  AnalysisSubmissionStore,
} from './analysis-submission-store.js';

vi.mock('../../queues/enqueue-analysis.js', () => ({
  enqueueAnalysisJob: vi.fn(),

  requeueAnalysisJob: vi.fn(),
}));

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

const REPOSITORY_ID = '22222222-2222-2222-2222-222222222222';

function createGitHubInput(): GitHubSubmissionInput {
  return {
    owner: 'facebook',

    repo: 'react',

    canonicalUrl: 'https://github.com/facebook/react',

    sourceKey: 'github:facebook/react',

    defaultBranch: 'main',

    commitSha: 'a'.repeat(40),
  };
}

function createZipInput(): ZipSubmissionInput {
  return {
    sourceKey: `zip:${'b'.repeat(64)}`,

    contentSha256: 'b'.repeat(64),

    archivePath: '/tmp/upload/repository.zip',
  };
}

function createRecord(overrides: Partial<AnalysisSubmissionRecord> = {}): AnalysisSubmissionRecord {
  return {
    repositoryId: REPOSITORY_ID,

    analysisId: ANALYSIS_ID,

    state: 'created',

    status: 'queued',

    ...overrides,
  };
}

function createStore(record: AnalysisSubmissionRecord) {
  const prepareSubmission = vi.fn(async () => record);

  const store = {
    prepareSubmission,
  } as unknown as AnalysisSubmissionStore;

  return {
    store,

    prepareSubmission,
  };
}

function createBullMqJob(state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed') {
  const getState = vi.fn(async () => state);

  const job = {
    id: ANALYSIS_ID,

    getState,
  };

  return {
    job,

    getState,
  };
}

function createQueue(
  existingJob: ReturnType<typeof createBullMqJob>['job'] | undefined = undefined,
) {
  const getJob = vi.fn(async () => existingJob);

  const queue = {
    getJob,
  } as unknown as AnalysisQueue;

  return {
    queue,

    getJob,
  };
}

function expectedGitHubJobData(
  input: GitHubSubmissionInput = createGitHubInput(),
): AnalysisJobData {
  return {
    schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

    analysisId: ANALYSIS_ID,

    repositoryId: REPOSITORY_ID,

    source: {
      sourceType: 'github',

      owner: input.owner,

      repo: input.repo,

      canonicalUrl: input.canonicalUrl,

      sourceKey: input.sourceKey,

      commitSha: input.commitSha,
    },
  };
}

function expectedZipJobData(input: ZipSubmissionInput = createZipInput()): AnalysisJobData {
  return {
    schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

    analysisId: ANALYSIS_ID,

    repositoryId: REPOSITORY_ID,

    source: {
      sourceType: 'zip',

      sourceKey: input.sourceKey,

      contentSha256: input.contentSha256,

      archivePath: input.archivePath,
    },
  };
}

describe('AnalysisSubmissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('submitGitHub', () => {
    it('creates PostgreSQL submission state and enqueues a new GitHub analysis', async () => {
      const input = createGitHubInput();

      const { store, prepareSubmission } = createStore(createRecord());

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      const result = await service.submitGitHub(input);

      expect(prepareSubmission).toHaveBeenCalledTimes(1);

      expect(prepareSubmission).toHaveBeenCalledWith({
        sourceType: 'github',

        sourceKey: input.sourceKey,

        revision: input.commitSha,

        githubOwner: input.owner,

        githubName: input.repo,

        canonicalUrl: input.canonicalUrl,

        defaultBranch: input.defaultBranch,
      });

      expect(enqueueAnalysisJob).toHaveBeenCalledTimes(1);

      expect(enqueueAnalysisJob).toHaveBeenCalledWith(queue, expectedGitHubJobData(input));

      expect(requeueAnalysisJob).not.toHaveBeenCalled();

      expect(getJob).not.toHaveBeenCalled();

      expect(result).toEqual({
        analysisId: ANALYSIS_ID,

        repositoryId: REPOSITORY_ID,

        status: 'queued',

        state: 'created',

        cacheHit: false,
      });
    });

    it('normalizes GitHub text and commit SHA before storing and queueing', async () => {
      const input: GitHubSubmissionInput = {
        owner: '  facebook  ',

        repo: '  react  ',

        canonicalUrl: '  https://github.com/facebook/react  ',

        sourceKey: '  github:facebook/react  ',

        defaultBranch: '  main  ',

        commitSha: `  ${'A'.repeat(40)}  `,
      };

      const { store, prepareSubmission } = createStore(createRecord());

      const { queue } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(input);

      const normalizedInput: GitHubSubmissionInput = {
        owner: 'facebook',

        repo: 'react',

        canonicalUrl: 'https://github.com/facebook/react',

        sourceKey: 'github:facebook/react',

        defaultBranch: 'main',

        commitSha: 'a'.repeat(40),
      };

      expect(prepareSubmission).toHaveBeenCalledWith({
        sourceType: 'github',

        sourceKey: normalizedInput.sourceKey,

        revision: normalizedInput.commitSha,

        githubOwner: normalizedInput.owner,

        githubName: normalizedInput.repo,

        canonicalUrl: normalizedInput.canonicalUrl,

        defaultBranch: normalizedInput.defaultBranch,
      });

      expect(enqueueAnalysisJob).toHaveBeenCalledWith(
        queue,
        expectedGitHubJobData(normalizedInput),
      );
    });

    it('does not touch BullMQ for a completed cache hit', async () => {
      const { store } = createStore(
        createRecord({
          state: 'cached',

          status: 'completed',
        }),
      );

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      await expect(service.submitGitHub(createGitHubInput())).resolves.toEqual({
        analysisId: ANALYSIS_ID,

        repositoryId: REPOSITORY_ID,

        status: 'completed',

        state: 'cached',

        cacheHit: true,
      });

      expect(getJob).not.toHaveBeenCalled();

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();

      expect(requeueAnalysisJob).not.toHaveBeenCalled();
    });

    it('uses the safe requeue helper for a PostgreSQL retry', async () => {
      const input = createGitHubInput();

      const { store } = createStore(
        createRecord({
          state: 'requeued',

          status: 'queued',
        }),
      );

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      const result = await service.submitGitHub(input);

      expect(requeueAnalysisJob).toHaveBeenCalledTimes(1);

      expect(requeueAnalysisJob).toHaveBeenCalledWith(queue, expectedGitHubJobData(input));

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();

      expect(getJob).not.toHaveBeenCalled();

      expect(result.state).toBe('requeued');
    });

    it('reuses an already-running PostgreSQL analysis without touching BullMQ', async () => {
      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'running',
        }),
      );

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      const result = await service.submitGitHub(createGitHubInput());

      expect(result).toEqual({
        analysisId: ANALYSIS_ID,

        repositoryId: REPOSITORY_ID,

        status: 'running',

        state: 'existing',

        cacheHit: false,
      });

      expect(getJob).not.toHaveBeenCalled();

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();

      expect(requeueAnalysisJob).not.toHaveBeenCalled();
    });

    it('reuses a live queued BullMQ job without creating another job', async () => {
      const { job, getState } = createBullMqJob('waiting');

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue, getJob } = createQueue(job);

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(createGitHubInput());

      expect(getJob).toHaveBeenCalledTimes(1);

      expect(getJob).toHaveBeenCalledWith(ANALYSIS_ID);

      expect(getState).toHaveBeenCalledTimes(1);

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();

      expect(requeueAnalysisJob).not.toHaveBeenCalled();
    });

    it('repairs an orphaned queued PostgreSQL analysis when the BullMQ job is missing', async () => {
      const input = createGitHubInput();

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(input);

      expect(getJob).toHaveBeenCalledWith(ANALYSIS_ID);

      expect(enqueueAnalysisJob).toHaveBeenCalledTimes(1);

      expect(enqueueAnalysisJob).toHaveBeenCalledWith(queue, expectedGitHubJobData(input));

      expect(requeueAnalysisJob).not.toHaveBeenCalled();
    });

    it('repairs a queued PostgreSQL analysis whose retained BullMQ job has failed', async () => {
      const input = createGitHubInput();

      const { job, getState } = createBullMqJob('failed');

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue } = createQueue(job);

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(input);

      expect(getState).toHaveBeenCalledTimes(1);

      expect(requeueAnalysisJob).toHaveBeenCalledTimes(1);

      expect(requeueAnalysisJob).toHaveBeenCalledWith(queue, expectedGitHubJobData(input));

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();
    });

    it('repairs a queued PostgreSQL analysis whose retained BullMQ job has completed', async () => {
      const input = createGitHubInput();

      const { job, getState } = createBullMqJob('completed');

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue } = createQueue(job);

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(input);

      expect(getState).toHaveBeenCalledTimes(1);

      expect(requeueAnalysisJob).toHaveBeenCalledTimes(1);

      expect(requeueAnalysisJob).toHaveBeenCalledWith(queue, expectedGitHubJobData(input));

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();
    });

    it('reuses an active BullMQ job for an existing queued PostgreSQL analysis', async () => {
      const { job, getState } = createBullMqJob('active');

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue } = createQueue(job);

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitGitHub(createGitHubInput());

      expect(getState).toHaveBeenCalledTimes(1);

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();

      expect(requeueAnalysisJob).not.toHaveBeenCalled();
    });
  });

  describe('submitZip', () => {
    it('creates PostgreSQL submission state and enqueues a new ZIP analysis', async () => {
      const input = createZipInput();

      const { store, prepareSubmission } = createStore(createRecord());

      const { queue, getJob } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      const result = await service.submitZip(input);

      expect(prepareSubmission).toHaveBeenCalledWith({
        sourceType: 'zip',

        sourceKey: input.sourceKey,

        revision: input.contentSha256,
      });

      expect(enqueueAnalysisJob).toHaveBeenCalledWith(queue, expectedZipJobData(input));

      expect(requeueAnalysisJob).not.toHaveBeenCalled();

      expect(getJob).not.toHaveBeenCalled();

      expect(result).toEqual({
        analysisId: ANALYSIS_ID,

        repositoryId: REPOSITORY_ID,

        status: 'queued',

        state: 'created',

        cacheHit: false,
      });
    });

    it('normalizes ZIP identity values before storing and queueing', async () => {
      const input: ZipSubmissionInput = {
        sourceKey: `  zip:${'B'.repeat(64)}  `,

        contentSha256: `  ${'B'.repeat(64)}  `,

        archivePath: '  /tmp/upload/repository.zip  ',
      };

      const { store, prepareSubmission } = createStore(createRecord());

      const { queue } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitZip(input);

      const normalizedInput: ZipSubmissionInput = {
        sourceKey: `zip:${'B'.repeat(64)}`,

        contentSha256: 'b'.repeat(64),

        archivePath: '/tmp/upload/repository.zip',
      };

      expect(prepareSubmission).toHaveBeenCalledWith({
        sourceType: 'zip',

        sourceKey: normalizedInput.sourceKey,

        revision: normalizedInput.contentSha256,
      });

      expect(enqueueAnalysisJob).toHaveBeenCalledWith(queue, expectedZipJobData(normalizedInput));
    });

    it('uses the safe requeue helper for a retried ZIP analysis', async () => {
      const input = createZipInput();

      const { store } = createStore(
        createRecord({
          state: 'requeued',

          status: 'queued',
        }),
      );

      const { queue } = createQueue();

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitZip(input);

      expect(requeueAnalysisJob).toHaveBeenCalledWith(queue, expectedZipJobData(input));

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();
    });

    it('repairs a terminal BullMQ job for an existing queued ZIP analysis', async () => {
      const input = createZipInput();

      const { job } = createBullMqJob('failed');

      const { store } = createStore(
        createRecord({
          state: 'existing',

          status: 'queued',
        }),
      );

      const { queue } = createQueue(job);

      const service = new AnalysisSubmissionService(store, queue);

      await service.submitZip(input);

      expect(requeueAnalysisJob).toHaveBeenCalledWith(queue, expectedZipJobData(input));

      expect(enqueueAnalysisJob).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      'GitHub owner',

      () =>
        new AnalysisSubmissionService(
          createStore(createRecord()).store,

          createQueue().queue,
        ).submitGitHub({
          ...createGitHubInput(),

          owner: '   ',
        }),

      'owner cannot be empty',
    ],

    [
      'GitHub commit SHA',

      () =>
        new AnalysisSubmissionService(
          createStore(createRecord()).store,

          createQueue().queue,
        ).submitGitHub({
          ...createGitHubInput(),

          commitSha: '   ',
        }),

      'commitSha cannot be empty',
    ],

    [
      'ZIP archive path',

      () =>
        new AnalysisSubmissionService(
          createStore(createRecord()).store,

          createQueue().queue,
        ).submitZip({
          ...createZipInput(),

          archivePath: '   ',
        }),

      'archivePath cannot be empty',
    ],
  ])('rejects an empty %s before submission side effects', async (_label, submit, message) => {
    await expect(submit()).rejects.toThrow(message);

    expect(enqueueAnalysisJob).not.toHaveBeenCalled();

    expect(requeueAnalysisJob).not.toHaveBeenCalled();
  });
});
