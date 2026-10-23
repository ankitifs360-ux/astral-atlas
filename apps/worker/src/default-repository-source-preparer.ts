import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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

export interface WorkerZipExtractionInput {
  archivePath: string;

  destinationDirectory: string;
}

export type WorkerGitCheckoutFunction = (input: WorkerGitCheckoutInput) => Promise<void>;

export type WorkerZipExtractionFunction = (input: WorkerZipExtractionInput) => Promise<void>;

export interface DefaultRepositorySourcePreparerDependencies {
  checkoutGitHubCommit: WorkerGitCheckoutFunction;

  extractZipArchive: WorkerZipExtractionFunction;

  /**
   * Mainly useful for tests.
   *
   * Production defaults to the OS temporary directory.
   */
  temporaryRootDirectory?: string;
}

interface TemporaryRepositoryWorkspace {
  rootDirectory: string;

  repositoryDirectory: string;

  cleanup: () => Promise<void>;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

async function createTemporaryRepositoryWorkspace(
  temporaryRootDirectory: string,
): Promise<TemporaryRepositoryWorkspace> {
  const rootDirectory = await mkdtemp(join(temporaryRootDirectory, 'astral-atlas-worker-'));

  const repositoryDirectory = join(rootDirectory, 'repository');

  await mkdir(repositoryDirectory, {
    recursive: false,

    mode: 0o700,
  });

  let cleaned = false;

  const cleanup = async (): Promise<void> => {
    /*
     * Cleanup can be called from both:
     *
     * - preparation failure handling
     * - analysis processor finally blocks
     *
     * Making it idempotent prevents double-cleanup issues.
     */
    if (cleaned) {
      return;
    }

    cleaned = true;

    await rm(rootDirectory, {
      recursive: true,

      force: true,
    });
  };

  return {
    rootDirectory,

    repositoryDirectory,

    cleanup,
  };
}

export class DefaultRepositorySourcePreparer implements AnalysisSourcePreparer {
  private readonly checkoutGitHubCommit: WorkerGitCheckoutFunction;

  private readonly extractZipArchive: WorkerZipExtractionFunction;

  private readonly temporaryRootDirectory: string;

  public constructor(dependencies: DefaultRepositorySourcePreparerDependencies) {
    this.checkoutGitHubCommit = dependencies.checkoutGitHubCommit;

    this.extractZipArchive = dependencies.extractZipArchive;

    this.temporaryRootDirectory = dependencies.temporaryRootDirectory ?? tmpdir();
  }

  public async prepare(source: AnalysisSource): Promise<PreparedAnalysisRepository> {
    if (source.sourceType === 'github') {
      return this.prepareGitHub(source);
    }

    return this.prepareZip(source);
  }

  private async prepareGitHub(source: GitHubAnalysisSource): Promise<PreparedAnalysisRepository> {
    const owner = requireNonEmpty(source.owner, 'GitHub owner');

    const repo = requireNonEmpty(source.repo, 'GitHub repository');

    const commitSha = requireNonEmpty(source.commitSha, 'GitHub commit SHA').toLowerCase();

    const workspace = await createTemporaryRepositoryWorkspace(this.temporaryRootDirectory);

    try {
      /*
       * Important:
       *
       * The API only resolved the immutable SHA.
       *
       * The expensive network checkout happens here
       * inside the BullMQ worker.
       */
      await this.checkoutGitHubCommit({
        owner,

        repo,

        commitSha,

        destinationDirectory: workspace.repositoryDirectory,
      });

      return createPreparedGitHubRepository(
        {
          ...source,

          owner,

          repo,

          commitSha,
        },

        workspace.repositoryDirectory,

        workspace.cleanup,
      );
    } catch (error: unknown) {
      /*
       * Never leave a half-downloaded repository
       * behind after checkout failure.
       */
      await workspace.cleanup();

      throw error;
    }
  }

  private async prepareZip(source: ZipAnalysisSource): Promise<PreparedAnalysisRepository> {
    const archivePath = requireNonEmpty(source.archivePath, 'ZIP archive path');

    const contentSha256 = requireNonEmpty(
      source.contentSha256,
      'ZIP content SHA-256',
    ).toLowerCase();

    const workspace = await createTemporaryRepositoryWorkspace(this.temporaryRootDirectory);

    try {
      /*
       * The archive was staged by the API into shared
       * storage.
       *
       * Safe extraction happens only in the worker.
       */
      await this.extractZipArchive({
        archivePath,

        destinationDirectory: workspace.repositoryDirectory,
      });

      return createPreparedZipRepository(
        {
          ...source,

          archivePath,

          contentSha256,
        },

        workspace.repositoryDirectory,

        workspace.cleanup,
      );
    } catch (error: unknown) {
      /*
       * Remove partially extracted files.
       *
       * Do NOT delete archivePath here.
       *
       * BullMQ may retry the job, so the staged ZIP
       * must remain available until terminal handling.
       */
      await workspace.cleanup();

      throw error;
    }
  }
}
