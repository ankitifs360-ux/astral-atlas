import { newcomerChangeGuidanceRecommendations } from '@astral-atlas/database';

import type { NewcomerChangeGuidanceResult } from '../onboarding/newcomer-change-guidance-types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

function requireFileId(
  fileIdByPath: FileIdByPath,

  filePath: string,
): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Newcomer change guidance references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function validateNewcomerChangeGuidance(
  result: NewcomerChangeGuidanceResult,

  fileIdByPath: FileIdByPath,
): void {
  if (!Number.isInteger(result.consideredFileCount) || result.consideredFileCount < 0) {
    throw new Error('newcomerChangeGuidance.consideredFileCount must be a non-negative integer');
  }

  if (!Number.isInteger(result.maxRecommendations) || result.maxRecommendations < 1) {
    throw new Error('newcomerChangeGuidance.maxRecommendations must be a positive integer');
  }

  if (result.recommendations.length > result.maxRecommendations) {
    throw new Error(
      'Newcomer change guidance contains more recommendations than maxRecommendations',
    );
  }

  if (result.recommendations.length > result.consideredFileCount) {
    throw new Error('Newcomer change guidance recommendations cannot exceed consideredFileCount');
  }

  const seenRecommendationFilePaths = new Set<string>();

  for (const recommendation of result.recommendations) {
    if (seenRecommendationFilePaths.has(recommendation.filePath)) {
      throw new Error(`Duplicate newcomer change guidance file path "${recommendation.filePath}"`);
    }

    seenRecommendationFilePaths.add(recommendation.filePath);

    requireFileId(fileIdByPath, recommendation.filePath);

    if (
      !Number.isInteger(recommendation.safetyScore) ||
      recommendation.safetyScore < 0 ||
      recommendation.safetyScore > 100
    ) {
      throw new Error(
        `Newcomer change safety score for "${recommendation.filePath}" must be an integer between 0 and 100`,
      );
    }

    if (!['low', 'medium', 'high'].includes(recommendation.riskLevel)) {
      throw new Error(
        `Newcomer change risk level for "${recommendation.filePath}" must be low, medium or high`,
      );
    }

    if (!Number.isInteger(recommendation.blastRadius) || recommendation.blastRadius < 0) {
      throw new Error(
        `Newcomer change blast radius for "${recommendation.filePath}" must be a non-negative integer`,
      );
    }

    if (!Number.isInteger(recommendation.blastMaxDistance) || recommendation.blastMaxDistance < 0) {
      throw new Error(
        `Newcomer change blast max distance for "${recommendation.filePath}" must be a non-negative integer`,
      );
    }

    const seenReviewFilePaths = new Set<string>();

    for (const reviewFilePath of recommendation.reviewFilePaths) {
      if (reviewFilePath === recommendation.filePath) {
        throw new Error(
          `Newcomer change guidance for "${recommendation.filePath}" cannot review itself`,
        );
      }

      if (seenReviewFilePaths.has(reviewFilePath)) {
        throw new Error(
          `Duplicate review file path "${reviewFilePath}" for newcomer change guidance "${recommendation.filePath}"`,
        );
      }

      seenReviewFilePaths.add(reviewFilePath);

      requireFileId(fileIdByPath, reviewFilePath);
    }
  }
}

export async function persistNewcomerChangeGuidanceRecommendations(
  transaction: DatabaseTransaction,

  analysisId: string,

  result: NewcomerChangeGuidanceResult,

  fileIdByPath: FileIdByPath,
): Promise<number> {
  validateNewcomerChangeGuidance(result, fileIdByPath);

  if (result.recommendations.length === 0) {
    return 0;
  }

  const rows = result.recommendations.map((recommendation, index) => ({
    analysisId,

    recommendationRank: index + 1,

    fileId: requireFileId(fileIdByPath, recommendation.filePath),

    safetyScore: recommendation.safetyScore,

    riskLevel: recommendation.riskLevel,

    blastRadius: recommendation.blastRadius,

    blastMaxDistance: recommendation.blastMaxDistance,

    reviewFilePaths: recommendation.reviewFilePaths,

    signals: recommendation.signals,
  }));

  await transaction.insert(newcomerChangeGuidanceRecommendations).values(rows);

  return rows.length;
}
