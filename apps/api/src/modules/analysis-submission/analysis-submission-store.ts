import { analyses, and, eq, repositories } from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

export type AnalysisSubmissionSource =
  | {
      sourceType: 'github';
      sourceKey: string;
      revision: string;
      githubOwner: string;
      githubName: string;
      canonicalUrl: string;
      defaultBranch: string;
    }
  | {
      sourceType: 'zip';
      sourceKey: string;
      revision: string;
    };

export type AnalysisSubmissionState = 'cached' | 'existing' | 'created' | 'requeued';

export interface AnalysisSubmissionRecord {
  repositoryId: string;
  analysisId: string;
  state: AnalysisSubmissionState;
  status: 'queued' | 'running' | 'completed';
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }

  return normalized;
}

function normalizeSource(source: AnalysisSubmissionSource): AnalysisSubmissionSource {
  const sourceKey = requireNonEmpty(source.sourceKey, 'sourceKey');

  const revision = requireNonEmpty(source.revision, 'revision');

  if (source.sourceType === 'zip') {
    return {
      sourceType: 'zip',
      sourceKey,
      revision,
    };
  }

  return {
    sourceType: 'github',

    sourceKey,

    revision,

    githubOwner: requireNonEmpty(source.githubOwner, 'githubOwner'),

    githubName: requireNonEmpty(source.githubName, 'githubName'),

    canonicalUrl: requireNonEmpty(source.canonicalUrl, 'canonicalUrl'),

    defaultBranch: requireNonEmpty(source.defaultBranch, 'defaultBranch'),
  };
}

export class AnalysisSubmissionStore {
  public constructor(private readonly database: Database) {}

  public async prepareSubmission(
    source: AnalysisSubmissionSource,
  ): Promise<AnalysisSubmissionRecord> {
    const normalized = normalizeSource(source);

    return this.database.transaction(async (transaction) => {
      /*
       * -----------------------------------------------------------
       * 1. Create or refresh repository identity.
       * -----------------------------------------------------------
       *
       * sourceKey is globally unique:
       *
       *   github:owner/name
       *   zip:<sha256>
       */
      const repositoryValues =
        normalized.sourceType === 'github'
          ? {
              sourceType: 'github' as const,

              sourceKey: normalized.sourceKey,

              githubOwner: normalized.githubOwner,

              githubName: normalized.githubName,

              canonicalUrl: normalized.canonicalUrl,

              defaultBranch: normalized.defaultBranch,
            }
          : {
              sourceType: 'zip' as const,

              sourceKey: normalized.sourceKey,

              githubOwner: null,

              githubName: null,

              canonicalUrl: null,

              defaultBranch: null,
            };

      const repositoryRows = await transaction
        .insert(repositories)
        .values(repositoryValues)
        .onConflictDoUpdate({
          target: repositories.sourceKey,

          set:
            normalized.sourceType === 'github'
              ? {
                  githubOwner: normalized.githubOwner,

                  githubName: normalized.githubName,

                  canonicalUrl: normalized.canonicalUrl,

                  defaultBranch: normalized.defaultBranch,

                  updatedAt: new Date(),
                }
              : {
                  updatedAt: new Date(),
                },
        })
        .returning({
          id: repositories.id,
        });

      const repository = repositoryRows[0];

      if (repository === undefined) {
        throw new Error('Failed to create or load repository record');
      }

      /*
       * -----------------------------------------------------------
       * 2. Atomically try to claim this exact revision.
       * -----------------------------------------------------------
       *
       * analyses has a unique constraint on:
       *
       *   repository_id + commit_sha
       *
       * Previously we did:
       *
       *   SELECT existing
       *   then
       *   INSERT
       *
       * Two requests could both SELECT "nothing" and then
       * race to INSERT the same revision.
       *
       * Instead PostgreSQL now decides who wins:
       *
       *   INSERT ... ON CONFLICT DO NOTHING
       *
       * Exactly one concurrent request can create the row.
       * Everyone else gets an empty returning result and
       * then loads the already-existing analysis below.
       */
      const createdRows = await transaction
        .insert(analyses)
        .values({
          repositoryId: repository.id,

          commitSha: normalized.revision,

          status: 'queued',
        })
        .onConflictDoNothing({
          target: [analyses.repositoryId, analyses.commitSha],
        })
        .returning({
          id: analyses.id,
        });

      const created = createdRows[0];

      if (created !== undefined) {
        return {
          repositoryId: repository.id,

          analysisId: created.id,

          state: 'created',

          status: 'queued',
        };
      }

      /*
       * -----------------------------------------------------------
       * 3. Conflict means this revision already exists.
       * -----------------------------------------------------------
       *
       * PostgreSQL protects us from the concurrent insert race,
       * so we can now safely inspect the durable existing row.
       */
      const existingRows = await transaction
        .select({
          id: analyses.id,

          status: analyses.status,
        })
        .from(analyses)
        .where(
          and(
            eq(analyses.repositoryId, repository.id),

            eq(analyses.commitSha, normalized.revision),
          ),
        )
        .limit(1);

      const existing = existingRows[0];

      if (existing === undefined) {
        throw new Error('Analysis conflict occurred but the existing analysis could not be loaded');
      }

      /*
       * Completed means this is a persistent cache hit.
       *
       * No BullMQ job should be created.
       */
      if (existing.status === 'completed') {
        return {
          repositoryId: repository.id,

          analysisId: existing.id,

          state: 'cached',

          status: 'completed',
        };
      }

      /*
       * queued/running means another caller already owns
       * this exact analysis.
       *
       * Return the SAME analysis ID so every browser can
       * subscribe to the same job/SSE stream.
       */
      if (existing.status === 'queued' || existing.status === 'running') {
        return {
          repositoryId: repository.id,

          analysisId: existing.id,

          state: 'existing',

          status: existing.status,
        };
      }

      /*
       * -----------------------------------------------------------
       * 4. Retry a failed/partial analysis.
       * -----------------------------------------------------------
       *
       * We reuse the same analysis row because the schema
       * intentionally allows only one row per repository revision.
       *
       * Important concurrency detail:
       *
       * Include the status we observed in the UPDATE condition.
       *
       * If two callers simultaneously see "failed", only one can
       * change:
       *
       *   failed -> queued
       *
       * The other caller's conditional UPDATE returns zero rows.
       * That caller then reloads the current state and reuses it
       * instead of also claiming that it performed the retry.
       */
      const requeuedRows = await transaction
        .update(analyses)
        .set({
          status: 'queued',

          errorCode: null,

          errorMessage: null,

          warningCount: 0,

          fileCount: 0,

          startedAt: null,

          completedAt: null,
        })
        .where(
          and(
            eq(analyses.id, existing.id),

            eq(analyses.status, existing.status),
          ),
        )
        .returning({
          id: analyses.id,
        });

      if (requeuedRows[0] !== undefined) {
        return {
          repositoryId: repository.id,

          analysisId: existing.id,

          state: 'requeued',

          status: 'queued',
        };
      }

      /*
       * Another concurrent submission changed the state
       * before our conditional retry UPDATE could claim it.
       *
       * Reload the row and reuse the winner's state.
       */
      const currentRows = await transaction
        .select({
          id: analyses.id,

          status: analyses.status,
        })
        .from(analyses)
        .where(eq(analyses.id, existing.id))
        .limit(1);

      const current = currentRows[0];

      if (current === undefined) {
        throw new Error(`Analysis "${existing.id}" disappeared while preparing retry`);
      }

      if (current.status === 'completed') {
        return {
          repositoryId: repository.id,

          analysisId: current.id,

          state: 'cached',

          status: 'completed',
        };
      }

      if (current.status === 'queued' || current.status === 'running') {
        return {
          repositoryId: repository.id,

          analysisId: current.id,

          state: 'existing',

          status: current.status,
        };
      }

      /*
       * A failed/partial status here would mean another
       * actor changed the retry state in an unexpected way.
       *
       * Do not incorrectly enqueue another job.
       */
      throw new Error(
        `Analysis "${current.id}" remained "${current.status}" after a concurrent retry attempt`,
      );
    });
  }
}
