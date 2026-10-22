import { files, metrics } from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import type { FileMetrics } from '../metrics/types.js';

import type { PersistCompletedAnalysisInput } from './types.js';

/*
 * Extract the transaction type directly from the
 * Database API.
 *
 * This means persistence helpers can accept the
 * same transaction object created by:
 *
 * db.transaction(async (tx) => {
 *   ...
 * })
 *
 * without creating another database connection.
 */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type FileIdByPath = ReadonlyMap<string, string>;

function validateFilePath(filePath: string): void {
  if (filePath.trim().length === 0) {
    throw new Error('Persisted file path cannot be empty');
  }
}

function createInputFileIndex(
  input: PersistCompletedAnalysisInput,
): Map<string, PersistCompletedAnalysisInput['files'][number]> {
  const fileIndex = new Map<string, PersistCompletedAnalysisInput['files'][number]>();

  for (const file of input.files) {
    validateFilePath(file.filePath);

    if (fileIndex.has(file.filePath)) {
      throw new Error(`Duplicate persistence file path "${file.filePath}"`);
    }

    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 0) {
      throw new Error(`sizeBytes for "${file.filePath}" must be a non-negative integer`);
    }

    fileIndex.set(file.filePath, file);
  }

  return fileIndex;
}

function createMetricIndex(metricFiles: readonly FileMetrics[]): Map<string, FileMetrics> {
  const metricIndex = new Map<string, FileMetrics>();

  for (const metric of metricFiles) {
    if (metricIndex.has(metric.filePath)) {
      throw new Error(`Duplicate file metrics for "${metric.filePath}"`);
    }

    metricIndex.set(metric.filePath, metric);
  }

  return metricIndex;
}

function validateMetricFilesExist(
  metricIndex: ReadonlyMap<string, FileMetrics>,

  fileIndex: ReadonlyMap<string, PersistCompletedAnalysisInput['files'][number]>,
): void {
  for (const filePath of metricIndex.keys()) {
    if (!fileIndex.has(filePath)) {
      throw new Error(`Metrics reference unknown persisted file "${filePath}"`);
    }
  }
}

function validateMetricSummary(input: PersistCompletedAnalysisInput): void {
  if (input.metrics.summary.fileCount !== input.metrics.files.length) {
    throw new Error(
      'Repository metric summary fileCount does not match the number of per-file metrics',
    );
  }
}

function requirePersistedFileId(
  fileIdByPath: ReadonlyMap<string, string>,

  filePath: string,
): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Missing persisted file ID for "${filePath}"`);
  }

  return fileId;
}

export async function persistFilesAndMetrics(
  transaction: DatabaseTransaction,

  input: PersistCompletedAnalysisInput,
): Promise<FileIdByPath> {
  /*
   * Validate everything that we can before
   * writing rows.
   */
  const inputFileIndex = createInputFileIndex(input);

  const metricIndex = createMetricIndex(input.metrics.files);

  validateMetricFilesExist(metricIndex, inputFileIndex);

  validateMetricSummary(input);

  /*
   * Empty repositories are valid.
   *
   * Avoid calling INSERT ... VALUES [] because
   * Drizzle expects at least one values object.
   */
  if (input.files.length === 0) {
    return new Map<string, string>();
  }

  /*
   * -----------------------------------------------------------------------
   * Files
   * -----------------------------------------------------------------------
   *
   * Insert all file records first because every
   * later persistence stage uses files.id as its
   * foreign-key identity.
   */
  const insertedFiles = await transaction
    .insert(files)
    .values(
      input.files.map((file) => ({
        analysisId: input.analysisId,

        path: file.filePath,

        language: file.language,

        sizeBytes: file.sizeBytes,

        contentHash: file.contentHash ?? null,

        isSupported: file.isSupported ?? true,

        parseStatus: file.parseStatus ?? 'analyzed',
      })),
    )
    .returning({
      id: files.id,

      path: files.path,
    });

  if (insertedFiles.length !== input.files.length) {
    throw new Error(
      `Expected to persist ${input.files.length} files but PostgreSQL returned ${insertedFiles.length}`,
    );
  }

  const fileIdByPath = new Map<string, string>();

  for (const insertedFile of insertedFiles) {
    if (fileIdByPath.has(insertedFile.path)) {
      throw new Error(`PostgreSQL returned duplicate persisted file path "${insertedFile.path}"`);
    }

    fileIdByPath.set(insertedFile.path, insertedFile.id);
  }

  /*
   * -----------------------------------------------------------------------
   * B8 per-file metrics
   * -----------------------------------------------------------------------
   *
   * input.files may eventually contain skipped or
   * unsupported files.
   *
   * Therefore we only create metric rows for
   * files that actually exist in B8 metrics.files.
   */
  if (metricIndex.size > 0) {
    await transaction.insert(metrics).values(
      [...metricIndex.values()]
        .sort((left, right) => left.filePath.localeCompare(right.filePath))
        .map((metric) => ({
          fileId: requirePersistedFileId(fileIdByPath, metric.filePath),

          cyclomaticComplexity: metric.structure.cyclomaticComplexity,

          importCount: metric.structure.importCount,

          functionCount: metric.structure.functionCount,

          classCount: metric.structure.classCount,

          hasSyntaxErrors: metric.structure.hasSyntaxErrors,

          churnCommits: metric.churn?.changedCommitCount ?? null,

          fanIn: metric.dependencies.fanIn,

          fanOut: metric.dependencies.fanOut,

          transitiveDependencyCount: metric.dependencies.transitiveDependencyCount,

          blastRadius: metric.blastRadius.affectedFileCount,

          blastMaxDistance: metric.blastRadius.maxDistance,

          inDependencyCycle: metric.cycles.inDependencyCycle,

          cyclicComponentSize: metric.cycles.cyclicComponentSize,
        })),
    );
  }

  return fileIdByPath;
}
