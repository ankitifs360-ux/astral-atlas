import type { AnalysisFinding } from '../deep-analysis/types.js';
import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';
import type { RepositoryHealthScore } from '../health-score/types.js';
import type { RepositoryMetrics } from '../metrics/types.js';
import type { OnboardingPathResult } from '../onboarding/types.js';

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

  metrics: RepositoryMetrics;

  findings: readonly AnalysisFinding[];

  healthScore: RepositoryHealthScore;

  onboarding: OnboardingPathResult;
}
