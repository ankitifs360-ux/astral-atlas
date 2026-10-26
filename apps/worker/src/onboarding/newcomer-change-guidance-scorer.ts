import type { FileArchitectureRiskScore } from '../deep-analysis/architecture-risk-score.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from '../deep-analysis/thresholds.js';

import { getTransitiveDependents } from '../graph/graph-traversal.js';

import type { FileDependencyGraph } from '../graph/types.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type {
  NewcomerChangeGuidanceRecommendation,
  NewcomerChangeGuidanceResult,
  NewcomerChangeGuidanceSignal,
  NewcomerChangeRiskLevel,
} from './newcomer-change-guidance-types.js';

export interface ScoreNewcomerChangeGuidanceInput {
  metrics: RepositoryMetrics;

  graph: FileDependencyGraph;

  architectureRiskScores: readonly FileArchitectureRiskScore[];

  maxRecommendations?: number;
}

const DEFAULT_MAX_RECOMMENDATIONS = 5;

const MAX_REVIEW_FILES = 5;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateMaxRecommendations(maxRecommendations: number): void {
  if (!Number.isInteger(maxRecommendations) || maxRecommendations <= 0) {
    throw new Error('maxRecommendations must be a positive integer');
  }
}

function createRiskScoreIndex(
  riskScores: readonly FileArchitectureRiskScore[],
): Map<string, number> {
  const index = new Map<string, number>();

  for (const risk of riskScores) {
    if (index.has(risk.filePath)) {
      throw new Error(`Duplicate architecture risk score for "${risk.filePath}"`);
    }

    if (!Number.isFinite(risk.riskScore) || risk.riskScore < 0 || risk.riskScore > 100) {
      throw new Error(`Architecture risk score for "${risk.filePath}" must be between 0 and 100`);
    }

    index.set(risk.filePath, risk.riskScore);
  }

  return index;
}

function getArchitectureRiskPenalty(riskScore: number): number {
  if (riskScore >= 85) {
    return 30;
  }

  if (riskScore >= 60) {
    return 20;
  }

  if (riskScore >= 25) {
    return 10;
  }

  return 0;
}

function getBlastRadiusPenalty(affectedFileCount: number): number {
  if (affectedFileCount >= DEFAULT_DEEP_ANALYSIS_THRESHOLDS.affectedFileCount.high) {
    return 30;
  }

  if (affectedFileCount >= DEFAULT_DEEP_ANALYSIS_THRESHOLDS.affectedFileCount.medium) {
    return 15;
  }

  return 0;
}

function getFanInPenalty(fanIn: number): number {
  if (fanIn >= DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanIn.high) {
    return 20;
  }

  if (fanIn >= DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanIn.medium) {
    return 10;
  }

  return 0;
}

function getBlastDistancePenalty(maxDistance: number): number {
  if (maxDistance >= 4) {
    return 15;
  }

  if (maxDistance >= 2) {
    return 8;
  }

  return 0;
}

function getRiskLevel(safetyScore: number): NewcomerChangeRiskLevel {
  if (safetyScore >= 75) {
    return 'low';
  }

  if (safetyScore >= 45) {
    return 'medium';
  }

  return 'high';
}

function createRecommendation(
  file: RepositoryMetrics['files'][number],

  graph: FileDependencyGraph,

  architectureRiskScore: number,
): NewcomerChangeGuidanceRecommendation {
  const signals: NewcomerChangeGuidanceSignal[] = [];

  let safetyScore = 100;

  const blastRadiusPenalty = getBlastRadiusPenalty(file.blastRadius.affectedFileCount);

  if (blastRadiusPenalty > 0) {
    safetyScore -= blastRadiusPenalty;

    signals.push({
      kind: 'blast-radius',

      description: `A change to this file can affect ${file.blastRadius.affectedFileCount} other files.`,
    });
  }

  const blastDistancePenalty = getBlastDistancePenalty(file.blastRadius.maxDistance);

  if (blastDistancePenalty > 0) {
    safetyScore -= blastDistancePenalty;

    signals.push({
      kind: 'blast-distance',

      description: `Change impact can propagate up to ${file.blastRadius.maxDistance} dependency hops.`,
    });
  }

  if (file.cycles.inDependencyCycle) {
    safetyScore -= 20;

    signals.push({
      kind: 'dependency-cycle',

      description: `This file belongs to a dependency cycle containing ${file.cycles.cyclicComponentSize} files.`,
    });
  }

  const fanInPenalty = getFanInPenalty(file.dependencies.fanIn);

  if (fanInPenalty > 0) {
    safetyScore -= fanInPenalty;

    signals.push({
      kind: 'fan-in',

      description: `${file.dependencies.fanIn} repository files directly depend on this file.`,
    });
  }

  const architectureRiskPenalty = getArchitectureRiskPenalty(architectureRiskScore);

  if (architectureRiskPenalty > 0) {
    safetyScore -= architectureRiskPenalty;

    signals.push({
      kind: 'architecture-risk',

      description: `Architecture risk score ${architectureRiskScore}/100 increases the caution required for changes.`,
    });
  }

  const normalizedSafetyScore = clamp(safetyScore, 0, 100);

  const reviewFilePaths = getTransitiveDependents(graph, file.filePath)
    .slice(0, MAX_REVIEW_FILES)
    .map((affectedFile) => affectedFile.nodeId);

  return {
    filePath: file.filePath,

    safetyScore: normalizedSafetyScore,

    riskLevel: getRiskLevel(normalizedSafetyScore),

    blastRadius: file.blastRadius.affectedFileCount,

    blastMaxDistance: file.blastRadius.maxDistance,

    reviewFilePaths,

    signals,
  };
}

export function scoreNewcomerChangeGuidance(
  input: ScoreNewcomerChangeGuidanceInput,
): NewcomerChangeGuidanceResult {
  const maxRecommendations = input.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;

  validateMaxRecommendations(maxRecommendations);

  const riskScoreIndex = createRiskScoreIndex(input.architectureRiskScores);

  const recommendations = input.metrics.files
    .map((file) =>
      createRecommendation(
        file,

        input.graph,

        riskScoreIndex.get(file.filePath) ?? 0,
      ),
    )
    .sort((left, right) => {
      const scoreOrder = right.safetyScore - left.safetyScore;

      if (scoreOrder !== 0) {
        return scoreOrder;
      }

      return left.filePath.localeCompare(right.filePath);
    })
    .slice(0, maxRecommendations);

  return {
    recommendations,

    consideredFileCount: input.metrics.files.length,

    maxRecommendations,
  };
}
