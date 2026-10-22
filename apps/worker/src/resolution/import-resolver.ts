import { resolveJavaScriptRelativeImport } from './javascript-resolver.js';

import { resolvePythonImport } from './python-resolver.js';

import type { RepositoryFileIndex } from './file-index.js';

import type { ImportResolutionRequest, ResolvedImport } from './types.js';

function isJavaScriptLikeLanguage(language: ImportResolutionRequest['sourceLanguage']): boolean {
  return language === 'javascript' || language === 'typescript' || language === 'tsx';
}

function isRelativeJavaScriptSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isUnsupportedSpecifier(specifier: string): boolean {
  if (specifier.length === 0 || specifier.includes('\0')) {
    return true;
  }

  /*
   * Absolute filesystem-style imports are not
   * resolved yet because their meaning depends
   * on project-specific configuration.
   *
   * Example:
   *
   * /src/user
   */
  if (specifier.startsWith('/')) {
    return true;
  }

  return false;
}

function createResult(
  request: ImportResolutionRequest,

  values: Pick<ResolvedImport, 'kind' | 'targetFilePath' | 'reason'>,
): ResolvedImport {
  return {
    sourceFilePath: request.sourceFilePath,

    sourceLanguage: request.sourceLanguage,

    specifier: request.specifier,

    range: request.range,

    ...values,
  };
}

function resolveJavaScriptImport(
  fileIndex: RepositoryFileIndex,

  request: ImportResolutionRequest,
): ResolvedImport {
  /*
   * Non-relative JS/TS imports are treated as
   * external dependencies at this stage.
   *
   * Examples:
   *
   * react
   * express
   * node:fs
   * @scope/package
   *
   * Project aliases such as "@/user" will get
   * dedicated configuration-aware support later.
   */
  if (!isRelativeJavaScriptSpecifier(request.specifier)) {
    return createResult(request, {
      kind: 'external',

      targetFilePath: null,

      reason: 'external-package',
    });
  }

  const targetFilePath = resolveJavaScriptRelativeImport(
    fileIndex,
    request.sourceFilePath,
    request.specifier,
  );

  if (targetFilePath) {
    return createResult(request, {
      kind: 'internal',

      targetFilePath,

      reason: null,
    });
  }

  return createResult(request, {
    kind: 'unresolved',

    targetFilePath: null,

    reason: 'target-not-found',
  });
}

function resolvePythonDependency(
  fileIndex: RepositoryFileIndex,

  request: ImportResolutionRequest,
): ResolvedImport {
  const targetFilePath = resolvePythonImport(fileIndex, request.sourceFilePath, request.specifier);

  if (targetFilePath) {
    return createResult(request, {
      kind: 'internal',

      targetFilePath,

      reason: null,
    });
  }

  /*
   * Relative Python imports clearly refer to
   * the current repository/package structure.
   *
   * If they do not resolve, mark them as
   * unresolved rather than external.
   */
  if (request.specifier.startsWith('.')) {
    return createResult(request, {
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'target-not-found',
    });
  }

  /*
   * Absolute Python imports may legitimately
   * refer to:
   *
   * os
   * pathlib
   * fastapi
   * numpy
   *
   * If there is no matching repository module,
   * classify them as external.
   */
  return createResult(request, {
    kind: 'external',

    targetFilePath: null,

    reason: 'external-package',
  });
}

export function resolveImport(
  fileIndex: RepositoryFileIndex,

  request: ImportResolutionRequest,
): ResolvedImport {
  if (isUnsupportedSpecifier(request.specifier)) {
    return createResult(request, {
      kind: 'unresolved',

      targetFilePath: null,

      reason: 'unsupported-specifier',
    });
  }

  if (isJavaScriptLikeLanguage(request.sourceLanguage)) {
    return resolveJavaScriptImport(fileIndex, request);
  }

  return resolvePythonDependency(fileIndex, request);
}

export function resolveImports(
  fileIndex: RepositoryFileIndex,

  requests: readonly ImportResolutionRequest[],
): ResolvedImport[] {
  return requests.map((request) => resolveImport(fileIndex, request));
}
