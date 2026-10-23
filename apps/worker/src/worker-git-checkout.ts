import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { WorkerGitCheckoutInput } from './default-repository-source-preparer.js';

export interface WorkerGitCheckoutResult {
  commitSha: string;
}

export type WorkerGitCheckout = (input: WorkerGitCheckoutInput) => Promise<WorkerGitCheckoutResult>;
const execFileAsync = promisify(execFile);

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/*
 * Git output is never expected to be large.
 *
 * Bounding stdout/stderr prevents an unexpected Git process
 * from consuming unbounded worker memory.
 */
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

/*
 * Each individual Git command has its own timeout.
 *
 * The outer BullMQ job can still have a larger lifecycle
 * timeout later.
 */
const GIT_OPERATION_TIMEOUT_MS = 120_000;

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

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

function validateInput(input: WorkerGitCheckoutInput): {
  owner: string;
  repo: string;
  commitSha: string;
  destinationDirectory: string;
} {
  const owner = requireNonEmpty(input.owner, 'GitHub repository owner');

  const repo = requireNonEmpty(input.repo, 'GitHub repository name');

  const commitSha = requireNonEmpty(input.commitSha, 'Git commit SHA').toLowerCase();

  const destinationDirectory = requireNonEmpty(
    input.destinationDirectory,
    'Git checkout destination directory',
  );

  if (!GITHUB_OWNER_PATTERN.test(owner)) {
    throw new Error('GitHub repository owner is invalid');
  }

  if (!GITHUB_REPOSITORY_PATTERN.test(repo)) {
    throw new Error('GitHub repository name is invalid');
  }

  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error('Git commit SHA is invalid');
  }

  return {
    owner,

    repo,

    commitSha,

    destinationDirectory,
  };
}

async function runGit(args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      timeout: GIT_OPERATION_TIMEOUT_MS,

      maxBuffer: MAX_GIT_OUTPUT_BYTES,

      encoding: 'utf8',

      /*
       * Security:
       *
       * Do not allow Git to:
       *
       * - prompt for credentials
       * - use machine-wide Git configuration
       * - use the user's global Git configuration
       * - open an SSH password prompt
       *
       * The worker must behave deterministically and must
       * never wait forever for interactive credentials.
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
      throw new Error('Git operation timed out', {
        cause: error,
      });
    }

    throw new Error('Git repository operation failed', {
      cause: error,
    });
  }
}

/*
 * Worker-owned Git checkout.
 *
 * Important:
 *
 * We never accept a remote Git URL from the queue payload.
 *
 * owner + repo are validated, and the URL is constructed
 * here so the worker can only clone from github.com.
 */
export const checkoutGitHubCommit: WorkerGitCheckout = async (
  input: WorkerGitCheckoutInput,
): Promise<WorkerGitCheckoutResult> => {
  const normalized = validateInput(input);

  const remoteUrl = `https://github.com/${normalized.owner}/${normalized.repo}.git`;

  /*
   * Create an empty repository first rather than using
   * "git clone".
   *
   * That lets us fetch exactly the immutable SHA resolved
   * earlier by the API instead of trusting a branch name.
   */
  await runGit(['init', '--quiet', normalized.destinationDirectory]);

  await runGit(['-C', normalized.destinationDirectory, 'remote', 'add', 'origin', remoteUrl]);

  /*
   * Fetch only a bounded history window.
   *
   * Depth 100 is enough for our churn metrics while avoiding
   * an unlimited repository-history download.
   */
  await runGit([
    '-C',

    normalized.destinationDirectory,

    '-c',

    'protocol.version=2',

    'fetch',

    '--quiet',

    '--no-tags',

    '--depth=100',

    'origin',

    normalized.commitSha,
  ]);

  /*
   * Detached checkout guarantees that analysis is attached
   * to the exact commit, not to a moving branch.
   */
  await runGit([
    '-C',

    normalized.destinationDirectory,

    'checkout',

    '--quiet',

    '--detach',

    'FETCH_HEAD',
  ]);

  const actualCommitSha = (
    await runGit(['-C', normalized.destinationDirectory, 'rev-parse', '--verify', 'HEAD'])
  ).toLowerCase();

  /*
   * Defense in depth:
   *
   * Even after asking Git for the exact SHA, verify that
   * the repository we will analyse is actually that SHA.
   */
  if (actualCommitSha !== normalized.commitSha) {
    throw new Error('Downloaded repository commit does not match the queued Git commit');
  }

  return {
    commitSha: actualCommitSha,
  };
};
