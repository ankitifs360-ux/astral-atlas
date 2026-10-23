import type { Database } from '@astral-atlas/database';
import type { FastifyInstance } from 'fastify';

import type { GitHubClient } from '../ingestion/github-client.js';

import type { AnalysisQueue } from '../../queues/analysis-queue.js';

import { registerAnalysisSubmissionRoutes } from '../../routes/analysis-submission.js';

import { AnalysisSubmissionService } from './analysis-submission-service.js';
import { AnalysisSubmissionStore } from './analysis-submission-store.js';

export interface RegisterAnalysisSubmissionModuleOptions {
  app: FastifyInstance;

  database: Database;

  analysisQueue: AnalysisQueue;

  githubClient: GitHubClient;

  /**
   * Directory visible to both:
   *
   * - API process
   * - worker process
   *
   * In Docker this will become a shared mounted volume.
   */
  zipStagingDirectory: string;
}

/**
 * Composition boundary for repository submission.
 *
 * The Fastify route does not know how PostgreSQL or BullMQ work.
 *
 * Flow:
 *
 * route
 *   -> AnalysisSubmissionService
 *   -> AnalysisSubmissionStore + BullMQ
 */
export function registerAnalysisSubmissionModule({
  app,
  database,
  analysisQueue,
  githubClient,
  zipStagingDirectory,
}: RegisterAnalysisSubmissionModuleOptions): void {
  const store = new AnalysisSubmissionStore(database);

  const service = new AnalysisSubmissionService(store, analysisQueue);

  registerAnalysisSubmissionRoutes(app, {
    submissionService: service,

    githubClient,

    zipStagingDirectory,
  });
}
