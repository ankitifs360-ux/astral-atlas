import { analyses, eq } from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import { persistGraphEdges } from './edge-persistence.js';
import { persistAnalysisFindings } from './finding-persistence.js';
import { persistFilesAndMetrics } from './file-metrics-persistence.js';
import { persistFunctionCallEdges } from './function-call-edge-persistence.js';
import { persistGoodFirstTaskRecommendations } from './good-first-task-persistence.js';
import { persistNewcomerChangeGuidanceRecommendations } from './newcomer-change-guidance-persistence.js';
import { persistAnalysisResult } from './result-persistence.js';
import { persistAnalysisSymbols } from './symbol-persistence.js';

import type { PersistCompletedAnalysisInput } from './types.js';

export interface PersistCompletedAnalysisResult {
  analysisId: string;

  persistedFileCount: number;

  persistedSymbolCount: number;

  persistedEdgeCount: number;

  persistedFindingCount: number;

  persistedOnboardingStepCount: number;

  alreadyCompleted: boolean;
}

function validateAnalysisId(analysisId: string): void {
  if (analysisId.trim().length === 0) {
    throw new Error('analysisId cannot be empty');
  }
}

export async function persistCompletedAnalysis(
  database: Database,
  input: PersistCompletedAnalysisInput,
): Promise<PersistCompletedAnalysisResult> {
  validateAnalysisId(input.analysisId);

  return database.transaction(async (transaction) => {
    /*
     * ---------------------------------------------------------------
     * 1. Verify that the analysis exists.
     * ---------------------------------------------------------------
     *
     * We also read its current status so completed analyses can be
     * treated as idempotent successes.
     */
    const analysisRows = await transaction
      .select({
        id: analyses.id,

        status: analyses.status,
      })
      .from(analyses)
      .where(eq(analyses.id, input.analysisId))
      .limit(1);

    const analysis = analysisRows[0];

    if (analysis === undefined) {
      throw new Error(`Analysis "${input.analysisId}" does not exist`);
    }

    /*
     * A retry can reach persistence after an earlier attempt already
     * committed successfully.
     *
     * In that case do not write duplicate rows. Treat the operation as
     * successful and report that nothing new was persisted.
     */
    if (analysis.status === 'completed') {
      return {
        analysisId: input.analysisId,

        persistedFileCount: 0,

        persistedSymbolCount: 0,

        persistedEdgeCount: 0,

        persistedFindingCount: 0,

        persistedOnboardingStepCount: 0,

        alreadyCompleted: true,
      };
    }

    /*
     * ---------------------------------------------------------------
     * 2. Files + metrics
     * ---------------------------------------------------------------
     *
     * Files must be persisted first because every later stage refers
     * to them through database file IDs.
     */
    const fileIdByPath = await persistFilesAndMetrics(transaction, input);

    /*
     * ---------------------------------------------------------------
     * 3. Symbols
     * ---------------------------------------------------------------
     *
     * Symbols reference persisted files, so this stage must run after
     * file persistence and inside the same transaction.
     *
     * The returned map connects deterministic symbol identities to
     * their PostgreSQL UUIDs. Function-call edges need those IDs.
     */
    const symbolIdByKey = await persistAnalysisSymbols(transaction, input.symbols, fileIdByPath);

    /*
     * ---------------------------------------------------------------
     * 4. File-level import graph edges
     * ---------------------------------------------------------------
     *
     * persistGraphEdges() collapses repeated imports between the same
     * two files into one database row with a larger weight.
     */
    const persistedImportEdgeCount = await persistGraphEdges(
      transaction,
      input.analysisId,
      input.graphAnalysis,
      fileIdByPath,
    );

    /*
     * ---------------------------------------------------------------
     * 5. Function-level call graph edges
     * ---------------------------------------------------------------
     *
     * Only repository-internal calls whose source and target functions
     * have persisted symbol identities become database call edges.
     *
     * Existing persistence callers that do not yet provide B15 call
     * resolution data safely behave as if there were zero calls.
     */
    const persistedCallEdgeCount = await persistFunctionCallEdges(
      transaction,
      input.analysisId,
      input.resolvedCalls ?? [],
      fileIdByPath,
      symbolIdByKey,
    );

    const persistedEdgeCount = persistedImportEdgeCount + persistedCallEdgeCount;

    /*
     * ---------------------------------------------------------------
     * 6. Findings
     * ---------------------------------------------------------------
     */
    await persistAnalysisFindings(transaction, input.analysisId, input.findings, fileIdByPath);

    /*
     * ---------------------------------------------------------------
     * 7. Repository-level result + onboarding
     * ---------------------------------------------------------------
     */
    await persistAnalysisResult(
      transaction,
      input.analysisId,
      input.metrics.summary,
      input.healthScore,
      input.onboarding,
      input.goodFirstTasks,
      fileIdByPath,
      input.newcomerChangeGuidance,
    );

    /*
     * ---------------------------------------------------------------
     * 8. Good-first-task recommendations
     * ---------------------------------------------------------------
     *
     * The aggregate B15.5 metadata lives in analysis_results while
     * the ranked file recommendations live in their dedicated table.
     *
     * This remains inside the same PostgreSQL transaction so a failed
     * recommendation write cannot leave a partially completed result.
     */
    await persistGoodFirstTaskRecommendations(
      transaction,
      input.analysisId,
      input.goodFirstTasks,
      fileIdByPath,
    );

    /*
     * ---------------------------------------------------------------
     * 9. Newcomer change guidance recommendations
     * ---------------------------------------------------------------
     *
     * B15.6 aggregate metadata lives in analysis_results while
     * ranked blast-radius-aware guidance lives in its dedicated table.
     *
     * This remains inside the same PostgreSQL transaction so a failed
     * guidance write cannot leave a partially completed result.
     */
    if (input.newcomerChangeGuidance !== undefined) {
      await persistNewcomerChangeGuidanceRecommendations(
        transaction,
        input.analysisId,
        input.newcomerChangeGuidance,
        fileIdByPath,
      );
    }

    /*
     * ---------------------------------------------------------------
     * 10. Mark the analysis completed LAST.
     * ---------------------------------------------------------------
     *
     * This is deliberately the final database write.
     *
     * If any earlier persistence stage fails, PostgreSQL rolls back
     * the entire transaction and the analysis never becomes visible
     * as a completed architecture map.
     */
    const completedRows = await transaction
      .update(analyses)
      .set({
        status: 'completed',

        fileCount: input.files.length,

        errorCode: null,

        errorMessage: null,

        completedAt: new Date(),
      })
      .where(eq(analyses.id, input.analysisId))
      .returning({
        id: analyses.id,
      });

    if (completedRows.length !== 1) {
      throw new Error(
        `Expected to mark one analysis completed but PostgreSQL updated ${completedRows.length}`,
      );
    }

    return {
      analysisId: input.analysisId,

      persistedFileCount: input.files.length,

      persistedSymbolCount: input.symbols.length,

      /*
       * This now includes both:
       *
       * - file-level import edges
       * - function-level call edges
       */
      persistedEdgeCount,

      persistedFindingCount: input.findings.length,

      persistedOnboardingStepCount: input.onboarding.steps.length,

      alreadyCompleted: false,
    };
  });
}
