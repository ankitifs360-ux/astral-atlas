import { createFindingId } from './finding-utils.js';

import type { AnalysisFinding } from './types.js';

export type UnresolvedImportReason = 'target-not-found' | 'unsupported-specifier';

export interface UnresolvedImportFindingInput {
  filePath: string;

  specifier: string;

  reason: UnresolvedImportReason;
}

function describeReason(reason: UnresolvedImportReason): string {
  switch (reason) {
    case 'target-not-found':
      return 'the referenced repository target could not be found';

    case 'unsupported-specifier':
      return 'the import specifier format is not currently supported';
  }
}

export function findUnresolvedImports(
  imports: readonly UnresolvedImportFindingInput[],
): AnalysisFinding[] {
  const grouped = new Map<string, UnresolvedImportFindingInput[]>();

  for (const unresolvedImport of imports) {
    const existing = grouped.get(unresolvedImport.filePath);

    if (existing !== undefined) {
      existing.push(unresolvedImport);

      continue;
    }

    grouped.set(unresolvedImport.filePath, [unresolvedImport]);
  }

  const findings: AnalysisFinding[] = [];

  for (const [filePath, fileImports] of grouped) {
    const sortedImports = [...fileImports].sort((left, right) => {
      const specifierOrder = left.specifier.localeCompare(right.specifier);

      if (specifierOrder !== 0) {
        return specifierOrder;
      }

      return left.reason.localeCompare(right.reason);
    });

    const unresolvedCount = sortedImports.length;

    const targetNotFoundCount = sortedImports.filter(
      (unresolvedImport) => unresolvedImport.reason === 'target-not-found',
    ).length;

    const unsupportedSpecifierCount = sortedImports.filter(
      (unresolvedImport) => unresolvedImport.reason === 'unsupported-specifier',
    ).length;

    /*
     * We create one finding per file instead of one
     * finding for every import.
     *
     * That avoids flooding the UI when one file has
     * many unresolved imports.
     */
    findings.push({
      id: createFindingId('unresolved-imports', [filePath]),

      kind: 'unresolved-imports',

      severity: 'low',

      title: `Unresolved imports in ${filePath}`,

      description: `${filePath} contains ${unresolvedCount} import${unresolvedCount === 1 ? '' : 's'} that Astral Atlas could not connect to another repository file. This may happen because ${sortedImports
        .map(
          (unresolvedImport) =>
            `${unresolvedImport.specifier}: ${describeReason(unresolvedImport.reason)}`,
        )
        .join('; ')}.`,

      filePaths: [filePath],

      evidence: [
        {
          metric: 'unresolvedImportCount',

          value: unresolvedCount,
        },

        {
          metric: 'targetNotFoundCount',

          value: targetNotFoundCount,
        },

        {
          metric: 'unsupportedSpecifierCount',

          value: unsupportedSpecifierCount,
        },
      ],
    });
  }

  return findings.sort((left, right) => {
    const leftPath = left.filePaths[0] ?? '';

    const rightPath = right.filePaths[0] ?? '';

    return leftPath.localeCompare(rightPath);
  });
}
