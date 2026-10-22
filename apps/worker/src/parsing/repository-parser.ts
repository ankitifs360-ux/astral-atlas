import { readFile, realpath, stat } from 'node:fs/promises';

import { isAbsolute, relative, resolve } from 'node:path';

import { detectLanguage } from './language.js';

import type { ParserThreadPool } from './parser-thread-pool.js';

import type { ParseSourceRequest, ParseSourceResult, SupportedLanguage } from './types.js';

export const DEFAULT_MAX_PARSER_SOURCE_BYTES = 2 * 1024 * 1024;

export interface RepositorySourceFile {
  relativePath: string;
}

export interface RepositoryParseOptions {
  maxSourceBytes?: number;
}

export interface SkippedRepositorySourceFile {
  filePath: string;

  reason: 'unsupported-language' | 'too-large';
}

export interface RepositoryParseResult {
  parsed: ParseSourceResult[];

  skipped: SkippedRepositorySourceFile[];
}

interface PreparedSourceFile {
  request: ParseSourceRequest;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function validateMaxSourceBytes(maxSourceBytes: number): void {
  if (!Number.isInteger(maxSourceBytes) || maxSourceBytes <= 0) {
    throw new Error('Maximum parser source size must be a positive integer.');
  }
}

async function prepareSourceFile(
  repositoryRoot: string,

  file: RepositorySourceFile,

  language: SupportedLanguage,

  maxSourceBytes: number,
): Promise<PreparedSourceFile | SkippedRepositorySourceFile> {
  /*
   * First perform a lexical containment check.
   *
   * This rejects obvious paths such as:
   *
   * ../../outside.ts
   */
  const absolutePath = resolve(repositoryRoot, file.relativePath);

  if (!isPathInside(repositoryRoot, absolutePath)) {
    throw new Error(`Source file escapes repository root: ${file.relativePath}`);
  }

  /*
   * realpath() also resolves symbolic links.
   *
   * This protects against:
   *
   * repo/src/link.ts
   *        ↓ symlink
   * /etc/something
   */
  const realFilePath = await realpath(absolutePath);

  if (!isPathInside(repositoryRoot, realFilePath)) {
    throw new Error(`Source file resolves outside repository root: ${file.relativePath}`);
  }

  const fileStats = await stat(realFilePath);

  if (!fileStats.isFile()) {
    throw new Error(`Source path is not a regular file: ${file.relativePath}`);
  }

  if (fileStats.size > maxSourceBytes) {
    return {
      filePath: file.relativePath,

      reason: 'too-large',
    };
  }

  const source = await readFile(realFilePath, 'utf8');

  return {
    request: {
      filePath: file.relativePath,

      language,

      source,
    },
  };
}

function isPreparedSourceFile(
  value: PreparedSourceFile | SkippedRepositorySourceFile,
): value is PreparedSourceFile {
  return 'request' in value;
}

export async function parseRepositoryFiles(
  pool: ParserThreadPool,

  repositoryRoot: string,

  files: readonly RepositorySourceFile[],

  options: RepositoryParseOptions = {},
): Promise<RepositoryParseResult> {
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_PARSER_SOURCE_BYTES;

  validateMaxSourceBytes(maxSourceBytes);

  /*
   * Resolve the repository itself first.
   *
   * From this point onward, all containment
   * checks use the canonical filesystem path.
   */
  const realRepositoryRoot = await realpath(repositoryRoot);

  const repositoryStats = await stat(realRepositoryRoot);

  if (!repositoryStats.isDirectory()) {
    throw new Error(`Repository root is not a directory: ${repositoryRoot}`);
  }

  /*
   * Deterministic ordering matters later for:
   *
   * - repeatable analysis
   * - stable tests
   * - predictable persistence
   */
  const orderedFiles = [...files].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );

  const parsed: ParseSourceResult[] = [];

  const skipped: SkippedRepositorySourceFile[] = [];

  /*
   * Do not read a huge repository completely
   * into memory before parsing.
   *
   * We process a small bounded batch at a time.
   */
  const batchSize = Math.max(1, pool.size * 2);

  for (let index = 0; index < orderedFiles.length; index += batchSize) {
    const batch = orderedFiles.slice(index, index + batchSize);

    const supportedBatch: {
      file: RepositorySourceFile;

      language: SupportedLanguage;
    }[] = [];

    for (const file of batch) {
      const language = detectLanguage(file.relativePath);

      if (!language) {
        skipped.push({
          filePath: file.relativePath,

          reason: 'unsupported-language',
        });

        continue;
      }

      supportedBatch.push({
        file,
        language,
      });
    }

    const prepared = await Promise.all(
      supportedBatch.map(async (item) =>
        prepareSourceFile(realRepositoryRoot, item.file, item.language, maxSourceBytes),
      ),
    );

    const requests: ParseSourceRequest[] = [];

    for (const item of prepared) {
      if (isPreparedSourceFile(item)) {
        requests.push(item.request);
      } else {
        skipped.push(item);
      }
    }

    if (requests.length === 0) {
      continue;
    }

    const batchResults = await pool.parseMany(requests);

    parsed.push(...batchResults);
  }

  return {
    parsed,
    skipped,
  };
}
