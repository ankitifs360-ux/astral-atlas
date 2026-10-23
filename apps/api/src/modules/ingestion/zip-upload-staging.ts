import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { link, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AppError } from '../../errors.js';
import { INGESTION_LIMITS } from './limits.js';

const ALLOWED_ZIP_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);

const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
] as const;

export interface ZipUploadReadable extends Readable {
  /**
   * @fastify/multipart marks a file stream as truncated when
   * its configured file-size limit was reached.
   */
  truncated?: boolean;
}

export interface StageZipUploadInput {
  filename: string;
  mimetype: string;
  stream: ZipUploadReadable;
}

export interface StagedZipUpload {
  sourceKey: string;

  contentSha256: string;

  archivePath: string;

  sizeBytes: number;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new AppError('BAD_REQUEST', 400, `${label} cannot be empty.`);
  }

  return normalized;
}

function validateUploadMetadata(input: StageZipUploadInput): void {
  const filename = requireNonEmpty(input.filename, 'Uploaded ZIP filename');

  const mimetype = requireNonEmpty(input.mimetype, 'Uploaded ZIP MIME type').toLowerCase();

  if (!filename.toLowerCase().endsWith('.zip')) {
    throw new AppError('BAD_REQUEST', 400, 'Uploaded repository must be a .zip file.', [
      {
        field: 'file',
        message: 'Only ZIP repository uploads are supported.',
      },
    ]);
  }

  if (!ALLOWED_ZIP_MIME_TYPES.has(mimetype)) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Uploaded repository must use a ZIP-compatible content type.',
      [
        {
          field: 'file',
          message: `Unsupported upload content type: ${mimetype}`,
        },
      ],
    );
  }
}

function hasZipSignature(prefix: Buffer): boolean {
  if (prefix.length < 4) {
    return false;
  }

  return ZIP_SIGNATURES.some((signature) => prefix.subarray(0, 4).equals(signature));
}

function createPayloadTooLargeError(): AppError {
  return new AppError(
    'PAYLOAD_TOO_LARGE',
    413,
    `Uploaded ZIP exceeds the ${Math.floor(
      INGESTION_LIMITS.maxArchiveBytes / (1024 * 1024),
    )} MiB archive limit.`,
    [
      {
        field: 'file',
        message: 'Repository ZIP is too large.',
      },
    ],
  );
}

/**
 * Copies a multipart ZIP stream into durable staging storage.
 *
 * Important:
 * - this function does NOT extract the archive
 * - this function does NOT analyse repository code
 * - both of those remain worker responsibilities
 *
 * The staging directory must be reachable by both the API process and
 * the analysis worker. In Docker this should be a shared mounted volume.
 *
 * Canonical hash-named artifacts are intentionally NOT deleted here.
 * Multiple concurrent submissions of the same ZIP may share the same
 * staged file, so request-side cleanup could delete an artifact that a
 * queued worker still needs. The worker owns artifact cleanup after the
 * analysis reaches a terminal state. B14 can add stale-artifact cleanup
 * for abandoned uploads.
 */
export async function stageZipUpload(
  input: StageZipUploadInput,
  stagingDirectory: string,
): Promise<StagedZipUpload> {
  validateUploadMetadata(input);

  const normalizedStagingDirectory = requireNonEmpty(stagingDirectory, 'ZIP staging directory');

  const absoluteStagingDirectory = resolve(normalizedStagingDirectory);

  await mkdir(absoluteStagingDirectory, {
    recursive: true,
    mode: 0o700,
  });

  const temporaryPath = join(absoluteStagingDirectory, `.upload-${randomUUID()}.tmp`);

  const hash = createHash('sha256');

  let sizeBytes = 0;
  let prefix = Buffer.alloc(0);

  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;

      if (sizeBytes > INGESTION_LIMITS.maxArchiveBytes) {
        callback(createPayloadTooLargeError());

        return;
      }

      hash.update(chunk);

      if (prefix.length < 4) {
        const missingBytes = 4 - prefix.length;

        prefix = Buffer.concat([prefix, chunk.subarray(0, missingBytes)]);
      }

      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      input.stream,
      inspector,
      createWriteStream(temporaryPath, {
        flags: 'wx',
        mode: 0o600,
      }),
    );

    if (input.stream.truncated === true) {
      throw createPayloadTooLargeError();
    }

    if (sizeBytes === 0) {
      throw new AppError('BAD_REQUEST', 400, 'Uploaded ZIP file is empty.');
    }

    if (!hasZipSignature(prefix)) {
      throw new AppError('BAD_REQUEST', 400, 'Uploaded file is not a valid ZIP archive.', [
        {
          field: 'file',
          message: 'ZIP file signature is missing or invalid.',
        },
      ]);
    }

    const contentSha256 = hash.digest('hex');

    const archivePath = join(absoluteStagingDirectory, `${contentSha256}.zip`);

    /*
     * Create a hard link instead of rename().
     *
     * link() fails with EEXIST when another concurrent request has
     * already staged the same ZIP hash. In that case we reuse the
     * existing canonical artifact instead of overwriting it.
     */
    try {
      await link(temporaryPath, archivePath);
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;

      if (code !== 'EEXIST') {
        throw error;
      }
    }

    await rm(temporaryPath, {
      force: true,
    });

    return {
      sourceKey: `zip:${contentSha256}`,

      contentSha256,

      archivePath,

      sizeBytes,
    };
  } catch (error: unknown) {
    await rm(temporaryPath, {
      force: true,
    });

    throw error;
  }
}
