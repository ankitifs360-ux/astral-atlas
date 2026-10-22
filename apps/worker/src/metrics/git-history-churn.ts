import type { FileChurnInput } from './churn-metrics.js';

export interface GitHistoryFileTouch {
  /*
   * Commit that touched the file.
   */
  commitSha: string;

  /*
   * Repository-relative file path reported
   * by Git history.
   */
  filePath: string;
}

function validateCommitSha(commitSha: string): void {
  if (commitSha.trim().length === 0) {
    throw new Error('Git history file touch must contain a commit SHA.');
  }
}

export function createChurnInputsFromGitHistory(
  currentFilePaths: readonly string[],

  historyTouches: readonly GitHistoryFileTouch[],
): FileChurnInput[] {
  /*
   * Churn is only useful for files that are part
   * of the current analyzed repository snapshot.
   *
   * Historical files that were deleted or renamed
   * away should not become phantom metric entries.
   */
  const currentFiles = new Set(currentFilePaths);

  const commitsByFile = new Map<string, Set<string>>();

  for (const filePath of currentFiles) {
    commitsByFile.set(filePath, new Set());
  }

  for (const touch of historyTouches) {
    validateCommitSha(touch.commitSha);

    /*
     * Git history may contain files that no longer
     * exist at the analyzed revision.
     *
     * Ignore them because B8 metrics describe the
     * current repository snapshot.
     */
    if (!currentFiles.has(touch.filePath)) {
      continue;
    }

    commitsByFile.get(touch.filePath)?.add(touch.commitSha);
  }

  return [...commitsByFile.entries()]
    .map(([filePath, commits]): FileChurnInput => ({
      filePath,

      changedCommitCount: commits.size,
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}
