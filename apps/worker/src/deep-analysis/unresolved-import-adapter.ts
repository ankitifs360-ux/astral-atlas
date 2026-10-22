import type { RepositoryImportResolution } from '../resolution/repository-import-resolver.js';

import type { ImportResolutionReason } from '../resolution/types.js';

import type {
  UnresolvedImportFindingInput,
  UnresolvedImportReason,
} from './unresolved-import-rule.js';

function isUnresolvedImportReason(
  reason: ImportResolutionReason | null,
): reason is UnresolvedImportReason {
  return reason === 'target-not-found' || reason === 'unsupported-specifier';
}

/*
 * B9 only needs the resolved import array.
 *
 * Using Pick here means callers may provide:
 *
 * 1. the complete RepositoryImportResolution
 *
 * or
 *
 * 2. simply an object containing:
 *
 *    {
 *      imports: ResolvedImport[]
 *    }
 *
 * This avoids unnecessarily coupling B9 to the
 * B6 RepositoryFileIndex.
 */
export function createUnresolvedImportFindingInputs(
  resolution: Pick<RepositoryImportResolution, 'imports'>,
): UnresolvedImportFindingInput[] {
  const inputs: UnresolvedImportFindingInput[] = [];

  for (const resolvedImport of resolution.imports) {
    /*
     * Internal imports already became graph edges.
     *
     * External packages are valid dependencies.
     *
     * Only unresolved imports become B9 findings.
     */
    if (resolvedImport.kind !== 'unresolved') {
      continue;
    }

    if (!isUnresolvedImportReason(resolvedImport.reason)) {
      throw new Error(
        `Unresolved import "${resolvedImport.specifier}" in "${resolvedImport.sourceFilePath}" has invalid reason "${String(resolvedImport.reason)}"`,
      );
    }

    inputs.push({
      filePath: resolvedImport.sourceFilePath,

      specifier: resolvedImport.specifier,

      reason: resolvedImport.reason,
    });
  }

  return inputs.sort((left, right) => {
    const fileOrder = left.filePath.localeCompare(right.filePath);

    if (fileOrder !== 0) {
      return fileOrder;
    }

    const specifierOrder = left.specifier.localeCompare(right.specifier);

    if (specifierOrder !== 0) {
      return specifierOrder;
    }

    return left.reason.localeCompare(right.reason);
  });
}
