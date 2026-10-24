import { execFile } from 'node:child_process';
import { posix } from 'node:path';
import { promisify } from 'node:util';

import type { GitHistoryFileTouch } from './metrics/git-history-churn.js';

const execFileAsync = promisify(execFile);

/*
 * worker-git-checkout.ts fetches a bounded history:
 *
 * --depth=100
 *
 * Keep the history reader bounded to the same
 * maximum number of commits.
 */
const MAX_HISTORY_COMMITS = 100;

/*
 * Git history output can be larger than checkout
 * command output because it includes file paths
 * for many commits.
 *
 * Keep it bounded so a malicious repository cannot
 * make the worker allocate unlimited memory.
 */
const MAX_GIT_HISTORY_OUTPUT_BYTES = 8 * 1024 * 1024;

const GIT_HISTORY_TIMEOUT_MS = 30_000;

const COMMIT_MARKER = 'ASTRAL_ATLAS_COMMIT:';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

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

async function runGit(args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], {
      timeout: GIT_HISTORY_TIMEOUT_MS,

      maxBuffer: MAX_GIT_HISTORY_OUTPUT_BYTES,

      encoding: 'utf8',

      /*
       * Match the checkout security model.
       *
       * Reading local Git history must never:
       *
       * - prompt for credentials
       * - invoke user/system Git configuration
       * - trigger SSH authentication
       *
       * No network access is required here.
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

    return result.stdout;
  } catch (error: unknown) {
    if (isGitCommandError(error) && error.killed) {
      throw new Error('Git history operation timed out', {
        cause: error,
      });
    }

    throw new Error('Git repository history could not be read', {
      cause: error,
    });
  }
}

function normalizeGitFilePath(filePath: string): string | null {
  /*
   * Git log normally emits one relative repository
   * path per line.
   *
   * Empty lines separate commits and are ignored.
   */
  const normalizedInput = filePath.trim();

  if (normalizedInput.length === 0) {
    return null;
  }

  if (normalizedInput.includes('\0')) {
    throw new Error('Git history contains a file path with a null byte');
  }

  if (normalizedInput.startsWith('/')) {
    throw new Error(`Git history contains an absolute file path: "${normalizedInput}"`);
  }

  /*
   * Git internally represents repository paths
   * using "/" separators.
   *
   * Reject traversal components even though normal
   * tracked Git paths should never escape the repo.
   */
  const segments = normalizedInput.split('/');

  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Git history contains an unsafe file path: "${normalizedInput}"`);
  }

  const normalized = posix.normalize(normalizedInput);

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Git history contains an unsafe file path: "${normalizedInput}"`);
  }

  return normalized;
}

function parseGitHistoryOutput(output: string): GitHistoryFileTouch[] {
  const touches: GitHistoryFileTouch[] = [];

  let currentCommitSha: string | null = null;

  /*
   * Git log output produced below looks like:
   *
   * ASTRAL_ATLAS_COMMIT:<sha>
   *
   * src/app.ts
   * src/service.ts
   *
   * ASTRAL_ATLAS_COMMIT:<sha>
   *
   * src/app.ts
   */
  for (const rawLine of output.split(/\r?\n/)) {
    /*
     * Do not trim before checking the commit marker,
     * except for CR/LF already removed by split().
     */
    if (rawLine.startsWith(COMMIT_MARKER)) {
      const commitSha = rawLine.slice(COMMIT_MARKER.length).trim().toLowerCase();

      if (!COMMIT_SHA_PATTERN.test(commitSha)) {
        throw new Error(`Git history contains an invalid commit SHA: "${commitSha}"`);
      }

      currentCommitSha = commitSha;

      continue;
    }

    const filePath = normalizeGitFilePath(rawLine);

    if (filePath === null) {
      continue;
    }

    if (currentCommitSha === null) {
      throw new Error('Git history returned a file path before a commit identifier');
    }

    touches.push({
      commitSha: currentCommitSha,

      filePath,
    });
  }

  return touches;
}

/**
 * Reads the bounded Git history already fetched by
 * worker-git-checkout.ts and converts it into the
 * generic churn input expected by the metrics layer.
 *
 * Important:
 *
 * - this never contacts GitHub
 * - this never executes repository code
 * - this only reads local .git metadata
 * - history is capped to MAX_HISTORY_COMMITS
 */
export async function loadGitHistoryTouches(
  repositoryDirectory: string,
): Promise<readonly GitHistoryFileTouch[]> {
  const normalizedRepositoryDirectory = requireNonEmpty(
    repositoryDirectory,
    'Git repository directory',
  );

  /*
   * Marker lines make commit boundaries explicit
   * and avoid relying on Git's human-readable
   * default log formatting.
   *
   * --name-only:
   *   only file paths are needed for churn.
   *
   * --no-renames:
   *   treat the path recorded at each commit as
   *   that commit's touched path. The downstream
   *   churn mapper later filters history to files
   *   that exist in the current analysis.
   *
   * --max-count:
   *   prevents unlimited history processing even
   *   if the checkout policy changes later.
   */
  const output = await runGit([
    '-C',

    normalizedRepositoryDirectory,

    '-c',

    'core.quotepath=false',

    'log',

    `--format=${COMMIT_MARKER}%H`,

    '--name-only',

    '--no-renames',

    `--max-count=${MAX_HISTORY_COMMITS}`,

    'HEAD',
  ]);

  return parseGitHistoryOutput(output);
}
