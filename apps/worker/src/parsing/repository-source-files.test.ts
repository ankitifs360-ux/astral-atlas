import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  scanRepositorySourceFiles,
  WORKER_REPOSITORY_SCAN_LIMITS,
} from './repository-source-files.js';

const temporaryDirectories: string[] = [];

async function createTemporaryRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'astral-atlas-source-scan-test-'));

  temporaryDirectories.push(directory);

  return directory;
}

async function writeSourceFile(
  repositoryRoot: string,
  relativePath: string,
  contents: string | Buffer = 'export const value = 1;\n',
): Promise<void> {
  const pathParts = relativePath.split('/');

  const fileName = pathParts.pop();

  if (fileName === undefined) {
    throw new Error('Test source path must contain a file name.');
  }

  const parentDirectory = join(repositoryRoot, ...pathParts);

  await mkdir(parentDirectory, {
    recursive: true,
  });

  await writeFile(join(parentDirectory, fileName), contents);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }),
  );
});

describe('scanRepositorySourceFiles', () => {
  it('finds supported repository source files in deterministic path order', async () => {
    const repositoryRoot = await createTemporaryRepository();

    await writeSourceFile(repositoryRoot, 'src/z-last.ts', 'export const z = 1;\n');

    await writeSourceFile(repositoryRoot, 'src/a-first.js', 'export const a = 1;\n');

    await writeSourceFile(
      repositoryRoot,
      'src/components/button.tsx',
      'export function Button() { return null; }\n',
    );

    await writeSourceFile(repositoryRoot, 'scripts/tool.py', 'value = 1\n');

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual([
      'scripts/tool.py',
      'src/a-first.js',
      'src/components/button.tsx',
      'src/z-last.ts',
    ]);

    expect(result.sourceFiles.map((file) => file.language)).toEqual([
      'python',
      'javascript',
      'tsx',
      'typescript',
    ]);

    expect(result.totalFileCount).toBe(4);

    expect(result.skippedFiles).toEqual([]);

    expect(result.skipped).toEqual({
      unsupported: 0,
      oversized: 0,
      ignoredDirectory: 0,
      symbolicLink: 0,
    });

    for (const file of result.sourceFiles) {
      expect(file.absolutePath).toContain(repositoryRoot);

      expect(file.sizeBytes).toBeGreaterThan(0);
    }
  });

  it('retains unsupported and generated files as skipped metadata', async () => {
    const repositoryRoot = await createTemporaryRepository();

    await writeSourceFile(repositoryRoot, 'src/app.ts');

    await writeSourceFile(repositoryRoot, 'README.md', '# Repository\n');

    await writeSourceFile(repositoryRoot, 'public/runtime.min.js', 'console.log("generated");\n');

    await writeSourceFile(repositoryRoot, 'public/vendor.bundle.js', 'console.log("generated");\n');

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['src/app.ts']);

    expect(result.totalFileCount).toBe(4);

    expect(result.skipped.unsupported).toBe(3);

    expect(result.skipped.oversized).toBe(0);

    expect(result.skippedFiles).toEqual([
      {
        relativePath: 'public/runtime.min.js',

        language: 'javascript',

        sizeBytes: Buffer.byteLength('console.log("generated");\n'),

        reason: 'generated-source',
      },

      {
        relativePath: 'public/vendor.bundle.js',

        language: 'javascript',

        sizeBytes: Buffer.byteLength('console.log("generated");\n'),

        reason: 'generated-source',
      },

      {
        relativePath: 'README.md',

        language: null,

        sizeBytes: Buffer.byteLength('# Repository\n'),

        reason: 'unsupported-language',
      },
    ]);
  });

  it('does not descend into ignored directories or expose them as skipped files', async () => {
    const repositoryRoot = await createTemporaryRepository();

    await writeSourceFile(repositoryRoot, 'src/app.ts');

    await writeSourceFile(repositoryRoot, 'node_modules/package/index.ts');

    await writeSourceFile(repositoryRoot, 'dist/generated.ts');

    await writeSourceFile(repositoryRoot, '.git/internal.ts');

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['src/app.ts']);

    /*
     * Files inside ignored directories are never walked,
     * so they do not contribute to totalFileCount.
     */
    expect(result.totalFileCount).toBe(1);

    expect(result.skipped.ignoredDirectory).toBe(3);

    /*
     * Ignored directories are implementation/infrastructure
     * noise and are intentionally not persisted as repository
     * file metadata.
     */
    expect(result.skippedFiles).toEqual([]);
  });

  it('skips symbolic links without exposing link targets as file metadata', async () => {
    const repositoryRoot = await createTemporaryRepository();

    const outsideDirectory = await mkdtemp(join(tmpdir(), 'astral-atlas-outside-test-'));

    temporaryDirectories.push(outsideDirectory);

    const outsideFile = join(outsideDirectory, 'outside.ts');

    await writeFile(outsideFile, 'export const outside = true;\n');

    await writeSourceFile(repositoryRoot, 'src/inside.ts');

    await mkdir(join(repositoryRoot, 'src'), {
      recursive: true,
    });

    await symlink(outsideFile, join(repositoryRoot, 'src/link.ts'));

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['src/inside.ts']);

    expect(result.skipped.symbolicLink).toBe(1);

    /*
     * A symlink is not counted as a regular repository file.
     */
    expect(result.totalFileCount).toBe(1);

    /*
     * Symlinks are deliberately excluded from persisted file
     * metadata because following or describing their targets
     * would weaken the repository isolation boundary.
     */
    expect(result.skippedFiles).toEqual([]);
  });

  it('retains oversized supported source files as partial-analysis metadata', async () => {
    const repositoryRoot = await createTemporaryRepository();

    const oversizedContents = Buffer.alloc(
      WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileBytes + 1,
      0x61,
    );

    await writeSourceFile(repositoryRoot, 'src/too-large.ts', oversizedContents);

    await writeSourceFile(repositoryRoot, 'src/normal.ts');

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles.map((file) => file.relativePath)).toEqual(['src/normal.ts']);

    expect(result.totalFileCount).toBe(2);

    expect(result.skipped.oversized).toBe(1);

    expect(result.skippedFiles).toEqual([
      {
        relativePath: 'src/too-large.ts',

        language: 'typescript',

        sizeBytes: WORKER_REPOSITORY_SCAN_LIMITS.maxAnalyzableFileBytes + 1,

        reason: 'too-large',
      },
    ]);
  });

  it('keeps skipped-file metadata in deterministic path order', async () => {
    const repositoryRoot = await createTemporaryRepository();

    await writeSourceFile(repositoryRoot, 'z-last.md', '# Last\n');

    await writeSourceFile(repositoryRoot, 'a-first.txt', 'first\n');

    await writeSourceFile(repositoryRoot, 'm-middle.min.js', 'console.log("middle");\n');

    const result = await scanRepositorySourceFiles(repositoryRoot);

    expect(result.sourceFiles).toEqual([]);

    expect(result.skippedFiles.map((file) => file.relativePath)).toEqual([
      'a-first.txt',
      'm-middle.min.js',
      'z-last.md',
    ]);

    expect(result.skippedFiles.map((file) => file.reason)).toEqual([
      'unsupported-language',
      'generated-source',
      'unsupported-language',
    ]);
  });

  it('rejects a repository root that is not a directory', async () => {
    const repositoryRoot = await createTemporaryRepository();

    const filePath = join(repositoryRoot, 'repository.ts');

    await writeFile(filePath, 'export const value = 1;\n');

    await expect(scanRepositorySourceFiles(filePath)).rejects.toThrow(
      `Repository root is not a directory: ${filePath}`,
    );
  });
});
