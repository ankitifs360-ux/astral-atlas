import { describe, expect, it } from 'vitest';

import { RepositoryFileIndex, normalizeRepositoryPath } from './file-index.js';

describe('normalizeRepositoryPath', () => {
  it('normalizes forward and backward slashes', () => {
    expect(normalizeRepositoryPath('src\\services\\user.ts')).toBe('src/services/user.ts');
  });

  it('removes a harmless leading dot segment', () => {
    expect(normalizeRepositoryPath('./src/app.ts')).toBe('src/app.ts');
  });

  it('normalizes internal dot segments', () => {
    expect(normalizeRepositoryPath('src/./services/../app.ts')).toBe('src/app.ts');
  });

  it('rejects paths that escape the repository root', () => {
    expect(() => normalizeRepositoryPath('../secret.ts')).toThrow(
      'Repository file path escapes root: ../secret.ts',
    );

    expect(() => normalizeRepositoryPath('src/../../secret.ts')).toThrow(
      'Repository file path escapes root: src/../../secret.ts',
    );
  });

  it('rejects absolute Unix paths', () => {
    expect(() => normalizeRepositoryPath('/etc/passwd')).toThrow(
      'Repository file path must be relative: /etc/passwd',
    );
  });

  it('rejects absolute Windows paths', () => {
    expect(() => normalizeRepositoryPath('C:\\Users\\Ankit\\app.ts')).toThrow(
      'Repository file path must be relative: C:\\Users\\Ankit\\app.ts',
    );
  });

  it('rejects null bytes', () => {
    expect(() => normalizeRepositoryPath('src/app\0.ts')).toThrow(
      'Repository file path contains a null byte.',
    );
  });

  it('rejects empty repository paths', () => {
    expect(() => normalizeRepositoryPath('')).toThrow('Repository file path cannot be empty.');

    expect(() => normalizeRepositoryPath('.')).toThrow('Repository file path cannot be empty.');
  });
});

describe('RepositoryFileIndex', () => {
  it('stores normalized repository file paths', () => {
    const index = new RepositoryFileIndex(['./src/app.ts', 'src\\user.ts']);

    expect(index.size).toBe(2);

    expect(index.has('src/app.ts')).toBe(true);

    expect(index.has('src/user.ts')).toBe(true);
  });

  it('deduplicates equivalent normalized paths', () => {
    const index = new RepositoryFileIndex(['src/app.ts', './src/app.ts', 'src\\app.ts']);

    expect(index.size).toBe(1);
  });

  it('uses case-sensitive repository paths', () => {
    const index = new RepositoryFileIndex(['src/User.ts', 'src/user.ts']);

    expect(index.size).toBe(2);

    expect(index.has('src/User.ts')).toBe(true);

    expect(index.has('src/user.ts')).toBe(true);

    expect(index.has('src/USER.ts')).toBe(false);
  });

  it('finds the first existing candidate in priority order', () => {
    const index = new RepositoryFileIndex(['src/user.ts', 'src/user/index.ts']);

    expect(index.findFirst(['src/missing.ts', 'src/user.ts', 'src/user/index.ts'])).toBe(
      'src/user.ts',
    );
  });

  it('returns null when no candidate exists', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    expect(index.findFirst(['src/user.ts', 'src/user/index.ts'])).toBeNull();
  });

  it('returns file paths in deterministic sorted order', () => {
    const index = new RepositoryFileIndex(['src/zeta.ts', 'src/alpha.ts', 'src/middle.ts']);

    expect(index.toArray()).toEqual(['src/alpha.ts', 'src/middle.ts', 'src/zeta.ts']);
  });

  it('rejects unsafe paths during construction', () => {
    expect(() => new RepositoryFileIndex(['src/app.ts', '../secret.ts'])).toThrow(
      'Repository file path escapes root: ../secret.ts',
    );
  });
});
