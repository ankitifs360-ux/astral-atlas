export const ANALYSIS_QUEUE_NAME = 'analysis';

export const ANALYSIS_JOB_NAME = 'analyze-repository';

export const ANALYSIS_JOB_SCHEMA_VERSION = 1 as const;

export interface GitHubAnalysisSource {
  sourceType: 'github';

  owner: string;
  repo: string;

  canonicalUrl: string;
  sourceKey: string;

  commitSha: string;
}

export interface ZipAnalysisSource {
  sourceType: 'zip';

  sourceKey: string;

  contentSha256: string;

  archivePath: string;
}

export type AnalysisSource = GitHubAnalysisSource | ZipAnalysisSource;

export interface AnalysisJobData {
  schemaVersion: typeof ANALYSIS_JOB_SCHEMA_VERSION;

  analysisId: string;

  repositoryId: string;

  source: AnalysisSource;
}

export type AnalysisProgressStage =
  | 'queued'
  | 'ingesting'
  | 'parsing'
  | 'resolving-imports'
  | 'building-graph'
  | 'computing-metrics'
  | 'deep-analysis'
  | 'persisting'
  | 'completed';

export interface AnalysisProgress {
  analysisId: string;

  stage: AnalysisProgressStage;

  percent: number;

  message: string;

  timestamp: string;
}

export interface AnalysisJobResult {
  analysisId: string;

  status: 'completed' | 'partial';
}
