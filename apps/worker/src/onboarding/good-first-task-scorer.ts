import type { FileArchitectureRiskScore } from '../deep-analysis/architecture-risk-score.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS } from '../deep-analysis/thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type {
  GoodFirstTaskRecommendation,
  GoodFirstTaskResult,
  GoodFirstTaskSignal,
} from './good-first-task-types.js';

export interface ScoreGoodFirstTasksInput {
  metrics: RepositoryMetrics;

  architectureRiskScores: readonly FileArchitectureRiskScore[];

  maxRecommendations?: number;
}

const DEFAULT_MAX_RECOMMENDATIONS = 5;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function getThresholdPenalty(
  value: number,

  mediumThreshold: number,

  highThreshold: number,

  mediumPenalty: number,

  highPenalty: number,
): number {
  if (value >= highThreshold) {
    return highPenalty;
  }

  if (value >= mediumThreshold) {
    return mediumPenalty;
  }

  return 0;
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

function createRecommendation(
  file: RepositoryMetrics['files'][number],

  architectureRiskScore: number,
): GoodFirstTaskRecommendation {
  const signals: GoodFirstTaskSignal[] = [];

  let score = 100;

  const architectureRiskPenalty = getArchitectureRiskPenalty(architectureRiskScore);

  if (architectureRiskPenalty > 0) {
    score -= architectureRiskPenalty;

    signals.push({
      kind: 'architecture-risk',

      impact: 'penalty',

      points: architectureRiskPenalty,

      description: `Architecture risk score ${architectureRiskScore}/100 makes this file less suitable for a first contribution.`,
    });
  }

  const complexityPenalty = getThresholdPenalty(
    file.structure.cyclomaticComplexity,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.cyclomaticComplexity.medium,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.cyclomaticComplexity.high,

    10,

    20,
  );

  if (complexityPenalty > 0) {
    score -= complexityPenalty;

    signals.push({
      kind: 'cyclomatic-complexity',

      impact: 'penalty',

      points: complexityPenalty,

      description: `Cyclomatic complexity ${file.structure.cyclomaticComplexity} increases the reasoning required for a safe first change.`,
    });
  }

  const fanOutPenalty = getThresholdPenalty(
    file.dependencies.fanOut,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanOut.medium,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.fanOut.high,

    8,

    15,
  );

  if (fanOutPenalty > 0) {
    score -= fanOutPenalty;

    signals.push({
      kind: 'fan-out',

      impact: 'penalty',

      points: fanOutPenalty,

      description: `Fan-out ${file.dependencies.fanOut} means this file depends on many repository files.`,
    });
  }

  const blastRadiusPenalty = getThresholdPenalty(
    file.blastRadius.affectedFileCount,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.affectedFileCount.medium,

    DEFAULT_DEEP_ANALYSIS_THRESHOLDS.affectedFileCount.high,

    8,

    15,
  );

  if (blastRadiusPenalty > 0) {
    score -= blastRadiusPenalty;

    signals.push({
      kind: 'blast-radius',

      impact: 'penalty',

      points: blastRadiusPenalty,

      description: `A change can affect ${file.blastRadius.affectedFileCount} other files, increasing first-task risk.`,
    });
  }

  if (file.cycles.inDependencyCycle) {
    score -= 15;

    signals.push({
      kind: 'dependency-cycle',

      impact: 'penalty',

      points: 15,

      description:
        'This file participates in a dependency cycle, making isolated beginner changes harder to reason about.',
    });
  }

  /*
   * A small amount of fan-in is useful:
   *
   * the file matters to the repository, but is not
   * yet a heavily shared high-fan-in dependency.
   */
  if (file.dependencies.fanIn >= 1 && file.dependencies.fanIn < 5) {
    score += 5;

    signals.push({
      kind: 'useful-context',

      impact: 'bonus',

      points: 5,

      description:
        'A small number of repository files depend on this file, giving a beginner useful architectural context without extreme coupling.',
    });
  }

  return {
    filePath: file.filePath,

    score: clamp(score, 0, 100),

    architectureRiskScore,

    signals,
  };
}

export function scoreGoodFirstTasks(input: ScoreGoodFirstTasksInput): GoodFirstTaskResult {
  const maxRecommendations = input.maxRecommendations ?? DEFAULT_MAX_RECOMMENDATIONS;

  validateMaxRecommendations(maxRecommendations);

  const riskScoreIndex = createRiskScoreIndex(input.architectureRiskScores);

  const recommendations = input.metrics.files
    .map((file) =>
      createRecommendation(
        file,

        riskScoreIndex.get(file.filePath) ?? 0,
      ),
    )
    .sort((left, right) => {
      const scoreOrder = right.score - left.score;

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
