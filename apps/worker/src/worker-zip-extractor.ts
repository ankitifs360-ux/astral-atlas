import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, posix, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import * as yauzl from 'yauzl';

/*
 * Keep these aligned with the repository-ingestion
 * safety limits used by the API.
 *
 * The worker repeats the important limits because
 * queued/staged files must never be trusted blindly.
 */
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;

const MAX_ENTRY_COUNT = 10_000;

const MAX_RELATIVE_PATH_LENGTH = 1024;

/*
 * Unix file type bits stored inside ZIP external attributes.
 */
const UNIX_FILE_TYPE_MASK = 0o170000;

const UNIX_REGULAR_FILE = 0o100000;

const UNIX_DIRECTORY = 0o040000;

const UNIX_SYMBOLIC_LINK = 0o120000;

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

function isEncryptedEntry(generalPurposeBitFlag: number): boolean {
  /*
   * ZIP general-purpose bit 0 means the
   * entry payload is encrypted.
   */
  return (generalPurposeBitFlag & 0x0001) !== 0;
}

function getUnixFileType(versionMadeBy: number, externalFileAttributes: number): number | null {
  /*
   * Upper byte of versionMadeBy identifies
   * the platform that created the ZIP.
   *
   * 3 = Unix.
   */
  const platform = versionMadeBy >>> 8;

  if (platform !== 3) {
    return null;
  }

  const unixMode = (externalFileAttributes >>> 16) & 0xffff;

  return unixMode & UNIX_FILE_TYPE_MASK;
}

function validateUnixEntryType(
  versionMadeBy: number,
  externalFileAttributes: number,
  fileName: string,
): void {
  const fileType = getUnixFileType(versionMadeBy, externalFileAttributes);

  /*
   * Some ZIP creators do not populate Unix
   * file-type bits at all.
   */
  if (fileType === null || fileType === 0) {
    return;
  }

  if (fileType === UNIX_SYMBOLIC_LINK) {
    throw new Error(`ZIP symbolic links are not allowed: "${fileName}"`);
  }

  if (fileType !== UNIX_REGULAR_FILE && fileType !== UNIX_DIRECTORY) {
    /*
     * Reject devices, sockets, FIFOs and other
     * special Unix filesystem objects.
     */
    throw new Error(`ZIP entry uses an unsupported filesystem type: "${fileName}"`);
  }
}

function normalizeEntryPath(fileName: string): {
  relativePath: string;

  identity: string;

  isDirectory: boolean;
} {
  if (fileName.length === 0) {
    throw new Error('ZIP entry path cannot be empty');
  }

  if (fileName.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new Error(`ZIP entry path exceeds ${MAX_RELATIVE_PATH_LENGTH} characters`);
  }

  if (fileName.includes('\0')) {
    throw new Error('ZIP entry path contains a null byte');
  }

  /*
   * strictFileNames=true in yauzl already
   * rejects backslashes.
   *
   * Keep this explicit check as defense in depth.
   */
  if (fileName.includes('\\')) {
    throw new Error(`ZIP entry path contains a backslash: "${fileName}"`);
  }

  /*
   * Reject Unix absolute paths.
   */
  if (fileName.startsWith('/')) {
    throw new Error(`ZIP entry uses an absolute path: "${fileName}"`);
  }

  /*
   * Reject Windows drive-letter paths such as:
   *
   * C:/Windows/file.txt
   */
  if (/^[A-Za-z]:\//.test(fileName)) {
    throw new Error(`ZIP entry uses an absolute Windows path: "${fileName}"`);
  }

  const isDirectory = fileName.endsWith('/');

  /*
   * Do not allow "." or ".." path components,
   * even if path normalization could technically
   * turn them into something inside the root.
   */
  const rawSegments = fileName.split('/');

  if (rawSegments.some((segment) => segment === '..' || segment === '.')) {
    throw new Error(`ZIP entry contains an unsafe path component: "${fileName}"`);
  }

  const normalized = posix.normalize(fileName);

  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`ZIP entry escapes the extraction directory: "${fileName}"`);
  }

  /*
   * Remove the trailing slash only for identity
   * comparison.
   *
   * This makes:
   *
   * folder
   * folder/
   *
   * collide instead of being treated as two
   * unrelated filesystem objects.
   */
  const identity = normalized.replace(/\/+$/, '');

  if (identity.length === 0) {
    throw new Error(`ZIP entry path is invalid: "${fileName}"`);
  }

  return {
    relativePath: normalized,

    identity,

    isDirectory,
  };
}

function resolveExtractionPath(destinationRoot: string, relativePath: string): string {
  const outputPath = resolve(destinationRoot, relativePath);

  const rootPrefix = destinationRoot.endsWith(sep) ? destinationRoot : `${destinationRoot}${sep}`;

  /*
   * Final ZIP-slip defense.
   *
   * Even after validating the textual path,
   * the resolved filesystem path must remain
   * underneath destinationRoot.
   */
  if (outputPath !== destinationRoot && !outputPath.startsWith(rootPrefix)) {
    throw new Error(`ZIP entry escapes the extraction directory: "${relativePath}"`);
  }

  return outputPath;
}

async function validateArchiveFile(archivePath: string): Promise<void> {
  let archiveStats;

  try {
    archiveStats = await stat(archivePath);
  } catch (error: unknown) {
    throw new Error(`ZIP archive "${archivePath}" cannot be read`, {
      cause: error,
    });
  }

  if (!archiveStats.isFile()) {
    throw new Error(`ZIP archive "${archivePath}" is not a regular file`);
  }

  if (archiveStats.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`ZIP archive exceeds the ${MAX_ARCHIVE_BYTES} byte archive limit`);
  }
}

/**
 * Safely extracts a staged repository ZIP.
 *
 * Security properties:
 *
 * - no absolute paths
 * - no ../ path traversal
 * - no symlinks
 * - no Unix special files
 * - no encrypted entries
 * - no duplicate paths
 * - bounded archive size
 * - bounded entry count
 * - bounded total extracted size
 * - yauzl validates actual entry sizes
 * - files are never overwritten
 */
export async function extractZipArchive(
  archivePath: string,
  destinationDirectory: string,
): Promise<void> {
  const normalizedArchivePath = requireNonEmpty(archivePath, 'ZIP archive path');

  const normalizedDestinationDirectory = requireNonEmpty(
    destinationDirectory,
    'ZIP extraction destination directory',
  );

  await validateArchiveFile(normalizedArchivePath);

  const destinationRoot = resolve(normalizedDestinationDirectory);

  await mkdir(destinationRoot, {
    recursive: true,

    mode: 0o700,
  });

  /*
   * openPromise() forces lazyEntries=true.
   *
   * That is exactly what we want:
   * process one ZIP entry at a time instead of
   * opening thousands of streams concurrently.
   *
   * strictFileNames:
   * reject non-spec backslash paths.
   *
   * validateEntrySizes:
   * detect malformed entries whose actual
   * uncompressed bytes do not match metadata.
   */
  const zipFile = await yauzl.openPromise(normalizedArchivePath, {
    autoClose: false,

    decodeStrings: true,

    strictFileNames: true,

    validateEntrySizes: true,
  });

  const extractedPaths = new Set<string>();

  let entryCount = 0;

  let totalExtractedBytes = 0;

  try {
    for await (const entry of zipFile.eachEntry()) {
      entryCount += 1;

      if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error(`ZIP archive exceeds the ${MAX_ENTRY_COUNT} entry limit`);
      }

      if (isEncryptedEntry(entry.generalPurposeBitFlag)) {
        throw new Error(`Encrypted ZIP entries are not supported: "${entry.fileName}"`);
      }

      validateUnixEntryType(entry.versionMadeBy, entry.externalFileAttributes, entry.fileName);

      const { relativePath, identity, isDirectory } = normalizeEntryPath(entry.fileName);

      if (extractedPaths.has(identity)) {
        throw new Error(`ZIP archive contains a duplicate path: "${entry.fileName}"`);
      }

      extractedPaths.add(identity);

      const outputPath = resolveExtractionPath(destinationRoot, relativePath);

      if (isDirectory) {
        await mkdir(outputPath, {
          recursive: true,

          mode: 0o700,
        });

        continue;
      }

      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
        throw new Error(`ZIP entry has an invalid uncompressed size: "${entry.fileName}"`);
      }

      if (entry.uncompressedSize > MAX_EXTRACTED_BYTES) {
        throw new Error(`ZIP entry exceeds the extracted-size limit: "${entry.fileName}"`);
      }

      totalExtractedBytes += entry.uncompressedSize;

      if (totalExtractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error(`ZIP archive exceeds the ${MAX_EXTRACTED_BYTES} byte extracted-size limit`);
      }

      /*
       * ZIP archives do not need explicit entries
       * for parent directories.
       */
      await mkdir(dirname(outputPath), {
        recursive: true,

        mode: 0o700,
      });

      const readStream = await zipFile.openReadStreamPromise(entry);

      /*
       * flags: 'wx'
       *
       * Never overwrite an existing path.
       *
       * This is another defense against duplicate
       * or conflicting ZIP entries.
       */
      await pipeline(
        readStream,

        createWriteStream(outputPath, {
          flags: 'wx',

          mode: 0o600,
        }),
      );
    }
  } catch (error: unknown) {
    throw new Error('ZIP repository extraction failed', {
      cause: error,
    });
  } finally {
    /*
     * autoClose=false above so ownership is explicit.
     */
    zipFile.close();
  }
}
