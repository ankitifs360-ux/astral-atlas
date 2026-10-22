import { execFile } from 'node:child_process';

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readGitHistoryFileTouches } from './git-runner.js';

const execFileAsync = promisify(execFile);

async function runLocalGit(
  repositoryDirectory: string,

  args: readonly string[],
): Promise<string> {
  const result = await execFileAsync('git', ['-C', repositoryDirectory, ...args], {
    encoding: 'utf8',

    env: {
      PATH: process.env.PATH,

      HOME: process.env.HOME,

      GIT_TERMINAL_PROMPT: '0',
    },
  });

  return result.stdout.trim();
}

async function commitAll(
  repositoryDirectory: string,

  message: string,
): Promise<string> {
  await runLocalGit(repositoryDirectory, ['add', '--all']);

  /*
   * Supply identity only to this command.
   *
   * The test does not depend on the developer's
   * machine-wide Git configuration.
   */
  await runLocalGit(repositoryDirectory, [
    '-c',
    'user.name=Astral Atlas Tests',

    '-c',
    'user.email=tests@astral-atlas.local',

    'commit',

    '--quiet',

    '-m',
    message,
  ]);

  return (await runLocalGit(repositoryDirectory, ['rev-parse', '--verify', 'HEAD'])).toLowerCase();
}

describe('readGitHistoryFileTouches integration', () => {
  let repositoryDirectory: string;

  beforeEach(async () => {
    repositoryDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-git-history-'));

    await runLocalGit(repositoryDirectory, ['init', '--quiet']);

    await mkdir(join(repositoryDirectory, 'src'), {
      recursive: true,
    });
  });

  afterEach(async () => {
    await rm(repositoryDirectory, {
      recursive: true,

      force: true,
    });
  });

  it('returns commit and file-path touches from real Git history', async () => {
    await writeFile(join(repositoryDirectory, 'src', 'app.ts'), 'export const app = 1;\n');

    await writeFile(join(repositoryDirectory, 'src', 'service.ts'), 'export const service = 1;\n');

    const firstCommitSha = await commitAll(repositoryDirectory, 'initial files');

    await writeFile(join(repositoryDirectory, 'src', 'app.ts'), 'export const app = 2;\n');

    const secondCommitSha = await commitAll(repositoryDirectory, 'update app');

    const touches = await readGitHistoryFileTouches(repositoryDirectory);

    expect(touches).toHaveLength(3);

    expect(touches).toEqual(
      expect.arrayContaining([
        {
          commitSha: firstCommitSha,

          filePath: 'src/app.ts',
        },

        {
          commitSha: firstCommitSha,

          filePath: 'src/service.ts',
        },

        {
          commitSha: secondCommitSha,

          filePath: 'src/app.ts',
        },
      ]),
    );
  });

  it('preserves file names containing spaces', async () => {
    const filePath = 'src/file with spaces.ts';

    await writeFile(join(repositoryDirectory, filePath), 'export const value = 1;\n');

    const commitSha = await commitAll(repositoryDirectory, 'add spaced filename');

    await expect(readGitHistoryFileTouches(repositoryDirectory)).resolves.toEqual([
      {
        commitSha,

        filePath,
      },
    ]);
  });

  it('preserves file names containing newline characters', async () => {
    /*
     * Newlines are legal inside Git file names.
     *
     * This test is why the production history
     * reader uses NUL-delimited output instead
     * of splitting on "\\n".
     */
    const filePath = 'src/odd\nname.ts';

    await writeFile(join(repositoryDirectory, filePath), 'export const unusual = true;\n');

    const commitSha = await commitAll(repositoryDirectory, 'add unusual filename');

    const touches = await readGitHistoryFileTouches(repositoryDirectory);

    expect(touches).toEqual([
      {
        commitSha,

        filePath,
      },
    ]);
  });

  it('returns newest commit history first', async () => {
    await writeFile(join(repositoryDirectory, 'src', 'app.ts'), 'export const version = 1;\n');

    const firstCommitSha = await commitAll(repositoryDirectory, 'version one');

    await writeFile(join(repositoryDirectory, 'src', 'app.ts'), 'export const version = 2;\n');

    const secondCommitSha = await commitAll(repositoryDirectory, 'version two');

    const touches = await readGitHistoryFileTouches(repositoryDirectory);

    expect(touches.map((touch) => touch.commitSha)).toEqual([secondCommitSha, firstCommitSha]);
  });
});
