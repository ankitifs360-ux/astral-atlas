import { AppError } from '../../errors.js';

const GITHUB_HOSTNAME = 'github.com';

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

export interface ParsedGitHubRepositoryUrl {
  owner: string;
  repo: string;
  canonicalUrl: string;
  sourceKey: string;
}

function invalidGitHubUrl(message: string): never {
  throw new AppError('BAD_REQUEST', 400, message, [
    {
      field: 'repositoryUrl',
      message,
    },
  ]);
}

export function parseGitHubRepositoryUrl(input: string): ParsedGitHubRepositoryUrl {
  const trimmedInput = input.trim();

  if (trimmedInput.length === 0) {
    invalidGitHubUrl('GitHub repository URL cannot be empty.');
  }

  let url: URL;

  try {
    url = new URL(trimmedInput);
  } catch {
    invalidGitHubUrl('GitHub repository URL is not a valid URL.');
  }

  if (url.protocol !== 'https:') {
    invalidGitHubUrl('GitHub repository URL must use HTTPS.');
  }

  if (url.hostname.toLowerCase() !== GITHUB_HOSTNAME) {
    invalidGitHubUrl('Only github.com repository URLs are allowed.');
  }

  if (url.username || url.password) {
    invalidGitHubUrl('GitHub repository URL must not contain credentials.');
  }

  if (url.port) {
    invalidGitHubUrl('GitHub repository URL must not contain a custom port.');
  }

  if (url.search) {
    invalidGitHubUrl('GitHub repository URL must not contain query parameters.');
  }

  if (url.hash) {
    invalidGitHubUrl('GitHub repository URL must not contain a fragment.');
  }

  const encodedSegments = url.pathname.split('/').filter((segment) => segment.length > 0);

  if (encodedSegments.length !== 2) {
    invalidGitHubUrl(
      'GitHub URL must point directly to a repository, for example https://github.com/owner/repository.',
    );
  }

  let owner: string;
  let repositorySegment: string;

  try {
    owner = decodeURIComponent(encodedSegments[0] ?? '');

    repositorySegment = decodeURIComponent(encodedSegments[1] ?? '');
  } catch {
    invalidGitHubUrl('GitHub repository URL contains invalid encoded characters.');
  }

  const repo = repositorySegment.endsWith('.git')
    ? repositorySegment.slice(0, -4)
    : repositorySegment;

  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    invalidGitHubUrl('GitHub repository owner is invalid.');
  }

  if (!GITHUB_REPOSITORY_PATTERN.test(repo)) {
    invalidGitHubUrl('GitHub repository name is invalid.');
  }

  return {
    owner,
    repo,

    canonicalUrl: `https://github.com/${owner}/${repo}`,

    // GitHub repository names are effectively case-insensitive.
    // Normalizing prevents duplicate database identities.
    sourceKey: `github:${owner.toLowerCase()}/${repo.toLowerCase()}`,
  };
}
