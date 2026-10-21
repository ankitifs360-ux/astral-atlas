import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';

import type { MultipartFile } from '@fastify/multipart';
import { describe, expect, it } from 'vitest';

import { stageZipUpload } from './zip-upload.js';

interface MultipartFileOptions {
  filename?: string;
  mimetype?: string;
  content?: Buffer;
  truncated?: boolean;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

function createMultipartFile(options: MultipartFileOptions = {}): MultipartFile {
  const filename = options.filename ?? 'repository.zip';

  const mimetype = options.mimetype ?? 'application/zip';

  const content = options.content ?? Buffer.from('fake zip bytes', 'utf8');

  const stream = Readable.from([content]) as MultipartFile['file'];

  stream.truncated = options.truncated ?? false;

  /*
   * stageZipUpload only needs the properties below.
   *
   * In real requests Fastify creates this object for us.
   * Here we construct a controlled test version.
   */
  return {
    type: 'file',

    fieldname: 'repository',

    filename,

    encoding: '7bit',

    mimetype,

    file: stream,

    fields: {},

    toBuffer: async () => content,
  } as MultipartFile;
}

describe('stageZipUpload', () => {
  it('streams a valid ZIP upload to a temporary file', async () => {
    const content = Buffer.from('example zip contents', 'utf8');

    const file = createMultipartFile({
      content,
    });

    const staged = await stageZipUpload(file);

    try {
      expect(await pathExists(staged.archivePath)).toBe(true);

      expect(staged.sizeBytes).toBe(content.length);

      expect(await readFile(staged.archivePath)).toEqual(content);
    } finally {
      await staged.cleanup();
    }

    expect(await pathExists(staged.archivePath)).toBe(false);
  });

  it('calculates a deterministic SHA-256 source identity while streaming', async () => {
    const content = Buffer.from('same uploaded repository', 'utf8');

    const expectedHash = createHash('sha256').update(content).digest('hex');

    const staged = await stageZipUpload(
      createMultipartFile({
        content,
      }),
    );

    try {
      expect(staged.contentSha256).toBe(expectedHash);

      expect(staged.sourceKey).toBe(`zip:${expectedHash}`);

      expect(staged.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await staged.cleanup();
    }
  });

  it('rejects uploads without a .zip filename', async () => {
    await expect(
      stageZipUpload(
        createMultipartFile({
          filename: 'repository.txt',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,

      message: 'Uploaded repository must be a ZIP file.',
    });
  });

  it('rejects unsupported MIME types', async () => {
    await expect(
      stageZipUpload(
        createMultipartFile({
          mimetype: 'text/plain',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',

      statusCode: 415,

      message: 'Uploaded repository has an unsupported content type.',
    });
  });

  it('rejects an empty uploaded ZIP', async () => {
    await expect(
      stageZipUpload(
        createMultipartFile({
          content: Buffer.alloc(0),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      statusCode: 400,

      message: 'Uploaded ZIP archive is empty.',
    });
  });

  it('rejects a multipart stream marked as truncated', async () => {
    await expect(
      stageZipUpload(
        createMultipartFile({
          content: Buffer.from('partial archive', 'utf8'),

          truncated: true,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',

      statusCode: 413,
    });
  });

  it('allows cleanup to be called more than once safely', async () => {
    const staged = await stageZipUpload(createMultipartFile());

    const stagingDirectory = dirname(staged.archivePath);

    expect(await pathExists(stagingDirectory)).toBe(true);

    await staged.cleanup();
    await staged.cleanup();

    expect(await pathExists(stagingDirectory)).toBe(false);
  });
});
