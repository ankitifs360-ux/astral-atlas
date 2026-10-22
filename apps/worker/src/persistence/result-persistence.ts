import { analysisResults, onboardingSteps } from '@astral-atlas/database';

import type { RepositoryHealthScore } from '../health-score/types.js';

import type { OnboardingPathResult } from '../onboarding/types.js';

import type { RepositoryMetricSummary } from '../metrics/types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

function requireFileId(
  fileIdByPath: FileIdByPath,

  filePath: string,
): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Onboarding step references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function validateHealthScore(healthScore: RepositoryHealthScore): void {
  if (!Number.isInteger(healthScore.score) || healthScore.score < 0 || healthScore.score > 100) {
    throw new Error('Repository health score must be an integer between 0 and 100');
  }

  const dimensionTotal = healthScore.dimensions.reduce(
    (total, dimension) => total + dimension.score,
    0,
  );

  if (dimensionTotal !== healthScore.score) {
    throw new Error('Repository health score does not match the sum of dimension scores');
  }
}

function validateOnboarding(
  onboarding: OnboardingPathResult,

  fileIdByPath: FileIdByPath,
): void {
  if (!Number.isInteger(onboarding.consideredFileCount) || onboarding.consideredFileCount < 0) {
    throw new Error('onboarding.consideredFileCount must be a non-negative integer');
  }

  if (!Number.isInteger(onboarding.maxSteps) || onboarding.maxSteps < 1) {
    throw new Error('onboarding.maxSteps must be a positive integer');
  }

  if (onboarding.steps.length > onboarding.maxSteps) {
    throw new Error('Onboarding path contains more steps than maxSteps');
  }

  const seenOrders = new Set<number>();

  const seenFilePaths = new Set<string>();

  for (const step of onboarding.steps) {
    if (!Number.isInteger(step.order) || step.order < 1) {
      throw new Error(`Onboarding step order must be a positive integer, received ${step.order}`);
    }

    if (seenOrders.has(step.order)) {
      throw new Error(`Duplicate onboarding step order ${step.order}`);
    }

    seenOrders.add(step.order);

    if (seenFilePaths.has(step.filePath)) {
      throw new Error(`Duplicate onboarding file path "${step.filePath}"`);
    }

    seenFilePaths.add(step.filePath);

    requireFileId(fileIdByPath, step.filePath);

    if (!Number.isInteger(step.score) || step.score < 0) {
      throw new Error(`Onboarding score for "${step.filePath}" must be a non-negative integer`);
    }
  }

  const sortedOrders = [...seenOrders].sort((left, right) => left - right);

  for (let index = 0; index < sortedOrders.length; index += 1) {
    const expectedOrder = index + 1;

    if (sortedOrders[index] !== expectedOrder) {
      throw new Error('Onboarding step orders must be sequential starting at 1');
    }
  }
}

export async function persistAnalysisResult(
  transaction: DatabaseTransaction,

  analysisId: string,

  repositorySummary: RepositoryMetricSummary,

  healthScore: RepositoryHealthScore,

  onboarding: OnboardingPathResult,

  fileIdByPath: FileIdByPath,
): Promise<void> {
  /*
   * Validate everything before any result rows are
   * written.
   */
  validateHealthScore(healthScore);

  validateOnboarding(onboarding, fileIdByPath);

  /*
   * -----------------------------------------------------------------------
   * B8 summary + B10 health + B11 metadata
   * -----------------------------------------------------------------------
   */
  await transaction.insert(analysisResults).values({
    analysisId,

    repositorySummary,

    healthScore: healthScore.score,

    healthRating: healthScore.rating,

    healthDimensions: healthScore.dimensions,

    onboardingConsideredFileCount: onboarding.consideredFileCount,

    onboardingMaxSteps: onboarding.maxSteps,
  });

  /*
   * -----------------------------------------------------------------------
   * B11 ordered reading path
   * -----------------------------------------------------------------------
   */
  if (onboarding.steps.length === 0) {
    return;
  }

  const rows = [...onboarding.steps]
    .sort((left, right) => left.order - right.order)
    .map((step) => ({
      analysisId,

      stepOrder: step.order,

      fileId: requireFileId(fileIdByPath, step.filePath),

      score: step.score,

      signals: step.signals,
    }));

  await transaction.insert(onboardingSteps).values(rows);
}
