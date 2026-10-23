import { Type } from 'typebox';

import type { FastifyInstance } from 'fastify';

import { AppError } from '../errors.js';

import type { GitHubClient } from '../modules/ingestion/github-client.js';
import { parseGitHubRepositoryUrl } from '../modules/ingestion/github-url.js';
import { INGESTION_LIMITS } from '../modules/ingestion/limits.js';
import {
  stageZipUpload,
  type StageZipUploadInput,
  type StagedZipUpload,
} from '../modules/ingestion/zip-upload-staging.js';

import type { AnalysisSubmissionService } from '../modules/analysis-submission/analysis-submission-service.js';

const GitHubSubmissionBodySchema = Type.Object(
  {
    repositoryUrl: Type.String({
      minLength: 1,
      maxLength: 500,
    }),
  },
  {
    additionalProperties: false,
  },
);

interface GitHubSubmissionBody {
  repositoryUrl: string;
}

export interface AnalysisSubmissionRouteDependencies {
  submissionService: AnalysisSubmissionService;

  githubClient: GitHubClient;

  zipStagingDirectory: string;

  /*
   * Injectable only to make route tests simple.
   *
   * Production uses stageZipUpload().
   */
  stageZip?: (input: StageZipUploadInput, stagingDirectory: string) => Promise<StagedZipUpload>;
}

function validateGitHubRepositorySize(repositorySizeKb: number): void {
  const maxRepositorySizeKb = Math.floor(INGESTION_LIMITS.maxExtractedBytes / 1024);

  if (repositorySizeKb > maxRepositorySizeKb) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      413,
      `GitHub repository exceeds the ${Math.floor(
        INGESTION_LIMITS.maxExtractedBytes / (1024 * 1024),
      )} MiB repository limit.`,
      [
        {
          field: 'repositoryUrl',
          message: 'Repository is too large to analyse safely.',
        },
      ],
    );
  }
}

export function registerAnalysisSubmissionRoutes(
  app: FastifyInstance,
  dependencies: AnalysisSubmissionRouteDependencies,
): void {
  const stageZip = dependencies.stageZip ?? stageZipUpload;

  /*
   * ---------------------------------------------------------
   * GitHub repository submission
   * ---------------------------------------------------------
   */
  app.post<{
    Body: GitHubSubmissionBody;
  }>(
    '/api/analyses/github',
    {
      schema: {
        body: GitHubSubmissionBodySchema,
      },
    },
    async (request, reply) => {
      /*
       * This parser only accepts our supported GitHub URL form.
       * It also prevents arbitrary-host / SSRF-style input.
       */
      const parsedRepository = parseGitHubRepositoryUrl(request.body.repositoryUrl);

      /*
       * GitHub API resolves the repository to one exact,
       * immutable commit SHA.
       *
       * We do NOT clone the repository here.
       */
      const repository = await dependencies.githubClient.resolveRepository(parsedRepository);

      validateGitHubRepositorySize(repository.repositorySizeKb);

      const result = await dependencies.submissionService.submitGitHub({
        owner: repository.owner,

        repo: repository.repo,

        canonicalUrl: repository.canonicalUrl,

        sourceKey: repository.sourceKey,

        defaultBranch: repository.defaultBranch,

        commitSha: repository.commitSha,
      });

      return reply.code(result.cacheHit ? 200 : 202).send(result);
    },
  );

  /*
   * ---------------------------------------------------------
   * ZIP repository submission
   * ---------------------------------------------------------
   */
  app.post('/api/analyses/zip', async (request, reply) => {
    /*
     * @fastify/multipart provides request.file().
     *
     * app.ts already restricts this request to:
     * - one file
     * - zero text fields
     * - bounded compressed size
     */
    const upload = await request.file();

    if (upload === undefined) {
      throw new AppError('BAD_REQUEST', 400, 'Repository ZIP file is required.', [
        {
          field: 'file',
          message: 'Upload one repository ZIP file.',
        },
      ]);
    }

    /*
     * Stream the ZIP into shared durable staging.
     *
     * No extraction or code analysis happens here.
     */
    const staged = await stageZip(
      {
        filename: upload.filename,

        mimetype: upload.mimetype,

        stream: upload.file,
      },
      dependencies.zipStagingDirectory,
    );

    const result = await dependencies.submissionService.submitZip({
      sourceKey: staged.sourceKey,

      contentSha256: staged.contentSha256,

      archivePath: staged.archivePath,
    });

    return reply.code(result.cacheHit ? 200 : 202).send(result);
  });
}
