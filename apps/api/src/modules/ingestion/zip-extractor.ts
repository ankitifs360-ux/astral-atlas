import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

import * as yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

export interface ZipExtractionResult {
  totalEntries: number;
  extractedFileCount: number;
  extractedBytes: number;
}

function invalidZip(message: string): never {
  throw new AppError('BAD_REQUEST', 400, message, [
    {
      field: 'archive',
      message,
    },
  ]);
}

function normalizeZipEntryPath(entryName: string): string {
  if (entryName.includes('\0')) {
    invalidZip('ZIP archive contains an invalid null byte in a path.');
  }

  /*
   * ZIP paths should use "/", but malicious archives may
   * intentionally use "\" in an attempt to bypass traversal checks.
   */
  const normalizedSeparators = entryName.replaceAll('\\', '/');

  if (
    normalizedSeparators.startsWith('/') ||
    normalizedSeparators.startsWith('//') ||
    /^[A-Za-z]:\//.test(normalizedSeparators)
  ) {
    invalidZip('ZIP archive contains an absolute file path.');
  }

  const parts = normalizedSeparators.split('/');

  if (parts.some((part) => part === '..')) {
    invalidZip('ZIP archive contains a path traversal entry.');
  }

  const cleanedPath = parts.filter((part) => part.length > 0 && part !== '.').join('/');

  if (cleanedPath.length > INGESTION_LIMITS.maxRelativePathLength) {
    invalidZip('ZIP archive contains a file path that is too long.');
  }

  return cleanedPath;
}

function ensureDestinationPathIsSafe(destinationRoot: string, destinationPath: string): void {
  const relativePath = relative(destinationRoot, destinationPath);

  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    invalidZip('ZIP archive attempted to write outside the extraction directory.');
  }
}

function isDirectoryEntry(entry: Entry): boolean {
  return entry.fileName.endsWith('/');
}

function isUnixSymbolicLink(entry: Entry): boolean {
  /*
   * The upper 16 bits contain Unix mode information
   * when the ZIP was created on a Unix-like system.
   */
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;

  const fileType = unixMode & 0o170000;

  return fileType === 0o120000;
}

function isEncryptedEntry(entry: Entry): boolean {
  return (entry.generalPurposeBitFlag & 0x1) !== 0;
}

function openZipFile(archivePath: string): Promise<ZipFile> {
  return new Promise((resolvePromise, rejectPromise) => {
    yauzl.open(
      archivePath,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        if (!zipFile) {
          rejectPromise(new Error('ZIP library did not return a ZIP file.'));
          return;
        }

        resolvePromise(zipFile);
      },
    );
  });
}

function openEntryReadStream(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, rejectPromise) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      if (!stream) {
        rejectPromise(new Error('ZIP entry stream was unavailable.'));
        return;
      }

      resolvePromise(stream);
    });
  });
}

function mapZipError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    'BAD_REQUEST',
    400,
    'ZIP archive is invalid or could not be safely extracted.',
    [
      {
        field: 'archive',
        message: 'Provide a valid, non-encrypted ZIP archive.',
      },
    ],
  );
}

export async function extractZipArchive(
  archivePath: string,
  destinationDirectory: string,
): Promise<ZipExtractionResult> {
  const archiveStats = await stat(archivePath);

  if (!archiveStats.isFile()) {
    throw new AppError('BAD_REQUEST', 400, 'Uploaded ZIP archive is not a regular file.');
  }

  if (archiveStats.size > INGESTION_LIMITS.maxArchiveBytes) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      413,
      `ZIP archive exceeds the ${Math.floor(
        INGESTION_LIMITS.maxArchiveBytes / (1024 * 1024),
      )} MiB upload limit.`,
    );
  }

  const destinationRoot = resolve(destinationDirectory);

  await mkdir(destinationRoot, {
    recursive: true,
    mode: 0o700,
  });

  let zipFile: ZipFile;

  try {
    zipFile = await openZipFile(archivePath);
  } catch (error: unknown) {
    throw mapZipError(error);
  }

  let totalEntries = 0;
  let extractedFileCount = 0;
  let extractedBytes = 0;

  const seenPaths = new Set<string>();

  return new Promise<ZipExtractionResult>((resolvePromise, rejectPromise) => {
    let settled = false;

    function finishWithError(error: unknown): void {
      if (settled) {
        return;
      }

      settled = true;

      try {
        zipFile.close();
      } catch {
        // Ignore close errors while already handling another error.
      }

      rejectPromise(mapZipError(error));
    }

    zipFile.once('error', finishWithError);

    zipFile.once('end', () => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        zipFile.close();
      } catch {
        // Extraction already succeeded.
      }

      resolvePromise({
        totalEntries,
        extractedFileCount,
        extractedBytes,
      });
    });

    zipFile.on('entry', (entry: Entry) => {
      void (async () => {
        try {
          totalEntries += 1;

          if (totalEntries > INGESTION_LIMITS.maxFileCount) {
            throw new AppError(
              'PAYLOAD_TOO_LARGE',
              413,
              `ZIP archive contains more than ${INGESTION_LIMITS.maxFileCount.toLocaleString()} entries.`,
            );
          }

          if (isEncryptedEntry(entry)) {
            invalidZip('Encrypted ZIP archives are not supported.');
          }

          if (isUnixSymbolicLink(entry)) {
            invalidZip('ZIP archives containing symbolic links are not supported.');
          }

          const relativePath = normalizeZipEntryPath(entry.fileName);

          /*
           * Entries such as "./" contain no useful destination
           * path, so they can safely be skipped.
           */
          if (relativePath.length === 0) {
            zipFile.readEntry();
            return;
          }

          if (seenPaths.has(relativePath)) {
            invalidZip('ZIP archive contains duplicate file paths.');
          }

          seenPaths.add(relativePath);

          const destinationPath = resolve(destinationRoot, relativePath);

          ensureDestinationPathIsSafe(destinationRoot, destinationPath);

          if (isDirectoryEntry(entry)) {
            await mkdir(destinationPath, {
              recursive: true,
              mode: 0o700,
            });

            zipFile.readEntry();
            return;
          }

          /*
           * Reject obviously oversized entries before
           * decompressing them.
           */
          if (entry.uncompressedSize > INGESTION_LIMITS.maxExtractedBytes) {
            throw new AppError(
              'PAYLOAD_TOO_LARGE',
              413,
              'ZIP archive contains an entry that is too large.',
            );
          }

          if (extractedBytes + entry.uncompressedSize > INGESTION_LIMITS.maxExtractedBytes) {
            throw new AppError(
              'PAYLOAD_TOO_LARGE',
              413,
              `ZIP archive expands beyond the ${Math.floor(
                INGESTION_LIMITS.maxExtractedBytes / (1024 * 1024),
              )} MiB extraction limit.`,
            );
          }

          await mkdir(dirname(destinationPath), {
            recursive: true,
            mode: 0o700,
          });

          const inputStream = await openEntryReadStream(zipFile, entry);

          let entryBytes = 0;

          const sizeGuard = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              entryBytes += chunk.length;

              if (extractedBytes + entryBytes > INGESTION_LIMITS.maxExtractedBytes) {
                callback(
                  new AppError(
                    'PAYLOAD_TOO_LARGE',
                    413,
                    'ZIP archive exceeded the maximum extracted size.',
                  ),
                );

                return;
              }

              callback(null, chunk);
            },
          });

          const outputStream = createWriteStream(destinationPath, {
            flags: 'wx',
            mode: 0o600,
          });

          try {
            await pipeline(inputStream, sizeGuard, outputStream);
          } catch (error: unknown) {
            /*
             * Remove a partially extracted file if streaming
             * fails halfway through.
             */
            await unlink(destinationPath).catch(() => undefined);

            throw error;
          }

          extractedBytes += entryBytes;

          extractedFileCount += 1;

          zipFile.readEntry();
        } catch (error: unknown) {
          finishWithError(error);
        }
      })();
    });

    zipFile.readEntry();
  });
}
