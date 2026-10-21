import { createWriteStream } from 'node:fs';
import { access, readFile, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { INGESTION_LIMITS } from './limits.js';
import { withTempWorkspace } from './temp-workspace.js';
import { extractZipArchive } from './zip-extractor.js';

interface ZipEntryInput {
  path: string;
  content: string;
  mode?: number;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createZipArchive(
  archivePath: string,
  entries: readonly ZipEntryInput[],
): Promise<void> {
  const zipFile = new ZipFile();

  for (const entry of entries) {
    zipFile.addBuffer(Buffer.from(entry.content, 'utf8'), entry.path, {
      ...(entry.mode !== undefined
        ? {
            mode: entry.mode,
          }
        : {}),
    });
  }

  const writing = pipeline(zipFile.outputStream, createWriteStream(archivePath));

  zipFile.end();

  await writing;
}

async function replaceZipEntryName(
  archivePath: string,
  originalName: string,
  replacementName: string,
): Promise<void> {
  const original = Buffer.from(originalName, 'utf8');

  const replacement = Buffer.from(replacementName, 'utf8');

  if (original.length !== replacement.length) {
    throw new Error('ZIP entry name replacement must preserve byte length.');
  }

  const archive = await readFile(archivePath);

  let searchOffset = 0;
  let replacementCount = 0;

  while (true) {
    const index = archive.indexOf(original, searchOffset);

    if (index === -1) {
      break;
    }

    replacement.copy(archive, index);

    replacementCount += 1;
    searchOffset = index + replacement.length;
  }

  if (replacementCount === 0) {
    throw new Error(`Could not find ZIP entry name: ${originalName}`);
  }

  await writeFile(archivePath, archive);
}

describe('extractZipArchive', () => {
  it('extracts a normal ZIP archive', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'repository.zip');

      const destination = join(workspace.rootDir, 'extracted');

      await createZipArchive(archivePath, [
        {
          path: 'src/app.ts',
          content: 'export const app = true;\n',
        },
        {
          path: 'src/helper.js',
          content: 'export const helper = true;\n',
        },
        {
          path: 'README.md',
          content: '# Example\n',
        },
      ]);

      const result = await extractZipArchive(archivePath, destination);

      expect(result.totalEntries).toBe(3);
      expect(result.extractedFileCount).toBe(3);

      expect(result.extractedBytes).toBeGreaterThan(0);

      expect(await readFile(join(destination, 'src', 'app.ts'), 'utf8')).toBe(
        'export const app = true;\n',
      );

      expect(await readFile(join(destination, 'README.md'), 'utf8')).toBe('# Example\n');
    });
  });

  it('rejects ZIP path traversal entries', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'traversal.zip');

      const destination = join(workspace.rootDir, 'extracted');

      /*
       * yazl correctly refuses "../" paths itself.
       * So we create a valid same-length name first and
       * then mutate both ZIP filename records.
       *
       * "aa/evil.txt" and "../evil.txt" have equal length.
       */
      await createZipArchive(archivePath, [
        {
          path: 'aa/evil.txt',
          content: 'malicious',
        },
      ]);

      await replaceZipEntryName(archivePath, 'aa/evil.txt', '../evil.txt');

      await expect(extractZipArchive(archivePath, destination)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
      });

      expect(await pathExists(join(workspace.rootDir, 'evil.txt'))).toBe(false);
    });
  });

  it('rejects symbolic links stored inside a ZIP', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'symlink.zip');

      const destination = join(workspace.rootDir, 'extracted');

      await createZipArchive(archivePath, [
        {
          path: 'dangerous-link',
          content: '/etc/passwd',

          // Unix symbolic-link file type.
          mode: 0o120777,
        },
      ]);

      await expect(extractZipArchive(archivePath, destination)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'ZIP archives containing symbolic links are not supported.',
      });
    });
  });

  it('rejects duplicate ZIP paths', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'duplicates.zip');

      const destination = join(workspace.rootDir, 'extracted');

      await createZipArchive(archivePath, [
        {
          path: 'src/app.ts',
          content: 'first',
        },
        {
          path: 'src/app.ts',
          content: 'second',
        },
      ]);

      await expect(extractZipArchive(archivePath, destination)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'ZIP archive contains duplicate file paths.',
      });
    });
  });

  it('rejects malformed ZIP files', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'invalid.zip');

      const destination = join(workspace.rootDir, 'extracted');

      await writeFile(archivePath, 'this is not a zip archive', 'utf8');

      await expect(extractZipArchive(archivePath, destination)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        statusCode: 400,
        message: 'ZIP archive is invalid or could not be safely extracted.',
      });
    });
  });

  it('rejects archives larger than the upload limit', async () => {
    await withTempWorkspace(async (workspace) => {
      const archivePath = join(workspace.rootDir, 'too-large.zip');

      const destination = join(workspace.rootDir, 'extracted');

      await writeFile(archivePath, Buffer.alloc(1));

      /*
       * truncate creates a sparse file on Linux,
       * so this test does not actually write 50+ MiB
       * of data to disk.
       */
      await truncate(archivePath, INGESTION_LIMITS.maxArchiveBytes + 1);

      await expect(extractZipArchive(archivePath, destination)).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        statusCode: 413,
      });
    });
  });
});
