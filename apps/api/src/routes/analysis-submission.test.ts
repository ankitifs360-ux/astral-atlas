import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { describe, expect, it, vi } from 'vitest';

import type { GitHubClient, ResolvedGitHubRepository } from '../modules/ingestion/github-client.js';

import type { AnalysisSubmissionService } from '../modules/analysis-submission/analysis-submission-service.js';

import { registerAnalysisSubmissionRoutes } from './analysis-submission.js';

const ANALYSIS_ID = '11111111-1111-1111-1111-111111111111';

const REPOSITORY_ID = '22222222-2222-2222-2222-222222222222';

function createResolvedRepository(
  overrides: Partial<ResolvedGitHubRepository> = {},
): ResolvedGitHubRepository {
  return {
    owner: 'facebook',

    repo: 'react',

    canonicalUrl: 'https://github.com/facebook/react',

    sourceKey: 'github:facebook/react',

    defaultBranch: 'main',

    commitSha: 'a'.repeat(40),

    cloneUrl: 'https://github.com/facebook/react.git',

    repositorySizeKb: 1_000,

    ...overrides,
  };
}

function createMultipartBody(bytes: Buffer, filename = 'repository.zip') {
  const boundary = '----astral-atlas-test-boundary';

  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      'Content-Type: application/zip',
      '',
      '',
    ].join('\r\n'),
    'utf8',
  );

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');

  return {
    boundary,

    body: Buffer.concat([header, bytes, footer]),
  };
}

async function createTestApp(options?: {
  repository?: ResolvedGitHubRepository;

  submissionResult?: {
    analysisId: string;
    repositoryId: string;
    status: 'queued' | 'running' | 'completed';
    state: 'cached' | 'existing' | 'created' | 'requeued';
    cacheHit: boolean;
  };
}) {
  const repository = options?.repository ?? createResolvedRepository();

  const submissionResult = options?.submissionResult ?? {
    analysisId: ANALYSIS_ID,
    repositoryId: REPOSITORY_ID,
    status: 'queued' as const,
    state: 'created' as const,
    cacheHit: false,
  };

  const resolveRepository = vi.fn(async () => repository);

  const githubClient = {
    resolveRepository,
  } as unknown as GitHubClient;

  const submitGitHub = vi.fn(async () => submissionResult);

  const submitZip = vi.fn(async () => submissionResult);

  const submissionService = {
    submitGitHub,

    submitZip,
  } as unknown as AnalysisSubmissionService;

  const stageZip = vi.fn(async () => ({
    sourceKey: `zip:${'b'.repeat(64)}`,

    contentSha256: 'b'.repeat(64),

    archivePath: '/tmp/astral-atlas-staging/repository.zip',

    sizeBytes: 100,
  }));

  const app = Fastify({
    logger: false,
  });

  await app.register(multipart, {
    limits: {
      files: 1,
      fields: 0,
      parts: 1,
    },
  });

  registerAnalysisSubmissionRoutes(app, {
    submissionService,

    githubClient,

    zipStagingDirectory: '/tmp/astral-atlas-staging',

    stageZip,
  });

  return {
    app,

    resolveRepository,

    submitGitHub,

    submitZip,

    stageZip,
  };
}

describe('analysis submission routes', () => {
  describe('POST /api/analyses/github', () => {
    it('resolves the GitHub repository and submits the exact revision', async () => {
      const { app, resolveRepository, submitGitHub } = await createTestApp();

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/github',

          payload: {
            repositoryUrl: 'https://github.com/facebook/react',
          },
        });

        expect(response.statusCode).toBe(202);

        expect(resolveRepository).toHaveBeenCalledTimes(1);

        expect(submitGitHub).toHaveBeenCalledTimes(1);

        expect(submitGitHub).toHaveBeenCalledWith({
          owner: 'facebook',

          repo: 'react',

          canonicalUrl: 'https://github.com/facebook/react',

          sourceKey: 'github:facebook/react',

          defaultBranch: 'main',

          commitSha: 'a'.repeat(40),
        });

        expect(response.json()).toEqual({
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'queued',

          state: 'created',

          cacheHit: false,
        });
      } finally {
        await app.close();
      }
    });

    it('returns 200 for a completed cache hit', async () => {
      const { app } = await createTestApp({
        submissionResult: {
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'completed',

          state: 'cached',

          cacheHit: true,
        },
      });

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/github',

          payload: {
            repositoryUrl: 'https://github.com/facebook/react',
          },
        });

        expect(response.statusCode).toBe(200);

        expect(response.json()).toEqual({
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'completed',

          state: 'cached',

          cacheHit: true,
        });
      } finally {
        await app.close();
      }
    });

    it('returns 202 when the analysis already exists and is running', async () => {
      const { app } = await createTestApp({
        submissionResult: {
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'running',

          state: 'existing',

          cacheHit: false,
        },
      });

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/github',

          payload: {
            repositoryUrl: 'https://github.com/facebook/react',
          },
        });

        expect(response.statusCode).toBe(202);

        expect(response.json()).toMatchObject({
          analysisId: ANALYSIS_ID,

          status: 'running',

          state: 'existing',

          cacheHit: false,
        });
      } finally {
        await app.close();
      }
    });

    it('rejects an oversized GitHub repository before submission', async () => {
      const { app, submitGitHub } = await createTestApp({
        repository: createResolvedRepository({
          repositorySizeKb: 1024 * 1024,
        }),
      });

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/github',

          payload: {
            repositoryUrl: 'https://github.com/facebook/react',
          },
        });

        expect(response.statusCode).toBe(413);

        expect(submitGitHub).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });

    it('handles 100 concurrent GitHub submissions', async () => {
      const { app, resolveRepository, submitGitHub } = await createTestApp();

      const concurrentRequestCount = 100;

      try {
        const responses = await Promise.all(
          Array.from({ length: concurrentRequestCount }, () =>
            app.inject({
              method: 'POST',

              url: '/api/analyses/github',

              payload: {
                repositoryUrl: 'https://github.com/facebook/react',
              },
            }),
          ),
        );

        expect(responses).toHaveLength(concurrentRequestCount);

        for (const response of responses) {
          expect(response.statusCode).toBe(202);

          expect(response.json()).toEqual({
            analysisId: ANALYSIS_ID,

            repositoryId: REPOSITORY_ID,

            status: 'queued',

            state: 'created',

            cacheHit: false,
          });
        }

        expect(resolveRepository).toHaveBeenCalledTimes(concurrentRequestCount);

        expect(submitGitHub).toHaveBeenCalledTimes(concurrentRequestCount);
      } finally {
        await app.close();
      }
    });
  });

  describe('POST /api/analyses/zip', () => {
    it('stages the uploaded ZIP and submits its deterministic revision', async () => {
      const { app, stageZip, submitZip } = await createTestApp();

      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03]);

      const multipartBody = createMultipartBody(zipBytes);

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/zip',

          headers: {
            'content-type': `multipart/form-data; boundary=${multipartBody.boundary}`,
          },

          payload: multipartBody.body,
        });

        expect(response.statusCode).toBe(202);

        expect(stageZip).toHaveBeenCalledTimes(1);

        expect(stageZip).toHaveBeenCalledWith(
          expect.objectContaining({
            filename: 'repository.zip',

            mimetype: 'application/zip',
          }),
          '/tmp/astral-atlas-staging',
        );

        expect(submitZip).toHaveBeenCalledTimes(1);

        expect(submitZip).toHaveBeenCalledWith({
          sourceKey: `zip:${'b'.repeat(64)}`,

          contentSha256: 'b'.repeat(64),

          archivePath: '/tmp/astral-atlas-staging/repository.zip',
        });

        expect(response.json()).toEqual({
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'queued',

          state: 'created',

          cacheHit: false,
        });
      } finally {
        await app.close();
      }
    });

    it('returns 200 when a ZIP submission is already cached', async () => {
      const { app } = await createTestApp({
        submissionResult: {
          analysisId: ANALYSIS_ID,

          repositoryId: REPOSITORY_ID,

          status: 'completed',

          state: 'cached',

          cacheHit: true,
        },
      });

      const multipartBody = createMultipartBody(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/zip',

          headers: {
            'content-type': `multipart/form-data; boundary=${multipartBody.boundary}`,
          },

          payload: multipartBody.body,
        });

        expect(response.statusCode).toBe(200);

        expect(response.json()).toMatchObject({
          status: 'completed',

          state: 'cached',

          cacheHit: true,
        });
      } finally {
        await app.close();
      }
    });

    it('rejects a multipart request without a ZIP file', async () => {
      const { app, stageZip, submitZip } = await createTestApp();

      const boundary = '----astral-atlas-empty-boundary';

      const body = Buffer.from(`--${boundary}--\r\n`, 'utf8');

      try {
        const response = await app.inject({
          method: 'POST',

          url: '/api/analyses/zip',

          headers: {
            'content-type': `multipart/form-data; boundary=${boundary}`,
          },

          payload: body,
        });

        expect(response.statusCode).toBe(400);

        expect(stageZip).not.toHaveBeenCalled();

        expect(submitZip).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });
});
