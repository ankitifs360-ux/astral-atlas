import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

const execFileAsync = promisify(execFile);

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?$/;

const GITHUB_REPOSITORY_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

/*
 * Git history can contain considerably more
 * output than checkout commands because each
 * commit may list many file paths.
 *
 * Keep it bounded, but allow more room than the
 * normal Git command output.
 */
const MAX_GIT_HISTORY_OUTPUT_BYTES = 8 * 1024 * 1024;

const MAX_GIT_HISTORY_COMMITS = 100;

const HISTORY_COMMIT_PREFIX = 'astral-commit:';

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

export interface GitHistoryFileTouch {
  commitSha: string;

  filePath: string;
}

interface GitCommandError {
  code?: string | number;

  signal?: NodeJS.Signals;

  killed?: boolean;

  stdout?: string;

  stderr?: string;
}

interface RunGitOptions {
  maxBuffer?: number;

  failureMessage?: string;
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

async function runGit(args: readonly string[], options: RunGitOptions = {}): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      timeout: INGESTION_LIMITS.gitOperationTimeoutMs,

      maxBuffer: options.maxBuffer ?? MAX_GIT_OUTPUT_BYTES,

      encoding: 'utf8',

      /*
       * Important security hardening:
       *
       * - never prompt for credentials
       * - ignore machine/user Git configuration
       * - avoid SSH prompting
       *
       * This prevents local Git config such as
       * url.<something>.insteadOf from silently
       * rewriting our validated GitHub URL to
       * another host.
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

    throw new AppError(
      'SERVICE_UNAVAILABLE',
      503,
      options.failureMessage ?? 'Git repository could not be downloaded.',
    );
  }
}

export async function checkoutGitHubCommit(input: GitCheckoutInput): Promise<GitCheckoutResult> {
  validateCheckoutInput(input);

  const expectedCommitSha = input.commitSha.toLowerCase();

  /*
   * Construct the URL ourselves instead of trusting
   * a URL supplied by the repository being analysed.
   *
   * owner and repo were validated above, so Git can
   * only contact github.com here.
   */
  const remoteUrl = `https://github.com/${input.owner}/${input.repo}.git`;

  await runGit(['init', '--quiet', input.destinationDirectory]);

  await runGit(['-C', input.destinationDirectory, 'remote', 'add', 'origin', remoteUrl]);

  /*
   * Fetch the exact immutable commit instead of
   * "main".
   *
   * Depth 100 gives us a bounded amount of commit
   * history for churn metrics without cloning
   * unlimited history.
   */
  await runGit([
    '-C',
    input.destinationDirectory,

    '-c',
    'protocol.version=2',

    'fetch',

    '--quiet',

    '--no-tags',

    `--depth=${MAX_GIT_HISTORY_COMMITS}`,

    'origin',

    expectedCommitSha,
  ]);

  await runGit(['-C', input.destinationDirectory, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);

  const actualCommitSha = (
    await runGit(['-C', input.destinationDirectory, 'rev-parse', '--verify', 'HEAD'])
  ).toLowerCase();

  /*
   * This protects us from a race or unexpected Git
   * behavior. The checked-out repository must be
   * exactly the SHA resolved earlier through GitHub.
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

export async function readGitHistoryFileTouches(
  repositoryDirectory: string,
): Promise<GitHistoryFileTouch[]> {
  /*
   * We only inspect history already fetched during
   * checkout.
   *
   * No network access happens here.
   *
   * --max-count=100 keeps this bounded even if the
   * checkout strategy changes later.
   *
   * --no-renames makes each historical path explicit
   * instead of asking Git to perform rename detection.
   *
   * -z makes file paths NUL-delimited. Git file names
   * cannot contain a NUL byte, so this is safer than
   * splitting paths on ordinary newlines.
   */
  const output = await runGit(
    [
      '-C',
      repositoryDirectory,

      'log',

      `--max-count=${MAX_GIT_HISTORY_COMMITS}`,

      `--format=${HISTORY_COMMIT_PREFIX}%H`,

      '--name-only',

      '--no-renames',

      '-z',

      'HEAD',

      '--',
    ],
    {
      maxBuffer: MAX_GIT_HISTORY_OUTPUT_BYTES,

      failureMessage: 'Git repository history could not be read.',
    },
  );

  if (output.length === 0) {
    return [];
  }

  const touches: GitHistoryFileTouch[] = [];

  let currentCommitSha: string | null = null;

  let expectingFirstPath = false;

  for (const rawToken of output.split('\0')) {
    if (rawToken.length === 0) {
      continue;
    }

    if (rawToken.startsWith(HISTORY_COMMIT_PREFIX)) {
      const commitSha = rawToken.slice(HISTORY_COMMIT_PREFIX.length).trim();

      if (!COMMIT_SHA_PATTERN.test(commitSha)) {
        throw new AppError(
          'SERVICE_UNAVAILABLE',
          503,
          'Git repository history contained an invalid commit SHA.',
        );
      }

      currentCommitSha = commitSha.toLowerCase();

      expectingFirstPath = true;

      continue;
    }

    if (currentCommitSha === null) {
      throw new AppError('SERVICE_UNAVAILABLE', 503, 'Git repository history could not be parsed.');
    }

    /*
     * Git inserts a formatting newline between the
     * pretty-printed commit header and the first
     * --name-only path.
     *
     * Remove exactly that one newline.
     *
     * If a real file name itself starts with a newline,
     * any additional newline remains part of the path.
     */
    const filePath = expectingFirstPath && rawToken.startsWith('\n') ? rawToken.slice(1) : rawToken;

    expectingFirstPath = false;

    if (filePath.length === 0) {
      continue;
    }

    touches.push({
      commitSha: currentCommitSha,

      filePath,
    });
  }

  return touches;
}
