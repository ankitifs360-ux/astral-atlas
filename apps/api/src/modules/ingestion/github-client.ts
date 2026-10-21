import { Octokit } from 'octokit';

import { AppError } from '../../errors.js';
import type { ParsedGitHubRepositoryUrl } from './github-url.js';

export interface ResolvedGitHubRepository {
  owner: string;
  repo: string;

  canonicalUrl: string;
  sourceKey: string;

  defaultBranch: string;
  commitSha: string;

  cloneUrl: string;

  repositorySizeKb: number;
}

export interface GitHubClientOptions {
  token?: string;
}

interface GitHubLikeError {
  status?: number;

  response?: {
    headers?: Record<string, string | undefined>;
  };
}

function isGitHubLikeError(error: unknown): error is GitHubLikeError {
  return typeof error === 'object' && error !== null;
}

function throwGitHubRequestError(error: unknown): never {
  if (!isGitHubLikeError(error)) {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'GitHub could not be reached.');
  }

  if (error.status === 404) {
    throw new AppError(
      'BAD_REQUEST',
      400,
      'GitHub repository was not found or is not publicly accessible.',
      [
        {
          field: 'repositoryUrl',
          message: 'Repository was not found or is not publicly accessible.',
        },
      ],
    );
  }

  if (error.status === 409) {
    throw new AppError('BAD_REQUEST', 400, 'GitHub repository does not contain any commits.', [
      {
        field: 'repositoryUrl',
        message: 'Repository must contain at least one commit.',
      },
    ]);
  }

  if (error.status === 401) {
    throw new AppError('SERVICE_UNAVAILABLE', 503, 'GitHub authentication failed.');
  }

  if (error.status === 403) {
    const remaining = error.response?.headers?.['x-ratelimit-remaining'];

    if (remaining === '0') {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        503,
        'GitHub API rate limit has been reached. Try again later or use a ZIP upload.',
      );
    }

    throw new AppError('SERVICE_UNAVAILABLE', 503, 'GitHub rejected the repository request.');
  }

  throw new AppError(
    'SERVICE_UNAVAILABLE',
    503,
    'GitHub repository information could not be retrieved.',
  );
}

export class GitHubClient {
  private readonly octokit: Octokit;

  public constructor(options: GitHubClientOptions = {}) {
    this.octokit = new Octokit({
      ...(options.token
        ? {
            auth: options.token,
          }
        : {}),

      userAgent: 'astral-atlas/0.0.0',
    });
  }

  public async resolveRepository(
    repository: ParsedGitHubRepositoryUrl,
  ): Promise<ResolvedGitHubRepository> {
    try {
      const repositoryResponse = await this.octokit.request('GET /repos/{owner}/{repo}', {
        owner: repository.owner,
        repo: repository.repo,

        headers: {
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });

      if (repositoryResponse.data.private) {
        throw new AppError('BAD_REQUEST', 400, 'Private GitHub repositories are not supported.', [
          {
            field: 'repositoryUrl',
            message: 'Provide a public repository or upload a ZIP file instead.',
          },
        ]);
      }

      const defaultBranch = repositoryResponse.data.default_branch;

      if (!defaultBranch) {
        throw new AppError(
          'BAD_REQUEST',
          400,
          'GitHub repository does not have a default branch.',
          [
            {
              field: 'repositoryUrl',
              message: 'Repository must contain a default branch.',
            },
          ],
        );
      }

      const commitResponse = await this.octokit.request('GET /repos/{owner}/{repo}/commits/{ref}', {
        owner: repository.owner,
        repo: repository.repo,
        ref: defaultBranch,

        headers: {
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });

      const commitSha = commitResponse.data.sha;

      if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
        throw new AppError('SERVICE_UNAVAILABLE', 503, 'GitHub returned an invalid commit SHA.');
      }

      return {
        owner: repository.owner,
        repo: repository.repo,

        canonicalUrl: repository.canonicalUrl,

        sourceKey: repository.sourceKey,

        defaultBranch,

        commitSha: commitSha.toLowerCase(),

        cloneUrl: repositoryResponse.data.clone_url,

        repositorySizeKb: repositoryResponse.data.size,
      };
    } catch (error: unknown) {
      // Preserve errors that we intentionally created above.
      if (error instanceof AppError) {
        throw error;
      }

      throwGitHubRequestError(error);
    }
  }
}
