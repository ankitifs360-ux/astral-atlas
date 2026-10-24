import {
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
  type GitHubAnalysisSource,
  type ZipAnalysisSource,
} from '@astral-atlas/shared';

import { enqueueAnalysisJob, requeueAnalysisJob } from '../../queues/enqueue-analysis.js';

import type { AnalysisQueue } from '../../queues/analysis-queue.js';

import type {
  AnalysisSubmissionRecord,
  AnalysisSubmissionStore,
} from './analysis-submission-store.js';

export interface GitHubSubmissionInput {
  owner: string;
  repo: string;
  canonicalUrl: string;
  sourceKey: string;
  defaultBranch: string;
  commitSha: string;
}

export interface ZipSubmissionInput {
  sourceKey: string;
  contentSha256: string;
  archivePath: string;
}

export interface AnalysisSubmissionResult {
  analysisId: string;
  repositoryId: string;
  status: 'queued' | 'running' | 'completed';
  state: AnalysisSubmissionRecord['state'];
  cacheHit: boolean;
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

function normalizeGitHubInput(input: GitHubSubmissionInput): GitHubSubmissionInput {
  return {
    owner: requireNonEmpty(input.owner, 'owner'),

    repo: requireNonEmpty(input.repo, 'repo'),

    canonicalUrl: requireNonEmpty(input.canonicalUrl, 'canonicalUrl'),

    sourceKey: requireNonEmpty(input.sourceKey, 'sourceKey'),

    defaultBranch: requireNonEmpty(input.defaultBranch, 'defaultBranch'),

    commitSha: requireNonEmpty(input.commitSha, 'commitSha').toLowerCase(),
  };
}

function normalizeZipInput(input: ZipSubmissionInput): ZipSubmissionInput {
  return {
    sourceKey: requireNonEmpty(input.sourceKey, 'sourceKey'),

    contentSha256: requireNonEmpty(input.contentSha256, 'contentSha256').toLowerCase(),

    archivePath: requireNonEmpty(input.archivePath, 'archivePath'),
  };
}

export class AnalysisSubmissionService {
  public constructor(
    private readonly store: AnalysisSubmissionStore,
    private readonly queue: AnalysisQueue,
  ) {}

  public async submitGitHub(input: GitHubSubmissionInput): Promise<AnalysisSubmissionResult> {
    const normalized = normalizeGitHubInput(input);

    const record = await this.store.prepareSubmission({
      sourceType: 'github',

      sourceKey: normalized.sourceKey,

      revision: normalized.commitSha,

      githubOwner: normalized.owner,

      githubName: normalized.repo,

      canonicalUrl: normalized.canonicalUrl,

      defaultBranch: normalized.defaultBranch,
    });

    const source: GitHubAnalysisSource = {
      sourceType: 'github',

      owner: normalized.owner,

      repo: normalized.repo,

      canonicalUrl: normalized.canonicalUrl,

      sourceKey: normalized.sourceKey,

      commitSha: normalized.commitSha,
    };

    await this.handleQueue(record, source);

    return this.mapResult(record);
  }

  public async submitZip(input: ZipSubmissionInput): Promise<AnalysisSubmissionResult> {
    const normalized = normalizeZipInput(input);

    const record = await this.store.prepareSubmission({
      sourceType: 'zip',

      sourceKey: normalized.sourceKey,

      revision: normalized.contentSha256,
    });

    const source: ZipAnalysisSource = {
      sourceType: 'zip',

      sourceKey: normalized.sourceKey,

      contentSha256: normalized.contentSha256,

      archivePath: normalized.archivePath,
    };

    await this.handleQueue(record, source);

    return this.mapResult(record);
  }

  private async handleQueue(
    record: AnalysisSubmissionRecord,
    source: GitHubAnalysisSource | ZipAnalysisSource,
  ): Promise<void> {
    /*
     * Completed PostgreSQL result already exists.
     *
     * No queue work is needed.
     */
    if (record.state === 'cached') {
      return;
    }

    const data: AnalysisJobData = {
      schemaVersion: ANALYSIS_JOB_SCHEMA_VERSION,

      analysisId: record.analysisId,

      repositoryId: record.repositoryId,

      source,
    };

    /*
     * PostgreSQL explicitly reset a failed/partial
     * analysis back to queued.
     *
     * requeueAnalysisJob() safely removes an old
     * terminal BullMQ job before adding the fresh one.
     */
    if (record.state === 'requeued') {
      await requeueAnalysisJob(this.queue, data);

      return;
    }

    /*
     * Brand-new PostgreSQL analysis.
     */
    if (record.state === 'created') {
      await enqueueAnalysisJob(this.queue, data);

      return;
    }

    /*
     * At this point state === "existing".
     *
     * If PostgreSQL says running, a worker already
     * owns the analysis. Never enqueue another copy.
     */
    if (record.status === 'running') {
      return;
    }

    /*
     * PostgreSQL says:
     *
     *   state  = existing
     *   status = queued
     *
     * We now reconcile PostgreSQL with BullMQ.
     *
     * This matters because Redis and PostgreSQL do
     * not share one distributed transaction.
     */
    const existingJob = await this.queue.getJob(record.analysisId);

    /*
     * Case 1:
     *
     * PostgreSQL row exists but queue.add() previously
     * failed or the Redis job disappeared.
     *
     * Recreate the missing job.
     */
    if (existingJob === undefined) {
      await enqueueAnalysisJob(this.queue, data);

      return;
    }

    const queueState = await existingJob.getState();

    /*
     * Case 2:
     *
     * PostgreSQL still says queued, but BullMQ contains
     * a retained terminal job with the same stable ID.
     *
     * BullMQ will not accept a new job with that ID
     * while the terminal job remains.
     *
     * Remove the old terminal job and enqueue fresh data.
     */
    if (queueState === 'completed' || queueState === 'failed') {
      await requeueAnalysisJob(this.queue, data);

      return;
    }

    /*
     * Case 3:
     *
     * BullMQ already has a non-terminal job:
     *
     * waiting
     * active
     * delayed
     * prioritized
     * waiting-children
     * etc.
     *
     * That job is still live, so reuse it.
     */
  }

  private mapResult(record: AnalysisSubmissionRecord): AnalysisSubmissionResult {
    return {
      analysisId: record.analysisId,

      repositoryId: record.repositoryId,

      status: record.status,

      state: record.state,

      cacheHit: record.state === 'cached',
    };
  }
}
