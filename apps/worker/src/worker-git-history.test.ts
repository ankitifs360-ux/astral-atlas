import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import { loadGitHistoryTouches } from './worker-git-history.js';

const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];

async function runGit(repositoryDirectory: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', repositoryDirectory, ...args], {
    encoding: 'utf8',
  });

  return result.stdout.trim();
}

async function createGitRepository(): Promise<string> {
  const repositoryDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-git-history-test-'));

  temporaryDirectories.push(repositoryDirectory);

  await runGit(repositoryDirectory, ['init', '--quiet']);

  /*
   * Local repository identity keeps tests
   * independent from the developer's global
   * Git configuration.
   */
  await runGit(repositoryDirectory, ['config', 'user.name', 'Astral Atlas Test']);

  await runGit(repositoryDirectory, ['config', 'user.email', 'test@astral-atlas.local']);

  return repositoryDirectory;
}

async function commitAll(repositoryDirectory: string, message: string): Promise<string> {
  await runGit(repositoryDirectory, ['add', '--all']);

  await runGit(repositoryDirectory, ['commit', '--quiet', '--message', message]);

  return runGit(repositoryDirectory, ['rev-parse', '--verify', 'HEAD']);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }),
  );
});

describe('loadGitHistoryTouches', () => {
  it('reads commit-to-file touches from local Git history', async () => {
    const repositoryDirectory = await createGitRepository();

    const sourceDirectory = join(repositoryDirectory, 'src');

    await mkdir(sourceDirectory, {
      recursive: true,
    });

    await writeFile(
      join(sourceDirectory, 'app.ts'),
      ['export function app() {', '  return true;', '}', ''].join('\n'),
      'utf8',
    );

    const firstCommitSha = await commitAll(repositoryDirectory, 'Add app');

    await writeFile(
      join(sourceDirectory, 'app.ts'),
      ['export function app() {', "  return 'updated';", '}', ''].join('\n'),
      'utf8',
    );

    await writeFile(
      join(sourceDirectory, 'helper.ts'),
      ['export function helper() {', '  return 42;', '}', ''].join('\n'),
      'utf8',
    );

    const secondCommitSha = await commitAll(repositoryDirectory, 'Update app and add helper');

    const touches = await loadGitHistoryTouches(repositoryDirectory);

    expect(touches).toEqual(
      expect.arrayContaining([
        {
          commitSha: firstCommitSha,

          filePath: 'src/app.ts',
        },

        {
          commitSha: secondCommitSha,

          filePath: 'src/app.ts',
        },

        {
          commitSha: secondCommitSha,

          filePath: 'src/helper.ts',
        },
      ]),
    );

    expect(touches).toHaveLength(3);
  });

  it('handles repository paths containing spaces', async () => {
    const repositoryDirectory = await createGitRepository();

    const sourceDirectory = join(repositoryDirectory, 'src');

    await mkdir(sourceDirectory, {
      recursive: true,
    });

    await writeFile(join(sourceDirectory, 'my helper.ts'), 'export const value = 1;\n', 'utf8');

    const commitSha = await commitAll(repositoryDirectory, 'Add spaced path');

    await expect(loadGitHistoryTouches(repositoryDirectory)).resolves.toEqual([
      {
        commitSha,

        filePath: 'src/my helper.ts',
      },
    ]);
  });

  it('returns an empty touch list for a repository with no commits', async () => {
    const repositoryDirectory = await createGitRepository();

    await expect(loadGitHistoryTouches(repositoryDirectory)).rejects.toThrow(
      'Git repository history could not be read',
    );
  });

  it('rejects an empty repository directory', async () => {
    await expect(loadGitHistoryTouches('   ')).rejects.toThrow(
      'Git repository directory cannot be empty',
    );
  });

  it('rejects a directory that is not a Git repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'astral-atlas-not-git-test-'));

    temporaryDirectories.push(directory);

    await expect(loadGitHistoryTouches(directory)).rejects.toThrow(
      'Git repository history could not be read',
    );
  });
});
