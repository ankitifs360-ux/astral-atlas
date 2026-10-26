import { assignCallOwners } from '../parsing/call-owner-resolver.js';

import type { ParseSourceResult } from '../parsing/types.js';

import { resolveSameFileFunctionCall } from './function-call-resolver.js';

import { resolveNamedImportedFunctionCall } from './imported-function-call-resolver.js';

import { resolveRepositoryImports } from './repository-import-resolver.js';

import type { CallResolutionRequest, ResolvedCall } from './types.js';

export interface RepositoryFunctionCallResolution {
  calls: ResolvedCall[];
}

function createResolutionRequests(
  parsedFiles: readonly ParseSourceResult[],
): CallResolutionRequest[] {
  const requests: CallResolutionRequest[] = [];

  for (const parsedFile of parsedFiles) {
    const ownedCalls = assignCallOwners(parsedFile.calls, parsedFile.functions);

    for (const ownedCall of ownedCalls) {
      /*
       * Module-level calls do not have a source function,
       * so they cannot form a function-to-function edge.
       */
      if (ownedCall.owner === null) {
        continue;
      }

      requests.push({
        sourceFilePath: parsedFile.filePath,

        sourceLanguage: parsedFile.language,

        sourceFunction: ownedCall.owner,

        callee: ownedCall.call.callee,

        range: ownedCall.call.range,
      });
    }
  }

  return requests;
}

function requireParsedFile(
  parsedFileByPath: ReadonlyMap<string, ParseSourceResult>,
  filePath: string,
): ParseSourceResult {
  const parsedFile = parsedFileByPath.get(filePath);

  if (parsedFile === undefined) {
    throw new Error(`Function call resolution references unknown parsed file "${filePath}"`);
  }

  return parsedFile;
}

export function resolveRepositoryFunctionCalls(
  parsedFiles: readonly ParseSourceResult[],
): RepositoryFunctionCallResolution {
  const parsedFileByPath = new Map(
    parsedFiles.map((parsedFile) => [parsedFile.filePath, parsedFile] as const),
  );

  const importResolution = resolveRepositoryImports(parsedFiles);

  const requests = createResolutionRequests(parsedFiles);

  const calls = requests.map((request) => {
    const sourceFile = requireParsedFile(parsedFileByPath, request.sourceFilePath);

    /*
     * Prefer a function declared in the same file.
     *
     * Example:
     *
     * function saveUser() {}
     *
     * function createUser() {
     *   saveUser();
     * }
     */
    const sameFileResult = resolveSameFileFunctionCall(request, sourceFile.functions);

    if (sameFileResult.kind === 'internal') {
      return sameFileResult;
    }

    /*
     * An ambiguous same-file match should remain
     * ambiguous rather than falling through and
     * accidentally resolving to an imported symbol.
     */
    if (sameFileResult.reason === 'ambiguous-target') {
      return sameFileResult;
    }

    /*
     * If no same-file function matched, try a
     * statically known named import.
     *
     * Example:
     *
     * import {
     *   saveUser as persistUser,
     * } from './users.js';
     *
     * persistUser();
     */
    return resolveNamedImportedFunctionCall(
      request,
      sourceFile,
      importResolution.imports,
      parsedFileByPath,
    );
  });

  return {
    calls,
  };
}
