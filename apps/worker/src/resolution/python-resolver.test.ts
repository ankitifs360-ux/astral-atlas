import { describe, expect, it } from 'vitest';

import { RepositoryFileIndex } from './file-index.js';

import { resolvePythonImport } from './python-resolver.js';

describe('resolvePythonImport', () => {
  it('resolves an absolute module to a Python file', () => {
    const index = new RepositoryFileIndex(['app.py', 'services/user.py']);

    expect(resolvePythonImport(index, 'app.py', 'services.user')).toBe('services/user.py');
  });

  it('resolves an absolute module to a package __init__.py', () => {
    const index = new RepositoryFileIndex(['app.py', 'services/user/__init__.py']);

    expect(resolvePythonImport(index, 'app.py', 'services.user')).toBe('services/user/__init__.py');
  });

  it('prefers a module file over package __init__.py', () => {
    const index = new RepositoryFileIndex([
      'app.py',
      'services/user.py',
      'services/user/__init__.py',
    ]);

    expect(resolvePythonImport(index, 'app.py', 'services.user')).toBe('services/user.py');
  });

  it('resolves a current-package relative import', () => {
    const index = new RepositoryFileIndex(['services/api/app.py', 'services/api/user.py']);

    expect(resolvePythonImport(index, 'services/api/app.py', '.user')).toBe('services/api/user.py');
  });

  it('resolves a parent-package relative import', () => {
    const index = new RepositoryFileIndex(['services/api/handler.py', 'services/shared.py']);

    expect(resolvePythonImport(index, 'services/api/handler.py', '..shared')).toBe(
      'services/shared.py',
    );
  });

  it('resolves a grandparent-package relative import', () => {
    const index = new RepositoryFileIndex(['services/api/v1/handler.py', 'services/shared.py']);

    expect(resolvePythonImport(index, 'services/api/v1/handler.py', '...shared')).toBe(
      'services/shared.py',
    );
  });

  it('resolves a bare current-package import to __init__.py', () => {
    const index = new RepositoryFileIndex(['services/api/app.py', 'services/api/__init__.py']);

    expect(resolvePythonImport(index, 'services/api/app.py', '.')).toBe('services/api/__init__.py');
  });

  it('resolves a bare parent-package import to __init__.py', () => {
    const index = new RepositoryFileIndex(['services/api/app.py', 'services/__init__.py']);

    expect(resolvePythonImport(index, 'services/api/app.py', '..')).toBe('services/__init__.py');
  });

  it('returns null when an absolute module does not exist', () => {
    const index = new RepositoryFileIndex(['app.py']);

    expect(resolvePythonImport(index, 'app.py', 'services.user')).toBeNull();
  });

  it('returns null when a relative module does not exist', () => {
    const index = new RepositoryFileIndex(['services/api/app.py']);

    expect(resolvePythonImport(index, 'services/api/app.py', '.missing')).toBeNull();
  });

  it('returns null when a relative import escapes the repository root', () => {
    const index = new RepositoryFileIndex(['app.py']);

    expect(resolvePythonImport(index, 'app.py', '..outside')).toBeNull();

    expect(resolvePythonImport(index, 'app.py', '...outside')).toBeNull();
  });

  it('rejects malformed module specifiers', () => {
    const index = new RepositoryFileIndex(['app.py', 'services/user.py']);

    expect(resolvePythonImport(index, 'app.py', 'services..user')).toBeNull();

    expect(resolvePythonImport(index, 'app.py', 'services/user')).toBeNull();

    expect(resolvePythonImport(index, 'app.py', 'services\\user')).toBeNull();
  });

  it('returns null for an empty specifier', () => {
    const index = new RepositoryFileIndex(['app.py']);

    expect(resolvePythonImport(index, 'app.py', '')).toBeNull();
  });

  it('is case-sensitive', () => {
    const index = new RepositoryFileIndex(['app.py', 'services/User.py']);

    expect(resolvePythonImport(index, 'app.py', 'services.User')).toBe('services/User.py');

    expect(resolvePythonImport(index, 'app.py', 'services.user')).toBeNull();
  });
});
