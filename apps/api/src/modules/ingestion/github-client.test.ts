import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubClient } from './github-client.js';
import type { ParsedGitHubRepositoryUrl } from './github-url.js';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('octokit', () => ({
  Octokit: class {
    public readonly request = requestMock;
  },
}));

const repository: ParsedGitHubRepositoryUrl = {
  owner: 'facebook',
  repo: 'react',
  canonicalUrl: 'https://github.com/facebook/react',
  sourceKey: 'github:facebook/react',
};

describe('GitHubClient', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('resolves a public repository to an exact commit SHA', async () => {
    requestMock
      .mockResolvedValueOnce({
        data: {
          private: false,
          default_branch: 'main',
          clone_url: 'https://github.com/facebook/react.git',
          size: 512_000,
        },
      })
      .mockResolvedValueOnce({
        data: {
          sha: 'A'.repeat(40),
        },
      });

    const client = new GitHubClient();

    const result = await client.resolveRepository(repository);

    expect(result).toEqual({
      owner: 'facebook',
      repo: 'react',

      canonicalUrl: 'https://github.com/facebook/react',
      sourceKey: 'github:facebook/react',

      defaultBranch: 'main',

      commitSha: 'a'.repeat(40),

      cloneUrl: 'https://github.com/facebook/react.git',

      repositorySizeKb: 512_000,
    });

    expect(requestMock).toHaveBeenCalledTimes(2);

    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      'GET /repos/{owner}/{repo}',
      expect.objectContaining({
        owner: 'facebook',
        repo: 'react',
      }),
    );

    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      'GET /repos/{owner}/{repo}/commits/{ref}',
      expect.objectContaining({
        owner: 'facebook',
        repo: 'react',
        ref: 'main',
      }),
    );
  });

  it('rejects a private repository', async () => {
    requestMock.mockResolvedValueOnce({
      data: {
        private: true,
        default_branch: 'main',
        clone_url: 'https://github.com/example/private.git',
        size: 100,
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'Private GitHub repositories are not supported.',
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a repository without a default branch', async () => {
    requestMock.mockResolvedValueOnce({
      data: {
        private: false,
        default_branch: null,
        clone_url: 'https://github.com/facebook/react.git',
        size: 0,
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'GitHub repository does not have a default branch.',
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('maps GitHub 404 responses to a bad request', async () => {
    requestMock.mockRejectedValueOnce({
      status: 404,
      response: {
        headers: {},
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'GitHub repository was not found or is not publicly accessible.',
    });
  });

  it('maps GitHub rate-limit exhaustion to service unavailable', async () => {
    requestMock.mockRejectedValueOnce({
      status: 403,

      response: {
        headers: {
          'x-ratelimit-remaining': '0',
        },
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      message: 'GitHub API rate limit has been reached. Try again later or use a ZIP upload.',
    });
  });

  it('maps GitHub 401 responses to service unavailable', async () => {
    requestMock.mockRejectedValueOnce({
      status: 401,
      response: {
        headers: {},
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      message: 'GitHub authentication failed.',
    });
  });

  it('maps empty GitHub repositories to a bad request', async () => {
    requestMock.mockRejectedValueOnce({
      status: 409,
      response: {
        headers: {},
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'GitHub repository does not contain any commits.',
    });
  });

  it('rejects an invalid commit SHA returned by GitHub', async () => {
    requestMock
      .mockResolvedValueOnce({
        data: {
          private: false,
          default_branch: 'main',
          clone_url: 'https://github.com/facebook/react.git',
          size: 512_000,
        },
      })
      .mockResolvedValueOnce({
        data: {
          sha: 'not-a-real-sha',
        },
      });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      message: 'GitHub returned an invalid commit SHA.',
    });
  });

  it('maps unexpected GitHub errors to service unavailable', async () => {
    requestMock.mockRejectedValueOnce({
      status: 500,
      response: {
        headers: {},
      },
    });

    const client = new GitHubClient();

    await expect(client.resolveRepository(repository)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
      message: 'GitHub repository information could not be retrieved.',
    });
  });
});
