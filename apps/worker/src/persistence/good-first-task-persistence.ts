import { goodFirstTaskRecommendations } from '@astral-atlas/database';

import type { GoodFirstTaskResult } from '../onboarding/good-first-task-types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

function requireFileId(
  fileIdByPath: FileIdByPath,

  filePath: string,
): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(
      `Good-first-task recommendation references unknown persisted file "${filePath}"`,
    );
  }

  return fileId;
}

function validateGoodFirstTasks(
  result: GoodFirstTaskResult,

  fileIdByPath: FileIdByPath,
): void {
  if (!Number.isInteger(result.consideredFileCount) || result.consideredFileCount < 0) {
    throw new Error('goodFirstTasks.consideredFileCount must be a non-negative integer');
  }

  if (!Number.isInteger(result.maxRecommendations) || result.maxRecommendations < 1) {
    throw new Error('goodFirstTasks.maxRecommendations must be a positive integer');
  }

  if (result.recommendations.length > result.maxRecommendations) {
    throw new Error('Good-first-task result contains more recommendations than maxRecommendations');
  }

  if (result.recommendations.length > result.consideredFileCount) {
    throw new Error('Good-first-task recommendations cannot exceed consideredFileCount');
  }

  const seenFilePaths = new Set<string>();

  for (const recommendation of result.recommendations) {
    if (seenFilePaths.has(recommendation.filePath)) {
      throw new Error(`Duplicate good-first-task file path "${recommendation.filePath}"`);
    }

    seenFilePaths.add(recommendation.filePath);

    requireFileId(fileIdByPath, recommendation.filePath);

    if (
      !Number.isInteger(recommendation.score) ||
      recommendation.score < 0 ||
      recommendation.score > 100
    ) {
      throw new Error(
        `Good-first-task score for "${recommendation.filePath}" must be an integer between 0 and 100`,
      );
    }

    if (
      !Number.isInteger(recommendation.architectureRiskScore) ||
      recommendation.architectureRiskScore < 0 ||
      recommendation.architectureRiskScore > 100
    ) {
      throw new Error(
        `Architecture risk score for "${recommendation.filePath}" must be an integer between 0 and 100`,
      );
    }

    for (const signal of recommendation.signals) {
      if (!Number.isInteger(signal.points) || signal.points < 0) {
        throw new Error(
          `Good-first-task signal points for "${recommendation.filePath}" must be a non-negative integer`,
        );
      }
    }
  }
}

export async function persistGoodFirstTaskRecommendations(
  transaction: DatabaseTransaction,

  analysisId: string,

  result: GoodFirstTaskResult,

  fileIdByPath: FileIdByPath,
): Promise<number> {
  validateGoodFirstTasks(result, fileIdByPath);

  if (result.recommendations.length === 0) {
    return 0;
  }

  const rows = result.recommendations.map((recommendation, index) => ({
    analysisId,

    recommendationRank: index + 1,

    fileId: requireFileId(fileIdByPath, recommendation.filePath),

    score: recommendation.score,

    architectureRiskScore: recommendation.architectureRiskScore,

    signals: recommendation.signals,
  }));

  await transaction.insert(goodFirstTaskRecommendations).values(rows);

  return rows.length;
}
