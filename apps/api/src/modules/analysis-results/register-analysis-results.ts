import type { Database } from '@astral-atlas/database';
import type { FastifyInstance } from 'fastify';

import { registerAnalysisResultsRoutes } from '../../routes/analysis-results.js';
import { registerAnalysisSearchRoute } from '../../routes/analysis-search.js';
import { AnalysisResultsStore } from './analysis-results-store.js';
import { AnalysisSearchStore } from './analysis-search-store.js';

export interface RegisterAnalysisResultsModuleOptions {
  app: FastifyInstance;
  database: Database;
}

/**
 * Registers the completed-analysis read API.
 *
 * This is intentionally the composition boundary between Fastify
 * and PostgreSQL:
 *
 * - routes know only reader interfaces
 * - stores know only the database
 * - app.ts only has to register this module once
 *
 * Keeping construction here also prevents the API from importing
 * persistence/read classes from apps/worker.
 */
export function registerAnalysisResultsModule({
  app,
  database,
}: RegisterAnalysisResultsModuleOptions): void {
  const resultsStore = new AnalysisResultsStore(database);
  const searchStore = new AnalysisSearchStore(database);

  registerAnalysisResultsRoutes(app, resultsStore);
  registerAnalysisSearchRoute(app, searchStore);
}
