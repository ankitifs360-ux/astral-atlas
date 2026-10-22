import { calculateCyclomaticComplexity } from './cyclomatic-complexity.js';

import type { ParseSourceResult } from '../parsing/types.js';

import type { FileStructureMetrics } from './types.js';

export interface FileStructureMetricInput {
  parsedFile: ParseSourceResult;

  /*
   * Original source text for the file.
   *
   * ParseSourceResult intentionally contains
   * normalized analysis results rather than
   * retaining the full source code.
   */
  source: string;
}

export interface CalculatedFileStructureMetrics {
  filePath: string;

  structure: FileStructureMetrics;
}

export function calculateFileStructureMetrics(
  inputs: readonly FileStructureMetricInput[],
): CalculatedFileStructureMetrics[] {
  const filePaths = new Set<string>();

  const results: CalculatedFileStructureMetrics[] = [];

  for (const input of inputs) {
    const { parsedFile, source } = input;

    if (filePaths.has(parsedFile.filePath)) {
      throw new Error(`Duplicate structure metrics input for file: ${parsedFile.filePath}`);
    }

    filePaths.add(parsedFile.filePath);

    const cyclomaticComplexity = calculateCyclomaticComplexity({
      language: parsedFile.language,

      source,
    });

    results.push({
      filePath: parsedFile.filePath,

      structure: {
        importCount: parsedFile.imports.length,

        functionCount: parsedFile.functions.length,

        classCount: parsedFile.classes.length,

        cyclomaticComplexity,

        hasSyntaxErrors: parsedFile.hasSyntaxErrors,
      },
    });
  }

  /*
   * Repository output should not depend on the
   * order files happened to be read or parsed.
   */
  return results.sort((left, right) => left.filePath.localeCompare(right.filePath));
}
