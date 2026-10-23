import type { AnalysisSource, GitHubAnalysisSource, ZipAnalysisSource } from '@astral-atlas/shared';

/*
 * A repository after the worker has downloaded/extracted it.
 *
 * The API never creates this object.
 * Only the worker does the expensive preparation work.
 */
export interface PreparedAnalysisRepository {
  sourceType: 'github' | 'zip';

  /*
   * Stable repository identity:
   *
   * GitHub:
   *   github:owner/repo
   *
   * ZIP:
   *   zip:<sha256>
   */
  sourceKey: string;

  /*
   * Exact immutable revision being analysed.
   *
   * GitHub -> commit SHA
   * ZIP    -> archive SHA-256
   */
  revision: string;

  /*
   * Temporary directory containing the actual
   * repository files that Tree-sitter will analyse.
   */
  repositoryDirectory: string;

  /*
   * Removes only temporary worker files.
   *
   * The staged ZIP itself is NOT deleted here because
   * BullMQ may still retry the job after a failure.
   */
  cleanup: () => Promise<void>;
}

export interface AnalysisSourcePreparer {
  prepare(source: AnalysisSource): Promise<PreparedAnalysisRepository>;
}

/*
 * Keep the revision rule in one place.
 *
 * PostgreSQL submission identity and worker analysis
 * must agree on exactly the same revision value.
 */
export function getAnalysisSourceRevision(source: AnalysisSource): string {
  if (source.sourceType === 'github') {
    return source.commitSha.toLowerCase();
  }

  return source.contentSha256.toLowerCase();
}

export function createPreparedGitHubRepository(
  source: GitHubAnalysisSource,
  repositoryDirectory: string,
  cleanup: () => Promise<void>,
): PreparedAnalysisRepository {
  return {
    sourceType: 'github',

    sourceKey: source.sourceKey,

    revision: source.commitSha.toLowerCase(),

    repositoryDirectory,

    cleanup,
  };
}

export function createPreparedZipRepository(
  source: ZipAnalysisSource,
  repositoryDirectory: string,
  cleanup: () => Promise<void>,
): PreparedAnalysisRepository {
  return {
    sourceType: 'zip',

    sourceKey: source.sourceKey,

    revision: source.contentSha256.toLowerCase(),

    repositoryDirectory,

    cleanup,
  };
}
