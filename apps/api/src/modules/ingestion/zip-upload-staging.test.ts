import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { stageZipUpload, type ZipUploadReadable } from './zip-upload-staging.js';

const stagingDirectories: string[] = [];

function createZipBytes(payload = 'astral-atlas-test'): Buffer {
  /*
   * stageZipUpload deliberately performs only lightweight
   * upload validation. Full ZIP structure validation and
   * safe extraction happen later in the worker.
   */
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(payload, 'utf8')]);
}

function createStream(
  bytes: Buffer,
  options: {
    truncated?: boolean;
    chunkSize?: number;
  } = {},
): ZipUploadReadable {
  const chunkSize = options.chunkSize ?? Math.max(1, bytes.length);

  const chunks: Buffer[] = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, offset + chunkSize));
  }

  const stream = Readable.from(chunks) as ZipUploadReadable;

  if (options.truncated !== undefined) {
    stream.truncated = options.truncated;
  }

  return stream;
}

async function createStagingDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'astral-atlas-zip-staging-'));

  stagingDirectories.push(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    stagingDirectories.splice(0).map(async (directory) => {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }),
  );
});

describe('stageZipUpload', () => {
  it('stages a ZIP under its deterministic SHA-256 filename', async () => {
    const directory = await createStagingDirectory();

    const bytes = createZipBytes();

    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    const result = await stageZipUpload(
      {
        filename: 'repository.zip',
        mimetype: 'application/zip',
        stream: createStream(bytes),
      },
      directory,
    );

    expect(result).toEqual({
      sourceKey: `zip:${expectedHash}`,
      contentSha256: expectedHash,
      archivePath: join(directory, `${expectedHash}.zip`),
      sizeBytes: bytes.length,
    });

    await expect(readFile(result.archivePath)).resolves.toEqual(bytes);
  });

  it('hashes correctly when the upload arrives in multiple chunks', async () => {
    const directory = await createStagingDirectory();

    const bytes = createZipBytes('chunked-upload-content');

    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    const result = await stageZipUpload(
      {
        filename: 'repository.zip',
        mimetype: 'application/octet-stream',
        stream: createStream(bytes, {
          chunkSize: 2,
        }),
      },
      directory,
    );

    expect(result.contentSha256).toBe(expectedHash);

    expect(result.sizeBytes).toBe(bytes.length);
  });

  it('reuses the same canonical artifact for duplicate ZIP content', async () => {
    const directory = await createStagingDirectory();

    const bytes = createZipBytes('same-repository');

    const first = await stageZipUpload(
      {
        filename: 'first.zip',
        mimetype: 'application/zip',
        stream: createStream(bytes),
      },
      directory,
    );

    const second = await stageZipUpload(
      {
        filename: 'second.zip',
        mimetype: 'application/x-zip-compressed',
        stream: createStream(bytes),
      },
      directory,
    );

    expect(second.archivePath).toBe(first.archivePath);

    expect(second.contentSha256).toBe(first.contentSha256);

    expect(second.sourceKey).toBe(first.sourceKey);

    await expect(readFile(first.archivePath)).resolves.toEqual(bytes);

    const entries = await readdir(directory);

    expect(entries).toEqual([`${first.contentSha256}.zip`]);
  });

  it('removes temporary upload files after successful staging', async () => {
    const directory = await createStagingDirectory();

    const result = await stageZipUpload(
      {
        filename: 'repository.zip',
        mimetype: 'application/zip',
        stream: createStream(createZipBytes()),
      },
      directory,
    );

    const entries = await readdir(directory);

    expect(entries).toEqual([`${result.contentSha256}.zip`]);

    expect(entries.some((entry) => entry.startsWith('.upload-'))).toBe(false);
  });

  it('rejects a non-ZIP filename before writing anything', async () => {
    const directory = await createStagingDirectory();

    await expect(
      stageZipUpload(
        {
          filename: 'repository.tar.gz',
          mimetype: 'application/zip',
          stream: createStream(createZipBytes()),
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
    });

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects an unsupported upload MIME type before writing anything', async () => {
    const directory = await createStagingDirectory();

    await expect(
      stageZipUpload(
        {
          filename: 'repository.zip',
          mimetype: 'text/plain',
          stream: createStream(createZipBytes()),
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      statusCode: 415,
    });

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects an empty upload and removes its temporary file', async () => {
    const directory = await createStagingDirectory();

    await expect(
      stageZipUpload(
        {
          filename: 'repository.zip',
          mimetype: 'application/zip',
          stream: createStream(Buffer.alloc(0)),
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'Uploaded ZIP file is empty.',
    });

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects content without a ZIP signature and removes its temporary file', async () => {
    const directory = await createStagingDirectory();

    await expect(
      stageZipUpload(
        {
          filename: 'repository.zip',
          mimetype: 'application/zip',
          stream: createStream(Buffer.from('this is not a zip archive', 'utf8')),
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'Uploaded file is not a valid ZIP archive.',
    });

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects a multipart stream marked as truncated and removes its temporary file', async () => {
    const directory = await createStagingDirectory();

    await expect(
      stageZipUpload(
        {
          filename: 'repository.zip',
          mimetype: 'application/zip',
          stream: createStream(createZipBytes(), {
            truncated: true,
          }),
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      statusCode: 413,
    });

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects an empty staging-directory value before consuming the upload', async () => {
    const stream = createStream(createZipBytes());

    await expect(
      stageZipUpload(
        {
          filename: 'repository.zip',
          mimetype: 'application/zip',
          stream,
        },
        '   ',
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,
      message: 'ZIP staging directory cannot be empty.',
    });
  });
});
