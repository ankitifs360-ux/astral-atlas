import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

import { AppError } from '../../errors.js';
import type { GitHubClient, ResolvedGitHubRepository } from './github-client.js';
import {
  checkoutGitHubCommit,
  readGitHistoryFileTouches,
  type GitCheckoutInput,
  type GitCheckoutResult,
  type GitHistoryFileTouch,
} from './git-runner.js';
import { parseGitHubRepositoryUrl } from './github-url.js';
import { INGESTION_LIMITS } from './limits.js';
import { scanRepositorySourceFiles, type RepositoryScanResult } from './source-files.js';
import { createTempWorkspace, type TempWorkspace } from './temp-workspace.js';
import { extractZipArchive } from './zip-extractor.js';

export interface PreparedGitHubRepository {
  sourceType: 'github';

  owner: string;

  repo: string;

  sourceKey: string;

  canonicalUrl: string;

  defaultBranch: string;

  commitSha: string;

  repositoryDirectory: string;

  scan: RepositoryScanResult;

  /*
   * Bounded Git history gathered from the local
   * shallow checkout.
   *
   * These touches will later be converted into
   * per-file churn metrics by the worker.
   */
  historyTouches: GitHistoryFileTouch[];

  cleanup: () => Promise<void>;
}

export interface PreparedZipRepository {
  sourceType: 'zip';

  /*
   * SHA-256 of the uploaded ZIP bytes.
   *
   * ZIP files do not have Git commit SHAs, so this
   * becomes their deterministic revision identifier.
   */
  contentSha256: string;

  sourceKey: string;

  repositoryDirectory: string;

  scan: RepositoryScanResult;

  cleanup: () => Promise<void>;
}

export type PreparedRepository = PreparedGitHubRepository | PreparedZipRepository;

export type GitCheckoutFunction = (input: GitCheckoutInput) => Promise<GitCheckoutResult>;

export type GitHistoryReaderFunction = (
  repositoryDirectory: string,
) => Promise<GitHistoryFileTouch[]>;

export interface RepoIngestorDependencies {
  githubClient: GitHubClient;

  checkoutGitHubCommit?: GitCheckoutFunction;

  /*
   * Dependency injection keeps repository
   * ingestion unit-testable without requiring
   * real Git history in every test.
   */
  readGitHistoryFileTouches?: GitHistoryReaderFunction;
}

async function calculateFileSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');

  const stream = createReadStream(filePath);

  try {
    for await (const chunk of stream) {
      hash.update(chunk);
    }
  } catch {
    stream.destroy();

    throw new AppError('BAD_REQUEST', 400, 'Uploaded ZIP archive could not be read.');
  }

  return hash.digest('hex');
}

export class RepoIngestor {
  private readonly githubClient: GitHubClient;

  private readonly checkoutGitHubCommit: GitCheckoutFunction;

  private readonly readGitHistoryFileTouches: GitHistoryReaderFunction;

  public constructor(dependencies: RepoIngestorDependencies) {
    this.githubClient = dependencies.githubClient;

    this.checkoutGitHubCommit = dependencies.checkoutGitHubCommit ?? checkoutGitHubCommit;

    this.readGitHistoryFileTouches =
      dependencies.readGitHistoryFileTouches ?? readGitHistoryFileTouches;
  }

  public async prepareGitHubRepository(repositoryUrl: string): Promise<PreparedGitHubRepository> {
    const parsedRepository = parseGitHubRepositoryUrl(repositoryUrl);

    const resolvedRepository = await this.githubClient.resolveRepository(parsedRepository);

    this.validateRepositorySize(resolvedRepository);

    const workspace = await createTempWorkspace();

    try {
      await this.checkoutGitHubCommit({
        owner: resolvedRepository.owner,

        repo: resolvedRepository.repo,

        commitSha: resolvedRepository.commitSha,

        destinationDirectory: workspace.repositoryDir,
      });

      /*
       * Read only the history already available in
       * the bounded local checkout.
       *
       * No second clone or network request occurs.
       */
      const historyTouches = await this.readGitHistoryFileTouches(workspace.repositoryDir);

      const scan = await scanRepositorySourceFiles(workspace.repositoryDir);

      return this.createPreparedGitHubRepository(
        resolvedRepository,
        workspace,
        scan,
        historyTouches,
      );
    } catch (error: unknown) {
      await workspace.cleanup();

      throw error;
    }
  }

  public async prepareZipRepository(archivePath: string): Promise<PreparedZipRepository> {
    const workspace = await createTempWorkspace();

    try {
      /*
       * extractZipArchive performs the important
       * safety checks:
       *
       * - archive size
       * - ZIP-slip/path traversal
       * - symlinks
       * - encrypted entries
       * - duplicate paths
       * - expanded-size limits
       */
      await extractZipArchive(archivePath, workspace.repositoryDir);

      const contentSha256 = await calculateFileSha256(archivePath);

      const scan = await scanRepositorySourceFiles(workspace.repositoryDir);

      return {
        sourceType: 'zip',

        contentSha256,

        sourceKey: `zip:${contentSha256}`,

        repositoryDirectory: workspace.repositoryDir,

        scan,

        cleanup: workspace.cleanup,
      };
    } catch (error: unknown) {
      await workspace.cleanup();

      throw error;
    }
  }

  private validateRepositorySize(repository: ResolvedGitHubRepository): void {
    const maxRepositorySizeKb = Math.floor(INGESTION_LIMITS.maxExtractedBytes / 1024);

    if (repository.repositorySizeKb > maxRepositorySizeKb) {
      throw new AppError(
        'PAYLOAD_TOO_LARGE',
        413,
        `GitHub repository exceeds the ${Math.floor(
          INGESTION_LIMITS.maxExtractedBytes / (1024 * 1024),
        )} MiB repository limit.`,
        [
          {
            field: 'repositoryUrl',

            message: 'Repository is too large to analyse safely.',
          },
        ],
      );
    }
  }

  private createPreparedGitHubRepository(
    repository: ResolvedGitHubRepository,

    workspace: TempWorkspace,

    scan: RepositoryScanResult,

    historyTouches: GitHistoryFileTouch[],
  ): PreparedGitHubRepository {
    return {
      sourceType: 'github',

      owner: repository.owner,

      repo: repository.repo,

      sourceKey: repository.sourceKey,

      canonicalUrl: repository.canonicalUrl,

      defaultBranch: repository.defaultBranch,

      commitSha: repository.commitSha,

      repositoryDirectory: workspace.repositoryDir,

      scan,

      historyTouches,

      cleanup: workspace.cleanup,
    };
  }
}
