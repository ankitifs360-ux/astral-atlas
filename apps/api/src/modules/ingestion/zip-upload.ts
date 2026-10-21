import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { MultipartFile } from '@fastify/multipart';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

export interface StagedZipUpload {
  archivePath: string;

  sizeBytes: number;

  contentSha256: string;

  sourceKey: string;

  cleanup: () => Promise<void>;
}

function isZipFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

function isAcceptedMimeType(mimeType: string): boolean {
  return (
    mimeType === 'application/zip' ||
    mimeType === 'application/x-zip-compressed' ||
    mimeType === 'application/octet-stream'
  );
}

export async function stageZipUpload(file: MultipartFile): Promise<StagedZipUpload> {
  if (!isZipFilename(file.filename)) {
    throw new AppError('BAD_REQUEST', 400, 'Uploaded repository must be a ZIP file.', [
      {
        field: 'repository',
        message: 'Upload a file with a .zip extension.',
      },
    ]);
  }

  if (!isAcceptedMimeType(file.mimetype)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Uploaded repository has an unsupported content type.',
      [
        {
          field: 'repository',
          message: 'Upload a ZIP archive.',
        },
      ],
    );
  }

  const rootDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-upload-'));

  const archivePath = join(rootDirectory, 'repository.zip');

  let cleanedUp = false;

  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    await rm(rootDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  };

  try {
    const hash = createHash('sha256');

    let streamedBytes = 0;

    const sizeAndHashGuard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        streamedBytes += chunk.length;

        if (streamedBytes > INGESTION_LIMITS.maxArchiveBytes) {
          callback(
            new AppError(
              'PAYLOAD_TOO_LARGE',
              413,
              `ZIP archive exceeds the ${Math.floor(
                INGESTION_LIMITS.maxArchiveBytes / (1024 * 1024),
              )} MiB upload limit.`,
            ),
          );

          return;
        }

        hash.update(chunk);

        callback(null, chunk);
      },
    });

    const output = createWriteStream(archivePath, {
      flags: 'wx',
      mode: 0o600,
    });

    await pipeline(file.file, sizeAndHashGuard, output);

    /*
     * @fastify/multipart marks the stream as truncated
     * if its own configured fileSize limit stopped it.
     *
     * We check this in addition to our own byte counter,
     * giving us protection at two layers.
     */
    if (file.file.truncated) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        413,
        `ZIP archive exceeds the ${Math.floor(
          INGESTION_LIMITS.maxArchiveBytes / (1024 * 1024),
        )} MiB upload limit.`,
      );
    }

    const archiveStats = await stat(archivePath);

    if (!archiveStats.isFile()) {
      throw new AppError('BAD_REQUEST', 400, 'Uploaded ZIP could not be staged safely.');
    }

    if (archiveStats.size === 0) {
      throw new AppError('BAD_REQUEST', 400, 'Uploaded ZIP archive is empty.');
    }

    /*
     * Defensive consistency check.
     *
     * What we counted from the incoming stream should be
     * exactly what exists on disk.
     */
    if (archiveStats.size !== streamedBytes) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        'Uploaded ZIP archive could not be staged completely.',
      );
    }

    const contentSha256 = hash.digest('hex');

    return {
      archivePath,

      sizeBytes: archiveStats.size,

      contentSha256,

      sourceKey: `zip:${contentSha256}`,

      cleanup,
    };
  } catch (error: unknown) {
    await cleanup();

    throw error;
  }
}
