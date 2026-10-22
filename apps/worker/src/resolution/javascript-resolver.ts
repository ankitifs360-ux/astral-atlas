import { posix } from 'node:path';

import { normalizeRepositoryPath } from './file-index.js';

import type { RepositoryFileIndex } from './file-index.js';

const EXTENSIONLESS_CANDIDATES = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
] as const;

function replaceExtension(filePath: string, extension: string): string {
  const currentExtension = posix.extname(filePath);

  if (!currentExtension) {
    return filePath + extension;
  }

  return filePath.slice(0, -currentExtension.length) + extension;
}

function createExplicitExtensionCandidates(targetPath: string): string[] {
  const extension = posix.extname(targetPath).toLowerCase();

  /*
   * Keep the literal target first.
   *
   * If the repository really contains:
   *
   * ./user.js
   *
   * that exact file should win.
   *
   * If it does not exist, TypeScript-oriented
   * substitutions are attempted next.
   */
  switch (extension) {
    case '.js':
      return [
        targetPath,

        replaceExtension(targetPath, '.ts'),

        replaceExtension(targetPath, '.tsx'),
      ];

    case '.jsx':
      return [targetPath, replaceExtension(targetPath, '.tsx')];

    case '.mjs':
      return [targetPath, replaceExtension(targetPath, '.mts')];

    case '.cjs':
      return [targetPath, replaceExtension(targetPath, '.cts')];

    default:
      return [targetPath];
  }
}

function createExtensionlessCandidates(targetPath: string): string[] {
  return [
    /*
     * A repository can technically contain
     * extensionless source files, so exact match
     * remains the first candidate.
     */
    targetPath,

    ...EXTENSIONLESS_CANDIDATES.map((extension) => targetPath + extension),

    /*
     * Directory import:
     *
     * import './utils'
     *
     * can resolve to:
     *
     * ./utils/index.ts
     */
    ...EXTENSIONLESS_CANDIDATES.map((extension) => posix.join(targetPath, `index${extension}`)),
  ];
}

function createCandidates(targetPath: string): string[] {
  const extension = posix.extname(targetPath);

  if (!extension) {
    return createExtensionlessCandidates(targetPath);
  }

  return createExplicitExtensionCandidates(targetPath);
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

export function resolveJavaScriptRelativeImport(
  fileIndex: RepositoryFileIndex,

  sourceFilePath: string,

  specifier: string,
): string | null {
  /*
   * This resolver only handles repository-
   * relative JavaScript/TypeScript imports.
   *
   * react
   * express
   * node:fs
   * @company/package
   *
   * are handled by higher-level B6 logic.
   */
  if (!isRelativeSpecifier(specifier)) {
    return null;
  }

  const normalizedSource = normalizeRepositoryPath(sourceFilePath);

  const sourceDirectory = posix.dirname(normalizedSource);

  const targetPath = posix.normalize(posix.join(sourceDirectory, specifier));

  /*
   * An import is allowed to point outside the
   * analysis root syntactically, but it cannot
   * become an internal repository edge.
   *
   * Example:
   *
   * src/app.ts
   * import '../../../shared.js'
   */
  if (targetPath === '..' || targetPath.startsWith('../') || posix.isAbsolute(targetPath)) {
    return null;
  }

  const candidates = createCandidates(targetPath);

  return fileIndex.findFirst(candidates);
}
