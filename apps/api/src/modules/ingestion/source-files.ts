import { readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

export type SupportedLanguage = 'javascript' | 'typescript' | 'python';

export interface SourceFile {
  relativePath: string;
  absolutePath: string;
  language: SupportedLanguage;
  sizeBytes: number;
}

export interface RepositoryScanResult {
  totalFileCount: number;

  sourceFiles: SourceFile[];

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

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, SupportedLanguage>> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',

  '.ts': 'typescript',
  '.tsx': 'typescript',

  '.py': 'python',
  '.pyi': 'python',
};

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/');
}

function detectLanguage(fileName: string): SupportedLanguage | undefined {
  const extension = extname(fileName).toLowerCase();

  return LANGUAGE_BY_EXTENSION[extension];
}

function isGeneratedSourceFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();

  return (
    lowerName.endsWith('.min.js') ||
    lowerName.endsWith('.min.mjs') ||
    lowerName.endsWith('.min.cjs') ||
    lowerName.endsWith('.bundle.js')
  );
}

function ensurePathIsInsideRepository(repositoryRoot: string, candidatePath: string): void {
  const relativePath = relative(repositoryRoot, candidatePath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    resolve(candidatePath) === resolve(repositoryRoot)
  ) {
    throw new AppError('BAD_REQUEST', 400, 'Repository contains an invalid file path.');
  }
}

export async function scanRepositorySourceFiles(
  repositoryRoot: string,
): Promise<RepositoryScanResult> {
  const resolvedRoot = resolve(repositoryRoot);

  const sourceFiles: SourceFile[] = [];

  let totalFileCount = 0;
  let unsupportedCount = 0;
  let oversizedCount = 0;
  let ignoredDirectoryCount = 0;
  let symbolicLinkCount = 0;

  async function walkDirectory(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absolutePath = resolve(currentDirectory, entry.name);

      ensurePathIsInsideRepository(resolvedRoot, absolutePath);

      // Never follow symlinks because they could point
      // outside the temporary repository workspace.
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

      if (totalFileCount > INGESTION_LIMITS.maxFileCount) {
        throw new AppError(
          'PAYLOAD_TOO_LARGE',
          413,
          `Repository contains more than ${INGESTION_LIMITS.maxFileCount.toLocaleString()} files.`,
        );
      }

      const relativePath = normalizeRelativePath(relative(resolvedRoot, absolutePath));

      if (relativePath.length > INGESTION_LIMITS.maxRelativePathLength) {
        throw new AppError(
          'BAD_REQUEST',
          400,
          'Repository contains a file path that is too long.',
          [
            {
              field: 'repository',
              message: 'Repository contains a file path that exceeds the allowed length.',
            },
          ],
        );
      }

      if (isGeneratedSourceFile(entry.name)) {
        unsupportedCount += 1;
        continue;
      }

      const language = detectLanguage(entry.name);

      if (!language) {
        unsupportedCount += 1;
        continue;
      }

      const fileStats = await stat(absolutePath);

      if (fileStats.size > INGESTION_LIMITS.maxAnalyzableFileBytes) {
        oversizedCount += 1;
        continue;
      }

      sourceFiles.push({
        relativePath,
        absolutePath,
        language,
        sizeBytes: fileStats.size,
      });

      if (sourceFiles.length > INGESTION_LIMITS.maxAnalyzableFileCount) {
        throw new AppError(
          'PAYLOAD_TOO_LARGE',
          413,
          `Repository contains more than ${INGESTION_LIMITS.maxAnalyzableFileCount.toLocaleString()} analyzable source files.`,
        );
      }
    }
  }

  await walkDirectory(resolvedRoot);

  sourceFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    totalFileCount,

    sourceFiles,

    skipped: {
      unsupported: unsupportedCount,

      oversized: oversizedCount,

      ignoredDirectory: ignoredDirectoryCount,

      symbolicLink: symbolicLinkCount,
    },
  };
}
