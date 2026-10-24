import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { detectLanguage } from './language.js';

import type { SupportedLanguage } from './types.js';

export const WORKER_REPOSITORY_SCAN_LIMITS = {
  /*
   * These limits intentionally match the API ingestion
   * limits so the worker never accepts more work than
   * the API admission layer allows.
   */
  maxFileCount: 10_000,

  maxAnalyzableFileCount: 5_000,

  maxAnalyzableFileBytes: 2 * 1024 * 1024,

  maxRelativePathLength: 1_024,
} as const;

export interface WorkerRepositorySourceFile {
  relativePath: string;

  absolutePath: string;

  language: SupportedLanguage;

  sizeBytes: number;
}

export type WorkerRepositorySkippedFileReason =
  'unsupported-language' | 'generated-source' | 'too-large';

export interface WorkerRepositorySkippedFile {
  /*
   * Repository-relative path retained so files that
   * cannot be deeply analysed can still appear in the
   * persisted repository map.
   */
  relativePath: string;

  /*
   * null means the language detector does not support
   * this file type.
   *
   * Generated and oversized source files may still have
   * a supported language even though we intentionally
   * do not send them to Tree-sitter.
   */
  language: SupportedLanguage | null;

  sizeBytes: number;

  reason: WorkerRepositorySkippedFileReason;
}

export interface WorkerRepositoryScanResult {
  totalFileCount: number;

  /*
   * Files safe and supported for Tree-sitter parsing.
   */
  sourceFiles: WorkerRepositorySourceFile[];

  /*
   * Regular repository files that were discovered but
   * intentionally excluded from deep parsing.
   *
   * Keeping this metadata means they can still be
   * persisted as unsupported/partial files instead of
   * silently disappearing from the repository map.
   */
  skippedFiles: WorkerRepositorySkippedFile[];

  /*
   * Aggregate counters remain for observability and for
   * compatibility with existing scanner callers/tests.
   */
  skipped: {
    unsupported: number;

    oversized: number;

    ignoredDirectory: number;

    symbolicLink: number;
  };
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.idea',
  '.vscode',

  'node_modules',

  'dist',
  'build',
  'coverage',
  'out',

  '.next',
  '.nuxt',

  '.cache',

  'venv',
  '.venv',
  '__pycache__',

  'vendor',
]);

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/');
}

function isGeneratedSourceFile(fileName: string): boolean {
  const normalized = fileName.toLowerCase();

  return (
    normalized.endsWith('.min.js') ||
    normalized.endsWith('.min.mjs') ||
    normalized.endsWith('.min.cjs') ||
    normalized.endsWith('.bundle.js')
  );
}

function isPathInside(repositoryRoot: string, candidatePath: string): boolean {
  const relativePath = relative(repositoryRoot, candidatePath);

  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function validateRelativePath(relativePath: string): void {
  if (relativePath.length > WORKER_REPOSITORY_SCAN_LIMITS.maxRelativePathLength) {
    throw new Error(
      `Repository file path exceeds ${WORKER_REPOSITORY_SCAN_LIMITS.maxRelativePathLength} characters: ${relativePath}`,
    );
  }
}

export async function scanRepositorySourceFiles(
  repositoryRoot: string,
): Promise<WorkerRepositoryScanResult> {
  const resolvedRoot = resolve(repositoryRoot);

  /*
   * Canonicalize the repository root before walking it.
   *
   * This prevents later containment checks from comparing
   * canonical child paths against a non-canonical root.
   */
  const canonicalRoot = await realpath(resolvedRoot);

  const rootStats = await stat(canonicalRoot);

  if (!rootStats.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${repositoryRoot}`);
  }

  const sourceFiles: WorkerRepositorySourceFile[] = [];

  const skippedFiles: WorkerRepositorySkippedFile[] = [];

  let totalFileCount = 0;

  let unsupportedCount = 0;

  let oversizedCount = 0;

  let ignoredDirectoryCount = 0;

  let symbolicLinkCount = 0;

  async function walkDirectory(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true,
    });

    /*
     * Filesystem iteration order is not guaranteed.
     *
     * Sorting keeps repository scanning deterministic.
     */
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = resolve(currentDirectory, entry.name);

      if (!isPathInside(canonicalRoot, absolutePath)) {
        throw new Error(`Repository entry escapes repository root: ${absolutePath}`);
      }

      /*
       * Never follow repository symlinks.
       *
       * A symlink may point outside the isolated checkout
       * even when its lexical path appears safe.
       *
       * Symlinks are intentionally NOT persisted as normal
       * repository files because reading their target would
       * weaken the repository-containment boundary.
       */
      if (entry.isSymbolicLink()) {
        symbolicLinkCount += 1;

        continue;
      }

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          ignoredDirectoryCount += 1;

          continue;
        }

        await walkDirectory(absolutePath);

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      totalFileCount += 1;

      if (totalFileCount > WORKER_REPOSITORY_SCAN_LIMITS.maxFileCount) {
        throw new Error(
          `Repository contains more than ${WORKER_REPOSITORY_SCAN_LIMITS.maxFileCount.toLocaleString()} files.`,
        );
      }

      const relativePath = normalizeRelativePath(relative(canonicalRoot, absolutePath));

      validateRelativePath(relativePath);

      /*
       * Read basic filesystem metadata before deciding
       * whether the file can be deeply analysed.
       *
       * This allows unsupported/generated/oversized files
       * to retain useful path + size metadata.
       */
      const fileStats = await stat(absolutePath);

      if (!fileStats.isFile()) {
        continue;
      }

      const language = detectLanguage(relativePath);

      /*
       * Generated/minified JavaScript can be extremely
       * expensive and noisy to analyse.
       *
       * Keep it in repository metadata, but do not parse it.
       */
      if (isGeneratedSourceFile(entry.name)) {
        unsupportedCount += 1;

        skippedFiles.push({
          relativePath,

          language,

          sizeBytes: fileStats.size,

          reason: 'generated-source',
        });

        continue;
      }

      /*
       * Unsupported languages/files should not disappear
       * from the final repository representation.
       *
       * Example:
       *
       * README.md
       * styles.css
       * Cargo.toml
       */
      if (language === null) {
        unsupportedCount += 1;

        skippedFiles.push({
          relativePath,

          language: null,

          sizeBytes: fileStats.size,

          reason: 'unsupported-language',
        });

        continue;
      }

      /*
       * A supported source file may still be too large for
       * safe Tree-sitter analysis.
       *
       * Preserve its metadata and mark it partial later
       * rather than silently dropping it.
       */
      if (fileStats.size > WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileBytes) {
        oversizedCount += 1;

        skippedFiles.push({
          relativePath,

          language,

          sizeBytes: fileStats.size,

          reason: 'too-large',
        });

        continue;
      }

      sourceFiles.push({
        relativePath,

        absolutePath,

        language,

        sizeBytes: fileStats.size,
      });

      if (sourceFiles.length > WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileCount) {
        throw new Error(
          `Repository contains more than ${WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileCount.toLocaleString()} analyzable source files.`,
        );
      }
    }
  }

  await walkDirectory(canonicalRoot);

  /*
   * Deterministic ordering matters for:
   *
   * - repeatable analysis output
   * - stable persistence/tests
   * - easier debugging
   */
  sourceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  skippedFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    totalFileCount,

    sourceFiles,

    skippedFiles,

    skipped: {
      unsupported: unsupportedCount,

      oversized: oversizedCount,

      ignoredDirectory: ignoredDirectoryCount,

      symbolicLink: symbolicLinkCount,
    },
  };
}
