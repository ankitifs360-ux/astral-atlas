import type { FileArchitectureRiskScore } from '../deep-analysis/architecture-risk-score.js';
import type { AnalysisFinding } from '../deep-analysis/types.js';
import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';
import type { RepositoryHealthScore } from '../health-score/types.js';
import type { RepositoryMetrics } from '../metrics/types.js';
import type { GoodFirstTaskResult } from '../onboarding/good-first-task-types.js';
import type { NewcomerChangeGuidanceResult } from '../onboarding/newcomer-change-guidance-types.js';
import type { OnboardingPathResult } from '../onboarding/types.js';
import type { ResolvedCall } from '../resolution/types.js';

import type { PersistAnalysisSymbolInput } from './symbol-persistence.js';

export interface PersistAnalysisFileInput {
  filePath: string;

  language: string;

  sizeBytes: number;

  contentHash?: string;

  /**
   * Original UTF-8 source text.
   *
   * Persisted so the frontend can display the file later
   * even after the temporary cloned/extracted repository
   * has been deleted.
   */
  sourceContent?: string;

  isSupported?: boolean;

  parseStatus?: 'pending' | 'analyzed' | 'partial' | 'unsupported' | 'error';
}

export interface PersistCompletedAnalysisInput {
  analysisId: string;

  files: readonly PersistAnalysisFileInput[];

  symbols: readonly PersistAnalysisSymbolInput[];

  graphAnalysis: RepositoryGraphAnalysis;

  /**
   * Function calls that B15.2 successfully attempted to
   * resolve across the repository.
   *
   * Optional for backward compatibility with existing
   * persistence fixtures while the production pipeline is
   * being wired incrementally.
   *
   * Only calls with kind === "internal" are ultimately
   * persisted as symbol-to-symbol call edges.
   */
  resolvedCalls?: readonly ResolvedCall[];

  metrics: RepositoryMetrics;

  /**
   * B15.4 normalized per-file architecture risk scores.
   *
   * Values are 0..100 and are persisted into
   * metrics.risk_score for graph/heatmap rendering.
   *
   * Optional while existing persistence fixtures are
   * migrated incrementally.
   */
  architectureRiskScores?: readonly FileArchitectureRiskScore[];

  findings: readonly AnalysisFinding[];

  healthScore: RepositoryHealthScore;

  onboarding: OnboardingPathResult;

  /**
   * B15.5 ranked beginner-friendly contribution recommendations.
   */
  goodFirstTasks: GoodFirstTaskResult;

  /**
   * B15.6 blast-radius-aware newcomer change guidance.
   */
  newcomerChangeGuidance: NewcomerChangeGuidanceResult;
}
