import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkoutGitHubCommit, type GitCheckoutInput } from './git-runner.js';
import { withTempWorkspace } from './temp-workspace.js';

const originalPath = process.env.PATH;

interface FakeGitOptions {
  commitSha: string;
  failWhenCommandContains?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function escapeForDoubleQuotedShell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('`', '\\`');
}

async function installFakeGit(
  binDirectory: string,
  logPath: string,
  options: FakeGitOptions,
): Promise<void> {
  await mkdir(binDirectory, {
    recursive: true,
  });

  const escapedLogPath = escapeForDoubleQuotedShell(logPath);

  const escapedCommitSha = escapeForDoubleQuotedShell(options.commitSha);

  const failureBlock = options.failWhenCommandContains
    ? `
case "$*" in
  *"${escapeForDoubleQuotedShell(options.failWhenCommandContains)}"*)
    echo "simulated git failure" >&2
    exit 1
    ;;
esac
`
    : '';

  const script = `#!/bin/sh

printf '%s\\n' "$*" >> "${escapedLogPath}"
${failureBlock}
case "$*" in
  *"rev-parse --verify HEAD"*)
    printf '%s\\n' "${escapedCommitSha}"
    ;;
esac

exit 0
`;

  const gitPath = join(binDirectory, 'git');

  await writeFile(gitPath, script, {
    encoding: 'utf8',
    mode: 0o700,
  });
}

afterEach(() => {
  process.env.PATH = originalPath;
});

describe('checkoutGitHubCommit', () => {
  it('runs a bounded checkout for the exact GitHub commit', async () => {
    await withTempWorkspace(async (workspace) => {
      const expectedSha = 'a'.repeat(40);

      const fakeBinDirectory = join(workspace.rootDir, 'fake-bin');

      const commandLogPath = join(workspace.rootDir, 'git-commands.log');

      await installFakeGit(fakeBinDirectory, commandLogPath, {
        commitSha: expectedSha,
      });

      process.env.PATH = `${fakeBinDirectory}:${originalPath ?? ''}`;

      const input: GitCheckoutInput = {
        owner: 'facebook',
        repo: 'react',
        commitSha: expectedSha,
        destinationDirectory: workspace.repositoryDir,
      };

      const result = await checkoutGitHubCommit(input);

      expect(result).toEqual({
        commitSha: expectedSha,

        remoteUrl: 'https://github.com/facebook/react.git',
      });

      const commandLog = await readFile(commandLogPath, 'utf8');

      const commands = commandLog.trim().split('\n');

      expect(commands).toHaveLength(5);

      expect(commands[0]).toContain('init --quiet');

      expect(commands[1]).toContain('remote add origin https://github.com/facebook/react.git');

      expect(commands[2]).toContain('fetch --quiet --no-tags --depth=100 origin');

      expect(commands[2]).toContain(expectedSha);

      expect(commands[3]).toContain('checkout --quiet --detach FETCH_HEAD');

      expect(commands[4]).toContain('rev-parse --verify HEAD');
    });
  });

  it('rejects an invalid commit SHA before running Git', async () => {
    await withTempWorkspace(async (workspace) => {
      const fakeBinDirectory = join(workspace.rootDir, 'fake-bin');

      const commandLogPath = join(workspace.rootDir, 'git-commands.log');

      await installFakeGit(fakeBinDirectory, commandLogPath, {
        commitSha: 'a'.repeat(40),
      });

      process.env.PATH = `${fakeBinDirectory}:${originalPath ?? ''}`;

      await expect(
        checkoutGitHubCommit({
          owner: 'facebook',
          repo: 'react',

          commitSha: 'not-a-valid-sha',

          destinationDirectory: workspace.repositoryDir,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'Git commit SHA is invalid.',
      });

      expect(await pathExists(commandLogPath)).toBe(false);
    });
  });

  it('rejects an invalid GitHub owner before running Git', async () => {
    await withTempWorkspace(async (workspace) => {
      await expect(
        checkoutGitHubCommit({
          owner: '../danger',
          repo: 'react',

          commitSha: 'a'.repeat(40),

          destinationDirectory: workspace.repositoryDir,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'GitHub repository owner is invalid.',
      });
    });
  });

  it('rejects an invalid GitHub repository name before running Git', async () => {
    await withTempWorkspace(async (workspace) => {
      await expect(
        checkoutGitHubCommit({
          owner: 'facebook',
          repo: 'bad/repository',

          commitSha: 'a'.repeat(40),

          destinationDirectory: workspace.repositoryDir,
        }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'GitHub repository name is invalid.',
      });
    });
  });

  it('rejects a checkout when HEAD does not match the expected SHA', async () => {
    await withTempWorkspace(async (workspace) => {
      const expectedSha = 'a'.repeat(40);

      const actualSha = 'b'.repeat(40);

      const fakeBinDirectory = join(workspace.rootDir, 'fake-bin');

      const commandLogPath = join(workspace.rootDir, 'git-commands.log');

      await installFakeGit(fakeBinDirectory, commandLogPath, {
        commitSha: actualSha,
      });

      process.env.PATH = `${fakeBinDirectory}:${originalPath ?? ''}`;

      await expect(
        checkoutGitHubCommit({
          owner: 'facebook',
          repo: 'react',
          commitSha: expectedSha,
          destinationDirectory: workspace.repositoryDir,
        }),
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',

        statusCode: 503,

        message: 'Downloaded repository commit does not match the expected GitHub commit.',
      });
    });
  });

  it('maps Git command failures to service unavailable', async () => {
    await withTempWorkspace(async (workspace) => {
      const expectedSha = 'a'.repeat(40);

      const fakeBinDirectory = join(workspace.rootDir, 'fake-bin');

      const commandLogPath = join(workspace.rootDir, 'git-commands.log');

      await installFakeGit(fakeBinDirectory, commandLogPath, {
        commitSha: expectedSha,

        failWhenCommandContains: 'fetch',
      });

      process.env.PATH = `${fakeBinDirectory}:${originalPath ?? ''}`;

      await expect(
        checkoutGitHubCommit({
          owner: 'facebook',
          repo: 'react',
          commitSha: expectedSha,
          destinationDirectory: workspace.repositoryDir,
        }),
      ).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',

        statusCode: 503,

        message: 'Git repository could not be downloaded.',
      });
    });
  });
});
