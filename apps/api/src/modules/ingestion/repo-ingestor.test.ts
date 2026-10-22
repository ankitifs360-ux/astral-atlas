import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';

import type { GitHubClient, ResolvedGitHubRepository } from './github-client.js';

import {
  RepoIngestor,
  type GitCheckoutFunction,
  type GitHistoryReaderFunction,
} from './repo-ingestor.js';

import { withTempWorkspace } from './temp-workspace.js';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);

    return true;
  } catch {
    return false;
  }
}

function createResolvedRepository(
  overrides: Partial<ResolvedGitHubRepository> = {},
): ResolvedGitHubRepository {
  return {
    owner: 'facebook',

    repo: 'react',

    canonicalUrl: 'https://github.com/facebook/react',

    sourceKey: 'github:facebook/react',

    defaultBranch: 'main',

    commitSha: 'a'.repeat(40),

    cloneUrl: 'https://github.com/facebook/react.git',

    repositorySizeKb: 1_000,

    ...overrides,
  };
}

function createFakeGitHubClient(resolvedRepository = createResolvedRepository()): GitHubClient {
  return {
    resolveRepository: vi.fn(async () => resolvedRepository),
  } as unknown as GitHubClient;
}

function createEmptyHistoryReader(): GitHistoryReaderFunction {
  return vi.fn(async () => []);
}

async function createZipArchive(archivePath: string): Promise<void> {
  const zipFile = new ZipFile();

  zipFile.addBuffer(Buffer.from('export const app = true;\n', 'utf8'), 'src/app.ts');

  zipFile.addBuffer(Buffer.from('export const helper = true;\n', 'utf8'), 'src/helper.js');

  zipFile.addBuffer(Buffer.from('def parse():\n    pass\n', 'utf8'), 'python/parser.py');

  zipFile.addBuffer(Buffer.from('# Example\n', 'utf8'), 'README.md');

  const writing = pipeline(zipFile.outputStream, createWriteStream(archivePath));

  zipFile.end();

  await writing;
}

async function calculateSha256(filePath: string): Promise<string> {
  const contents = await readFile(filePath);

  return createHash('sha256').update(contents).digest('hex');
}

describe('RepoIngestor', () => {
  describe('GitHub ingestion', () => {
    it('prepares a GitHub repository, reads history, and scans supported files', async () => {
      const resolvedRepository = createResolvedRepository();

      const resolveRepository = vi.fn(async () => resolvedRepository);

      const fakeGitHubClient = {
        resolveRepository,
      } as unknown as GitHubClient;

      const checkoutMock: GitCheckoutFunction = vi.fn(async (input) => {
        const srcDirectory = join(input.destinationDirectory, 'src');

        await mkdir(srcDirectory, {
          recursive: true,
        });

        await writeFile(join(srcDirectory, 'app.ts'), 'export const app = true;\n', 'utf8');

        await writeFile(join(srcDirectory, 'helper.js'), 'export const helper = true;\n', 'utf8');

        await writeFile(join(input.destinationDirectory, 'README.md'), '# Example\n', 'utf8');

        return {
          commitSha: input.commitSha,

          remoteUrl: 'https://github.com/facebook/react.git',
        };
      });

      const historyTouches = [
        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/app.ts',
        },

        {
          commitSha: 'b'.repeat(40),

          filePath: 'src/app.ts',
        },

        {
          commitSha: 'a'.repeat(40),

          filePath: 'src/helper.js',
        },
      ];

      const historyReaderMock: GitHistoryReaderFunction = vi.fn(async () => historyTouches);

      const ingestor = new RepoIngestor({
        githubClient: fakeGitHubClient,

        checkoutGitHubCommit: checkoutMock,

        readGitHistoryFileTouches: historyReaderMock,
      });

      const prepared = await ingestor.prepareGitHubRepository('https://github.com/facebook/react');

      try {
        expect(resolveRepository).toHaveBeenCalledTimes(1);

        expect(checkoutMock).toHaveBeenCalledTimes(1);

        expect(historyReaderMock).toHaveBeenCalledTimes(1);

        expect(historyReaderMock).toHaveBeenCalledWith(prepared.repositoryDirectory);

        expect(prepared).toMatchObject({
          sourceType: 'github',

          owner: 'facebook',

          repo: 'react',

          sourceKey: 'github:facebook/react',

          canonicalUrl: 'https://github.com/facebook/react',

          defaultBranch: 'main',

          commitSha: 'a'.repeat(40),
        });

        expect(prepared.historyTouches).toEqual(historyTouches);

        expect(
          prepared.scan.sourceFiles.map((file) => ({
            path: file.relativePath,

            language: file.language,
          })),
        ).toEqual([
          {
            path: 'src/app.ts',

            language: 'typescript',
          },

          {
            path: 'src/helper.js',

            language: 'javascript',
          },
        ]);

        expect(await pathExists(prepared.repositoryDirectory)).toBe(true);
      } finally {
        await prepared.cleanup();
      }

      expect(await pathExists(prepared.repositoryDirectory)).toBe(false);
    });

    it('cleans up the temporary workspace when checkout fails', async () => {
      const fakeGitHubClient = createFakeGitHubClient();

      let destinationDirectory = '';

      const checkoutMock: GitCheckoutFunction = vi.fn(async (input) => {
        destinationDirectory = input.destinationDirectory;

        throw new Error('Simulated checkout failure');
      });

      const historyReaderMock = createEmptyHistoryReader();

      const ingestor = new RepoIngestor({
        githubClient: fakeGitHubClient,

        checkoutGitHubCommit: checkoutMock,

        readGitHistoryFileTouches: historyReaderMock,
      });

      await expect(
        ingestor.prepareGitHubRepository('https://github.com/facebook/react'),
      ).rejects.toThrow('Simulated checkout failure');

      expect(historyReaderMock).not.toHaveBeenCalled();

      expect(destinationDirectory.length).toBeGreaterThan(0);

      expect(await pathExists(destinationDirectory)).toBe(false);
    });

    it('cleans up the temporary workspace when Git history reading fails', async () => {
      const fakeGitHubClient = createFakeGitHubClient();

      let destinationDirectory = '';

      const checkoutMock: GitCheckoutFunction = vi.fn(async (input) => {
        destinationDirectory = input.destinationDirectory;

        await mkdir(join(destinationDirectory, 'src'), {
          recursive: true,
        });

        return {
          commitSha: input.commitSha,

          remoteUrl: 'https://github.com/facebook/react.git',
        };
      });

      const historyReaderMock: GitHistoryReaderFunction = vi.fn(async () => {
        throw new Error('Simulated history failure');
      });

      const ingestor = new RepoIngestor({
        githubClient: fakeGitHubClient,

        checkoutGitHubCommit: checkoutMock,

        readGitHistoryFileTouches: historyReaderMock,
      });

      await expect(
        ingestor.prepareGitHubRepository('https://github.com/facebook/react'),
      ).rejects.toThrow('Simulated history failure');

      expect(checkoutMock).toHaveBeenCalledTimes(1);

      expect(historyReaderMock).toHaveBeenCalledTimes(1);

      expect(destinationDirectory.length).toBeGreaterThan(0);

      expect(await pathExists(destinationDirectory)).toBe(false);
    });

    it('rejects an oversized repository before checkout', async () => {
      const fakeGitHubClient = createFakeGitHubClient(
        createResolvedRepository({
          repositorySizeKb: 300 * 1024,
        }),
      );

      const checkoutMock: GitCheckoutFunction = vi.fn();

      const historyReaderMock = createEmptyHistoryReader();

      const ingestor = new RepoIngestor({
        githubClient: fakeGitHubClient,

        checkoutGitHubCommit: checkoutMock,

        readGitHistoryFileTouches: historyReaderMock,
      });

      await expect(
        ingestor.prepareGitHubRepository('https://github.com/facebook/react'),
      ).rejects.toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',

        statusCode: 413,
      });

      expect(checkoutMock).not.toHaveBeenCalled();

      expect(historyReaderMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid GitHub URL before calling GitHub', async () => {
      const resolveRepository = vi.fn();

      const fakeGitHubClient = {
        resolveRepository,
      } as unknown as GitHubClient;

      const checkoutMock: GitCheckoutFunction = vi.fn();

      const historyReaderMock = createEmptyHistoryReader();

      const ingestor = new RepoIngestor({
        githubClient: fakeGitHubClient,

        checkoutGitHubCommit: checkoutMock,

        readGitHistoryFileTouches: historyReaderMock,
      });

      await expect(
        ingestor.prepareGitHubRepository('https://example.com/not/github'),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',

        statusCode: 400,
      });

      expect(resolveRepository).not.toHaveBeenCalled();

      expect(checkoutMock).not.toHaveBeenCalled();

      expect(historyReaderMock).not.toHaveBeenCalled();
    });
  });

  describe('ZIP ingestion', () => {
    it('extracts a ZIP and scans supported source files', async () => {
      await withTempWorkspace(async (workspace) => {
        const archivePath = join(workspace.rootDir, 'repository.zip');

        await createZipArchive(archivePath);

        const ingestor = new RepoIngestor({
          githubClient: createFakeGitHubClient(),
        });

        const prepared = await ingestor.prepareZipRepository(archivePath);

        try {
          expect(prepared.sourceType).toBe('zip');

          expect(
            prepared.scan.sourceFiles.map((file) => ({
              path: file.relativePath,

              language: file.language,
            })),
          ).toEqual([
            {
              path: 'python/parser.py',

              language: 'python',
            },

            {
              path: 'src/app.ts',

              language: 'typescript',
            },

            {
              path: 'src/helper.js',

              language: 'javascript',
            },
          ]);

          expect(prepared.scan.totalFileCount).toBe(4);

          expect(prepared.scan.skipped.unsupported).toBe(1);

          /*
           * ZIP uploads intentionally do
           * not claim Git history exists.
           */
          expect('historyTouches' in prepared).toBe(false);

          expect(await pathExists(prepared.repositoryDirectory)).toBe(true);
        } finally {
          await prepared.cleanup();
        }

        expect(await pathExists(prepared.repositoryDirectory)).toBe(false);
      });
    });

    it('uses the ZIP SHA-256 as a deterministic identity', async () => {
      await withTempWorkspace(async (workspace) => {
        const archivePath = join(workspace.rootDir, 'repository.zip');

        await createZipArchive(archivePath);

        const expectedSha = await calculateSha256(archivePath);

        const ingestor = new RepoIngestor({
          githubClient: createFakeGitHubClient(),
        });

        const prepared = await ingestor.prepareZipRepository(archivePath);

        try {
          expect(prepared.contentSha256).toBe(expectedSha);

          expect(prepared.sourceKey).toBe(`zip:${expectedSha}`);

          expect(prepared.contentSha256).toMatch(/^[0-9a-f]{64}$/);
        } finally {
          await prepared.cleanup();
        }
      });
    });

    it('produces the same identity for the same ZIP bytes', async () => {
      await withTempWorkspace(async (workspace) => {
        const archivePath = join(workspace.rootDir, 'repository.zip');

        await createZipArchive(archivePath);

        const ingestor = new RepoIngestor({
          githubClient: createFakeGitHubClient(),
        });

        const first = await ingestor.prepareZipRepository(archivePath);

        const second = await ingestor.prepareZipRepository(archivePath);

        try {
          expect(first.contentSha256).toBe(second.contentSha256);

          expect(first.sourceKey).toBe(second.sourceKey);

          expect(first.repositoryDirectory).not.toBe(second.repositoryDirectory);
        } finally {
          await Promise.all([first.cleanup(), second.cleanup()]);
        }
      });
    });

    it('rejects an invalid ZIP archive', async () => {
      await withTempWorkspace(async (workspace) => {
        const archivePath = join(workspace.rootDir, 'invalid.zip');

        await writeFile(archivePath, 'not actually a zip', 'utf8');

        const ingestor = new RepoIngestor({
          githubClient: createFakeGitHubClient(),
        });

        await expect(ingestor.prepareZipRepository(archivePath)).rejects.toMatchObject({
          code: 'BAD_REQUEST',

          statusCode: 400,
        });
      });
    });
  });
});
