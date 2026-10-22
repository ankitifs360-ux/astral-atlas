import type { DeepAnalysisResult } from '../deep-analysis/types.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import { scoreOnboardingCandidates } from './candidate-scorer.js';

import { detectEntryPointCandidates } from './entry-point-detector.js';

import { buildOnboardingPath } from './pathfinder.js';

import type { OnboardingPathResult } from './types.js';

export interface BuildRepositoryOnboardingPathInput {
  graphAnalysis: RepositoryGraphAnalysis;

  metrics: RepositoryMetrics;

  deepAnalysis: DeepAnalysisResult;

  maxSteps?: number;
}

export function buildRepositoryOnboardingPath(
  input: BuildRepositoryOnboardingPathInput,
): OnboardingPathResult {
  /*
   * Step 1:
   *
   * Find likely starting points.
   */
  const entryPoints = detectEntryPointCandidates(input.metrics);

  /*
   * Step 2:
   *
   * Rank repository files using architectural
   * importance signals from B8 + B9.
   */
  const candidates = scoreOnboardingCandidates({
    metrics: input.metrics,

    deepAnalysis: input.deepAnalysis,

    entryPoints,
  });

  /*
   * Step 3:
   *
   * Turn ranked files into an actual reading
   * path by following dependency edges whenever
   * possible.
   */
  return buildOnboardingPath({
    graphAnalysis: input.graphAnalysis,

    candidates,

    entryPoints,

    ...(input.maxSteps === undefined
      ? {}
      : {
          maxSteps: input.maxSteps,
        }),
  });
}
