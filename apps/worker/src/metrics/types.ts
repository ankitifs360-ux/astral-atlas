export interface FileDependencyMetrics {
  /*
   * Number of unique files that directly
   * import this file.
   *
   * Example:
   *
   * a.ts ─┐
   *       ├──> utils.ts
   * b.ts ─┘
   *
   * utils.ts fanIn = 2
   */
  fanIn: number;

  /*
   * Number of unique repository files that
   * this file directly imports.
   *
   * Example:
   *
   * app.ts ──> service.ts
   *       └──> logger.ts
   *
   * app.ts fanOut = 2
   */
  fanOut: number;

  /*
   * Number of unique internal files reachable
   * by following dependencies outward.
   *
   * app.ts
   *   ↓
   * service.ts
   *   ↓
   * db.ts
   *
   * app.ts transitiveDependencyCount = 2
   */
  transitiveDependencyCount: number;
}

export interface FileBlastRadiusMetrics {
  /*
   * Number of unique files that could be
   * affected transitively if this file changes.
   *
   * This follows incoming dependency edges.
   */
  affectedFileCount: number;

  /*
   * Furthest dependency distance among affected
   * files.
   *
   * db.ts
   *   ↑ distance 1
   * service.ts
   *   ↑ distance 2
   * app.ts
   *
   * db.ts maxDistance = 2
   */
  maxDistance: number;
}

export interface FileCycleMetrics {
  /*
   * True when this file belongs to a cyclic
   * dependency component.
   */
  inDependencyCycle: boolean;

  /*
   * Number of files inside that cyclic component.
   *
   * Zero means the file is not cyclic.
   *
   * A self-loop therefore has size 1.
   */
  cyclicComponentSize: number;
}

export interface FileStructureMetrics {
  /*
   * Static structural information already
   * available from Tree-sitter parsing.
   */
  importCount: number;

  functionCount: number;

  classCount: number;

  /*
   * Higher numbers mean more independent control
   * flow paths through the file.
   */
  cyclomaticComplexity: number;

  /*
   * Keep syntax health available as a raw signal.
   */
  hasSyntaxErrors: boolean;
}

export interface FileChurnMetrics {
  /*
   * Number of distinct Git commits in the
   * analyzed history window that touched
   * this file.
   */
  changedCommitCount: number;
}

export interface FileMetrics {
  filePath: string;

  dependencies: FileDependencyMetrics;

  blastRadius: FileBlastRadiusMetrics;

  cycles: FileCycleMetrics;

  structure: FileStructureMetrics;

  /*
   * null means Git history was unavailable.
   *
   * This is different from:
   *
   * changedCommitCount = 0
   *
   * which means Git history was available,
   * but this file had no changes in the
   * analyzed history window.
   */
  churn: FileChurnMetrics | null;
}

export interface RepositoryMetricSummary {
  fileCount: number;

  /*
   * Number of internal repository dependency
   * edges.
   */
  internalDependencyCount: number;

  /*
   * Import resolution information.
   */
  externalImportCount: number;

  unresolvedImportCount: number;

  /*
   * Dependency-cycle information.
   */
  cyclicComponentCount: number;

  cyclicFileCount: number;

  /*
   * Repository-wide complexity aggregation.
   */
  totalCyclomaticComplexity: number;

  averageCyclomaticComplexity: number;

  maxCyclomaticComplexity: number;

  /*
   * Whether Git history was available for
   * this analysis.
   *
   * For example:
   *
   * Git repository → usually true
   * ZIP upload      → usually false
   */
  historyAvailable: boolean;

  /*
   * Repository-wide churn aggregation.
   *
   * These values are null when Git history
   * was unavailable.
   */
  totalChangedCommitCount: number | null;

  averageChangedCommitCount: number | null;

  maxChangedCommitCount: number | null;
}

export interface RepositoryMetrics {
  summary: RepositoryMetricSummary;

  /*
   * Deterministically ordered by filePath.
   */
  files: FileMetrics[];
}
