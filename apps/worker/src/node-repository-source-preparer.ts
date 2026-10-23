import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AnalysisSource, GitHubAnalysisSource, ZipAnalysisSource } from '@astral-atlas/shared';

import {
  createPreparedGitHubRepository,
  createPreparedZipRepository,
  type AnalysisSourcePreparer,
  type PreparedAnalysisRepository,
} from './repository-source-preparer.js';

export interface WorkerGitCheckoutInput {
  owner: string;

  repo: string;

  commitSha: string;

  destinationDirectory: string;
}

export type WorkerGitCheckout = (input: WorkerGitCheckoutInput) => Promise<void>;

export type WorkerZipExtractor = (
  archivePath: string,
  destinationDirectory: string,
) => Promise<void>;

export interface NodeRepositorySourcePreparerDependencies {
  /*
   * Low-level secure Git implementation.
   *
   * We intentionally inject this instead of importing
   * apps/api/... because worker must not depend on API
   * implementation files.
   */
  checkoutGitHubCommit: WorkerGitCheckout;

  /*
   * Low-level safe ZIP extractor.
   *
   * Its implementation must enforce the same protections
   * already used by ingestion:
   *
   * - ZIP slip protection
   * - symlink rejection
   * - encrypted-entry rejection
   * - duplicate-path rejection
   * - extracted-size limits
   */
  extractZipArchive: WorkerZipExtractor;

  /*
   * Optional override mainly useful for tests.
   */
  workspaceRoot?: string;
}

async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');

  const stream = createReadStream(filePath);

  try {
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } catch (error: unknown) {
    stream.destroy();

    throw new Error(`Unable to read staged ZIP archive "${filePath}"`, {
      cause: error,
    });
  }

  return hash.digest('hex');
}

async function verifyStagedZip(source: ZipAnalysisSource): Promise<void> {
  let archiveStats;

  try {
    archiveStats = await stat(source.archivePath);
  } catch (error: unknown) {
    throw new Error(`Staged ZIP archive "${source.archivePath}" does not exist or cannot be read`, {
      cause: error,
    });
  }

  if (!archiveStats.isFile()) {
    throw new Error(`Staged ZIP archive "${source.archivePath}" is not a regular file`);
  }

  /*
   * Never trust archivePath alone.
   *
   * The API calculated contentSha256 before enqueueing.
   * Recalculate it in the worker so a replaced/corrupted
   * shared-volume file cannot silently analyse different
   * bytes under the same PostgreSQL revision.
   */
  const actualSha256 = await calculateSha256(source.archivePath);

  const expectedSha256 = source.contentSha256.toLowerCase();

  if (actualSha256 !== expectedSha256) {
    throw new Error('Staged ZIP archive SHA-256 does not match the queued analysis revision');
  }
}

export class NodeRepositorySourcePreparer implements AnalysisSourcePreparer {
  private readonly workspaceRoot: string;

  public constructor(private readonly dependencies: NodeRepositorySourcePreparerDependencies) {
    this.workspaceRoot = dependencies.workspaceRoot ?? tmpdir();
  }

  public async prepare(source: AnalysisSource): Promise<PreparedAnalysisRepository> {
    /*
     * Each BullMQ execution gets its own isolated directory.
     *
     * Example:
     *
     * /tmp/astral-atlas-worker-a1b2c3/
     *   repository/
     */
    await mkdir(this.workspaceRoot, {
      recursive: true,

      mode: 0o700,
    });

    const workspaceDirectory = await mkdtemp(join(this.workspaceRoot, 'astral-atlas-worker-'));

    const repositoryDirectory = join(workspaceDirectory, 'repository');

    await mkdir(repositoryDirectory, {
      recursive: true,

      mode: 0o700,
    });

    let cleaned = false;

    const cleanup = async (): Promise<void> => {
      if (cleaned) {
        return;
      }

      cleaned = true;

      await rm(workspaceDirectory, {
        recursive: true,

        force: true,
      });
    };

    try {
      if (source.sourceType === 'github') {
        return await this.prepareGitHub(source, repositoryDirectory, cleanup);
      }

      return await this.prepareZip(source, repositoryDirectory, cleanup);
    } catch (error: unknown) {
      /*
       * Preparation failed before ownership could be
       * handed to the processor.
       *
       * Always remove the temporary checkout/extraction.
       *
       * Do NOT delete source.archivePath here because
       * BullMQ may retry this same ZIP job.
       */
      await cleanup();

      throw error;
    }
  }

  private async prepareGitHub(
    source: GitHubAnalysisSource,
    repositoryDirectory: string,
    cleanup: () => Promise<void>,
  ): Promise<PreparedAnalysisRepository> {
    await this.dependencies.checkoutGitHubCommit({
      owner: source.owner,

      repo: source.repo,

      commitSha: source.commitSha,

      destinationDirectory: repositoryDirectory,
    });

    return createPreparedGitHubRepository(source, repositoryDirectory, cleanup);
  }

  private async prepareZip(
    source: ZipAnalysisSource,
    repositoryDirectory: string,
    cleanup: () => Promise<void>,
  ): Promise<PreparedAnalysisRepository> {
    /*
     * Verify the durable staged artifact before
     * extracting anything from it.
     */
    await verifyStagedZip(source);

    await this.dependencies.extractZipArchive(source.archivePath, repositoryDirectory);

    return createPreparedZipRepository(source, repositoryDirectory, cleanup);
  }
}
