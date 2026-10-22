import { RepositoryFileIndex } from './file-index.js';

import { resolveImports } from './import-resolver.js';

import type { ParseSourceResult } from '../parsing/types.js';

import type { ImportResolutionRequest, ResolvedImport } from './types.js';

export interface RepositoryImportResolution {
  fileIndex: RepositoryFileIndex;

  imports: ResolvedImport[];
}

function createResolutionRequests(
  parsedFiles: readonly ParseSourceResult[],
): ImportResolutionRequest[] {
  const requests: ImportResolutionRequest[] = [];

  for (const file of parsedFiles) {
    for (const parsedImport of file.imports) {
      requests.push({
        sourceFilePath: file.filePath,

        sourceLanguage: file.language,

        specifier: parsedImport.source,

        range: parsedImport.range,
      });
    }
  }

  return requests;
}

export function resolveRepositoryImports(
  parsedFiles: readonly ParseSourceResult[],
): RepositoryImportResolution {
  /*
   * Every parsed source file becomes a possible
   * internal import target.
   *
   * Example:
   *
   * src/app.ts
   * src/service.ts
   * src/utils/index.ts
   */
  const fileIndex = new RepositoryFileIndex(parsedFiles.map((file) => file.filePath));

  const requests = createResolutionRequests(parsedFiles);

  const imports = resolveImports(fileIndex, requests);

  return {
    fileIndex,
    imports,
  };
}
