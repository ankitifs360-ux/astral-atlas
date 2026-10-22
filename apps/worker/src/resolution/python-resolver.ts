import { posix } from 'node:path';

import { normalizeRepositoryPath } from './file-index.js';

import type { RepositoryFileIndex } from './file-index.js';

function createPythonCandidates(modulePath: string): string[] {
  /*
   * services.user
   *
   * can represent:
   *
   * services/user.py
   *
   * or a package:
   *
   * services/user/__init__.py
   */
  return [`${modulePath}.py`, posix.join(modulePath, '__init__.py')];
}

function isValidPythonSpecifier(specifier: string): boolean {
  if (
    specifier.length === 0 ||
    specifier.includes('\0') ||
    specifier.includes('/') ||
    specifier.includes('\\')
  ) {
    return false;
  }

  return true;
}

function resolveAbsoluteModulePath(specifier: string): string | null {
  const segments = specifier.split('.');

  /*
   * Reject malformed values such as:
   *
   * services..user
   */
  if (segments.some((segment) => segment.length === 0)) {
    return null;
  }

  return segments.join('/');
}

function resolveRelativeModulePath(sourceFilePath: string, specifier: string): string | null {
  let leadingDots = 0;

  while (specifier[leadingDots] === '.') {
    leadingDots += 1;
  }

  if (leadingDots === 0) {
    return null;
  }

  const modulePart = specifier.slice(leadingDots);

  /*
   * Example:
   *
   * .user
   * ..shared
   *
   * but not:
   *
   * .services..user
   */
  if (modulePart.includes('..')) {
    return null;
  }

  const normalizedSource = normalizeRepositoryPath(sourceFilePath);

  let baseDirectory = posix.dirname(normalizedSource);

  /*
   * Python meaning:
   *
   * .user
   *   → current package
   *
   * ..user
   *   → parent package
   *
   * ...user
   *   → grandparent package
   *
   * Therefore we move upward:
   *
   * leadingDots - 1
   */
  const levelsUp = leadingDots - 1;

  for (let level = 0; level < levelsUp; level += 1) {
    /*
     * "." represents our repository root.
     *
     * Moving above it would escape the
     * repository analysis boundary.
     */
    if (baseDirectory === '.') {
      return null;
    }

    baseDirectory = posix.dirname(baseDirectory);
  }

  /*
   * A bare relative package reference:
   *
   * from . import something
   *
   * can at least identify the current package.
   *
   * Later symbol-level analysis may determine
   * exactly what "something" refers to.
   */
  if (modulePart.length === 0) {
    return posix.join(baseDirectory);
  }

  const moduleSegments = modulePart.split('.');

  if (moduleSegments.some((segment) => segment.length === 0)) {
    return null;
  }

  return posix.join(baseDirectory, ...moduleSegments);
}

export function resolvePythonImport(
  fileIndex: RepositoryFileIndex,

  sourceFilePath: string,

  specifier: string,
): string | null {
  if (!isValidPythonSpecifier(specifier)) {
    return null;
  }

  const isRelative = specifier.startsWith('.');

  const modulePath = isRelative
    ? resolveRelativeModulePath(sourceFilePath, specifier)
    : resolveAbsoluteModulePath(specifier);

  if (modulePath === null) {
    return null;
  }

  /*
   * Special case for:
   *
   * from . import ...
   *
   * modulePath refers directly to the package
   * directory, so only __init__.py makes sense
   * at this level.
   */
  if (isRelative && /^\.+$/.test(specifier)) {
    const packageInit = posix.join(modulePath, '__init__.py');

    return fileIndex.has(packageInit) ? normalizeRepositoryPath(packageInit) : null;
  }

  const candidates = createPythonCandidates(modulePath);

  return fileIndex.findFirst(candidates);
}
