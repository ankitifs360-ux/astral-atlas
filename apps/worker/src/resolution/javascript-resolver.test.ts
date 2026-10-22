import { describe, expect, it } from 'vitest';

import { RepositoryFileIndex } from './file-index.js';

import { resolveJavaScriptRelativeImport } from './javascript-resolver.js';

describe('resolveJavaScriptRelativeImport', () => {
  it('resolves an exact relative JavaScript file', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/user.js']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './user.js')).toBe('src/user.js');
  });

  it('prefers an exact JavaScript file over TypeScript substitution', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/user.js', 'src/user.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './user.js')).toBe('src/user.js');
  });

  it('resolves a .js specifier to a .ts source file', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/user.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './user.js')).toBe('src/user.ts');
  });

  it('resolves a .js specifier to a .tsx source file', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/component.tsx']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './component.js')).toBe(
      'src/component.tsx',
    );
  });

  it('resolves .jsx to .tsx', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/component.tsx']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './component.jsx')).toBe(
      'src/component.tsx',
    );
  });

  it('resolves .mjs to .mts', () => {
    const index = new RepositoryFileIndex(['src/app.mts', 'src/config.mts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.mts', './config.mjs')).toBe(
      'src/config.mts',
    );
  });

  it('resolves .cjs to .cts', () => {
    const index = new RepositoryFileIndex(['src/app.cts', 'src/config.cts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.cts', './config.cjs')).toBe(
      'src/config.cts',
    );
  });

  it('resolves an extensionless import to a TypeScript file', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/services/user.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './services/user')).toBe(
      'src/services/user.ts',
    );
  });

  it('resolves an extensionless directory import to index.ts', () => {
    const index = new RepositoryFileIndex(['src/app.ts', 'src/utils/index.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './utils')).toBe(
      'src/utils/index.ts',
    );
  });

  it('resolves parent-directory relative imports', () => {
    const index = new RepositoryFileIndex(['src/features/app.ts', 'src/shared/config.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/features/app.ts', '../shared/config')).toBe(
      'src/shared/config.ts',
    );
  });

  it('returns null when the target does not exist', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './missing.js')).toBeNull();
  });

  it('returns null for external package specifiers', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', 'express')).toBeNull();

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', '@scope/package')).toBeNull();

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', 'node:fs')).toBeNull();
  });

  it('returns null when a relative import escapes the repository root', () => {
    const index = new RepositoryFileIndex(['src/app.ts']);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', '../../outside.js')).toBeNull();
  });

  it('preserves candidate priority for extensionless imports', () => {
    const index = new RepositoryFileIndex([
      'src/app.ts',
      'src/user.ts',
      'src/user.tsx',
      'src/user/index.ts',
    ]);

    expect(resolveJavaScriptRelativeImport(index, 'src/app.ts', './user')).toBe('src/user.ts');
  });
});
