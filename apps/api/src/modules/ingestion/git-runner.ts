import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

const execFileAsync = promisify(execFile);

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

export interface GitCheckoutInput {
  owner: string;
  repo: string;
  commitSha: string;
  destinationDirectory: string;
}

export interface GitCheckoutResult {
  commitSha: string;
  remoteUrl: string;
}

interface GitCommandError {
  code?: string | number;
  signal?: NodeJS.Signals;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function isGitCommandError(error: unknown): error is GitCommandError {
  return typeof error === 'object' && error !== null;
}

function validateCheckoutInput(input: GitCheckoutInput): void {
  if (!GITHUB_OWNER_PATTERN.test(input.owner)) {
    throw new AppError('BAD_REQUEST', 400, 'GitHub repository owner is invalid.');
  }

  if (!GITHUB_REPOSITORY_PATTERN.test(input.repo)) {
    throw new AppError('BAD_REQUEST', 400, 'GitHub repository name is invalid.');
  }

  if (!COMMIT_SHA_PATTERN.test(input.commitSha)) {
    throw new AppError('BAD_REQUEST', 400, 'Git commit SHA is invalid.');
  }
}

async function runGit(args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      timeout: INGESTION_LIMITS.gitOperationTimeoutMs,

      maxBuffer: MAX_GIT_OUTPUT_BYTES,

      encoding: 'utf8',

      /*
       * Important security hardening:
       *
       * - never prompt for credentials
       * - ignore machine/user Git configuration
       * - avoid SSH prompting
       *
       * This prevents local Git config such as
       * url.<something>.insteadOf from silently rewriting
       * our validated GitHub URL to another host.
       */
      env: {
        PATH: process.env.PATH,

        HOME: process.env.HOME,

        GIT_TERMINAL_PROMPT: '0',

        GIT_CONFIG_NOSYSTEM: '1',

        GIT_CONFIG_GLOBAL: '/dev/null',

        GIT_ASKPASS: '/bin/false',

        SSH_ASKPASS: '/bin/false',
      },
    });

    return result.stdout.trim();
  } catch (error: unknown) {
    if (isGitCommandError(error) && error.killed) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Git operation timed out.');
    }

    throw new AppError('SERVICE_UNAVAILABLE', 503, 'Git repository could not be downloaded.');
  }
}

export async function checkoutGitHubCommit(input: GitCheckoutInput): Promise<GitCheckoutResult> {
  validateCheckoutInput(input);

  const expectedCommitSha = input.commitSha.toLowerCase();

  /*
   * Construct the URL ourselves instead of trusting a URL
   * supplied by the repository being analysed.
   *
   * owner and repo were validated above, so Git can only
   * contact github.com here.
   */
  const remoteUrl = `https://github.com/${input.owner}/${input.repo}.git`;

  await runGit(['init', '--quiet', input.destinationDirectory]);

  await runGit(['-C', input.destinationDirectory, 'remote', 'add', 'origin', remoteUrl]);

  /*
   * Fetch the exact immutable commit instead of "main".
   *
   * Depth 100 gives us a bounded amount of commit history,
   * which will later be useful for churn metrics without
   * cloning unlimited history.
   */
  await runGit([
    '-C',
    input.destinationDirectory,

    '-c',
    'protocol.version=2',

    'fetch',

    '--quiet',
    '--no-tags',
    '--depth=100',

    'origin',
    expectedCommitSha,
  ]);

  await runGit(['-C', input.destinationDirectory, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);

  const actualCommitSha = (
    await runGit(['-C', input.destinationDirectory, 'rev-parse', '--verify', 'HEAD'])
  ).toLowerCase();

  /*
   * This check protects us from a race or unexpected Git
   * behavior. The checked-out repository must be exactly
   * the SHA resolved earlier through GitHub.
   */
  if (actualCommitSha !== expectedCommitSha) {
    throw new AppError(
      'SERVICE_UNAVAILABLE',
      503,
      'Downloaded repository commit does not match the expected GitHub commit.',
    );
  }

  return {
    commitSha: actualCommitSha,
    remoteUrl,
  };
}
