import { findDependencyCycles } from './dependency-cycle-rule.js';

import { findHighChurnFiles } from './high-churn-rule.js';

import { findHighComplexityFiles } from './high-complexity-rule.js';

import { findHighFanInFiles } from './high-fan-in-rule.js';

import { findHighFanOutFiles } from './high-fan-out-rule.js';

import { detectFileHotspots } from './hotspot-detector.js';

import { findLargeBlastRadiusFiles } from './large-blast-radius-rule.js';

import { sortFindings } from './finding-utils.js';

import { DEFAULT_DEEP_ANALYSIS_THRESHOLDS, validateDeepAnalysisThresholds } from './thresholds.js';

import { createUnresolvedImportFindingInputs } from './unresolved-import-adapter.js';

import { findUnresolvedImports } from './unresolved-import-rule.js';

import type { DeepAnalysisResult } from './types.js';

import type { DeepAnalysisThresholds } from './thresholds.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

export interface RepositoryDeepAnalysisInput {
  metrics: RepositoryMetrics;

  graphAnalysis: RepositoryGraphAnalysis;

  thresholds?: DeepAnalysisThresholds;
}

export function analyzeRepositoryDeeply(input: RepositoryDeepAnalysisInput): DeepAnalysisResult {
  const thresholds = input.thresholds ?? DEFAULT_DEEP_ANALYSIS_THRESHOLDS;

  /*
   * Validate custom/default thresholds once at
   * the B9 orchestration boundary.
   */
  validateDeepAnalysisThresholds(thresholds);

  /*
   * B7 stores only ResolvedImport[].
   *
   * The B9 adapter does not need B6's fileIndex,
   * so we provide only the imports field.
   */
  const unresolvedImports = createUnresolvedImportFindingInputs({
    imports: input.graphAnalysis.resolvedImports,
  });

  const hotspotResult = detectFileHotspots(input.metrics, thresholds);

  const findings = [
    ...findHighComplexityFiles(input.metrics, thresholds),

    ...findHighChurnFiles(input.metrics, thresholds),

    ...findLargeBlastRadiusFiles(input.metrics, thresholds),

    ...findHighFanInFiles(input.metrics, thresholds),

    ...findHighFanOutFiles(input.metrics, thresholds),

    ...findDependencyCycles(input.graphAnalysis.cycles),

    ...findUnresolvedImports(unresolvedImports),

    ...hotspotResult.findings,
  ];

  return {
    findings: sortFindings(findings),

    hotspots: hotspotResult.hotspots,
  };
}
