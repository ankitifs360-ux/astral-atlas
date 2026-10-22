export interface FileChurnInput {
  filePath: string;

  /*
   * Number of distinct Git commits in the
   * analyzed history window that touched this
   * file.
   *
   * Example:
   *
   * service.ts changed in 14 commits
   *
   * changedCommitCount = 14
   */
  changedCommitCount: number;
}

export interface FileChurnMetrics {
  filePath: string;

  changedCommitCount: number;
}

function validateChangedCommitCount(filePath: string, changedCommitCount: number): void {
  if (!Number.isInteger(changedCommitCount) || changedCommitCount < 0) {
    throw new Error(`Git churn count must be a non-negative integer for file: ${filePath}`);
  }
}

export function calculateFileChurnMetrics(inputs: readonly FileChurnInput[]): FileChurnMetrics[] {
  const seenFilePaths = new Set<string>();

  const results: FileChurnMetrics[] = [];

  for (const input of inputs) {
    if (seenFilePaths.has(input.filePath)) {
      throw new Error(`Duplicate Git churn input for file: ${input.filePath}`);
    }

    seenFilePaths.add(input.filePath);

    validateChangedCommitCount(input.filePath, input.changedCommitCount);

    results.push({
      filePath: input.filePath,

      changedCommitCount: input.changedCommitCount,
    });
  }

  return results.sort((left, right) => left.filePath.localeCompare(right.filePath));
}
