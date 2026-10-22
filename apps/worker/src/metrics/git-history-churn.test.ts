import { describe, expect, it } from 'vitest';

import { createChurnInputsFromGitHistory } from './git-history-churn.js';

describe('createChurnInputsFromGitHistory', () => {
  it('counts unique commits that touched each current file', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts', 'src/service.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-b',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-c',

            filePath: 'src/service.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 2,
      },

      {
        filePath: 'src/service.ts',

        changedCommitCount: 1,
      },
    ]);
  });

  it('does not double-count duplicate touches from the same commit', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-b',

            filePath: 'src/app.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 2,
      },
    ]);
  });

  it('returns zero churn for current files not touched in history', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts', 'src/new.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 1,
      },

      {
        filePath: 'src/new.ts',

        changedCommitCount: 0,
      },
    ]);
  });

  it('ignores historical files that do not exist in the current snapshot', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-old',

            filePath: 'src/deleted.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 1,
      },
    ]);
  });

  it('returns current files in deterministic path order', () => {
    expect(
      createChurnInputsFromGitHistory(['src/z.ts', 'src/a.ts', 'src/m.ts'], []).map(
        (item) => item.filePath,
      ),
    ).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('deduplicates duplicate current file paths', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts', 'src/app.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 1,
      },
    ]);
  });

  it('returns an empty array when there are no current files', () => {
    expect(
      createChurnInputsFromGitHistory(
        [],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/old.ts',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('rejects empty commit SHAs', () => {
    expect(() =>
      createChurnInputsFromGitHistory(
        ['src/app.ts'],
        [
          {
            commitSha: '',

            filePath: 'src/app.ts',
          },
        ],
      ),
    ).toThrow('Git history file touch must contain a commit SHA.');
  });

  it('rejects whitespace-only commit SHAs', () => {
    expect(() =>
      createChurnInputsFromGitHistory(
        ['src/app.ts'],
        [
          {
            commitSha: '   ',

            filePath: 'src/app.ts',
          },
        ],
      ),
    ).toThrow('Git history file touch must contain a commit SHA.');
  });

  it('counts the same commit independently for different files', () => {
    expect(
      createChurnInputsFromGitHistory(
        ['src/app.ts', 'src/service.ts'],
        [
          {
            commitSha: 'commit-a',

            filePath: 'src/app.ts',
          },

          {
            commitSha: 'commit-a',

            filePath: 'src/service.ts',
          },
        ],
      ),
    ).toEqual([
      {
        filePath: 'src/app.ts',

        changedCommitCount: 1,
      },

      {
        filePath: 'src/service.ts',

        changedCommitCount: 1,
      },
    ]);
  });
});
