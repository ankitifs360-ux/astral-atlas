/**
 * Public JSON contracts shared by the Fastify API and the future React app.
 *
 * Keep these types transport-safe:
 * - no Date objects
 * - no Map / Set
 * - no database-specific types
 * - no worker-only implementation details
 */

export type ApiFileParseStatus = 'pending' | 'analyzed' | 'partial' | 'unsupported' | 'error';

export type ApiSymbolKind =
  'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable';

export type ApiEdgeType = 'import' | 'call';

export type ApiFindingKind =
  | 'dependency-cycle'
  | 'unresolved-imports'
  | 'high-complexity'
  | 'high-churn'
  | 'large-blast-radius'
  | 'high-fan-in'
  | 'high-fan-out'
  | 'hotspot';

export type ApiFindingSeverity = 'low' | 'medium' | 'high';

export type ApiRepositoryHealthRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export type ApiHealthDimensionName =
  'maintainability' | 'change-risk' | 'dependency-health' | 'coupling' | 'resolution-quality';

export type ApiOnboardingSignalKind =
  | 'entry-point'
  | 'high-fan-in'
  | 'high-fan-out'
  | 'large-blast-radius'
  | 'hotspot'
  | 'dependency-cycle'
  | 'dependency-of-previous';

export type ApiAnalysisSubmissionState = 'cached' | 'existing' | 'created' | 'requeued';

export type ApiAnalysisSubmissionStatus = 'queued' | 'running' | 'completed';

export interface ApiRepositorySummary {
  fileCount: number;

  internalDependencyCount: number;
  externalImportCount: number;
  unresolvedImportCount: number;

  cyclicComponentCount: number;
  cyclicFileCount: number;

  totalCyclomaticComplexity: number;
  averageCyclomaticComplexity: number;
  maxCyclomaticComplexity: number;

  historyAvailable: boolean;

  totalChangedCommitCount: number | null;
  averageChangedCommitCount: number | null;
  maxChangedCommitCount: number | null;
}

export interface ApiHealthDimension {
  dimension: ApiHealthDimensionName;

  maxScore: number;
  score: number;
  deductedPoints: number;
}

export interface ApiRepositoryHealth {
  score: number;

  rating: ApiRepositoryHealthRating;

  analyzedFileCount: number;

  dimensions: ApiHealthDimension[];
}

export interface ApiFileMetrics {
  loc: number | null;
  tokenCount: number | null;

  cyclomaticComplexity: number | null;

  churnAdditions: number | null;
  churnDeletions: number | null;
  churnCommits: number | null;

  importCount: number | null;
  functionCount: number | null;
  classCount: number | null;

  hasSyntaxErrors: boolean | null;

  fanIn: number | null;
  fanOut: number | null;

  transitiveDependencyCount: number | null;

  blastRadius: number | null;
  blastMaxDistance: number | null;

  inDependencyCycle: boolean | null;
  cyclicComponentSize: number | null;

  riskScore: number | null;
}

export interface ApiGraphNode {
  id: string;

  path: string;

  language: string;

  sizeBytes: number;

  isSupported: boolean;

  parseStatus: ApiFileParseStatus;

  metrics: ApiFileMetrics | null;
}

export interface ApiGraphEdge {
  id: string;

  sourceFileId: string;
  sourcePath: string;

  targetFileId: string;
  targetPath: string;

  fromSymbolId: string | null;
  toSymbolId: string | null;

  type: ApiEdgeType;

  weight: number;

  isDynamic: boolean;
}

export interface ApiSymbol {
  id: string;

  fileId: string;
  filePath: string;

  kind: ApiSymbolKind;

  name: string;
  qualifiedName: string;

  startLine: number;
  startColumn: number;

  endLine: number;
  endColumn: number;

  isExported: boolean;

  complexity: number | null;
}

export interface ApiFindingEvidence {
  metric: string;

  value: number;

  threshold: number;
}

export interface ApiFinding {
  id: string;

  kind: ApiFindingKind;

  severity: ApiFindingSeverity;

  title: string;

  description: string;

  filePaths: string[];

  evidence: ApiFindingEvidence[];
}

export interface ApiAnalysisMetadata {
  id: string;

  repositoryId: string;

  commitSha: string;

  status: 'completed';

  warningCount: number;

  fileCount: number;

  createdAt: string;

  startedAt: string | null;

  completedAt: string;
}

/**
 * Returned immediately after a GitHub or ZIP submission.
 *
 * - cached: the completed PostgreSQL result already exists
 * - existing: the same analysis is already queued/running
 * - created: a brand-new analysis was queued
 * - requeued: an earlier failed/partial analysis was reset and queued again
 */
export interface AnalysisSubmissionResponse {
  analysisId: string;

  repositoryId: string;

  status: ApiAnalysisSubmissionStatus;

  state: ApiAnalysisSubmissionState;

  cacheHit: boolean;
}

export interface AnalysisGraphResponse {
  analysis: ApiAnalysisMetadata;

  summary: ApiRepositorySummary;

  health: ApiRepositoryHealth;

  nodes: ApiGraphNode[];

  edges: ApiGraphEdge[];
}

export interface AnalysisFileDetailResponse {
  analysisId: string;

  file: ApiGraphNode;

  sourceContent: string | null;

  symbols: ApiSymbol[];

  outgoingEdges: ApiGraphEdge[];

  incomingEdges: ApiGraphEdge[];

  findings: ApiFinding[];
}

export interface AnalysisSearchFileMatch {
  type: 'file';

  fileId: string;

  path: string;

  language: string;

  isSupported: boolean;

  parseStatus: ApiFileParseStatus;
}

export interface AnalysisSearchSymbolMatch {
  type: 'symbol';

  symbolId: string;

  fileId: string;
  filePath: string;

  kind: ApiSymbolKind;

  name: string;
  qualifiedName: string;

  startLine: number;
  startColumn: number;

  endLine: number;
  endColumn: number;

  isExported: boolean;

  complexity: number | null;
}

export interface AnalysisSearchResponse {
  analysisId: string;

  query: string;

  files: AnalysisSearchFileMatch[];

  symbols: AnalysisSearchSymbolMatch[];
}

export interface ApiOnboardingSignal {
  kind: ApiOnboardingSignalKind;

  weight: number;

  description: string;
}

export interface ApiOnboardingStep {
  order: number;

  filePath: string;

  score: number;

  signals: ApiOnboardingSignal[];
}

export interface AnalysisPathfinderResponse {
  analysisId: string;

  consideredFileCount: number;

  maxSteps: number;

  steps: ApiOnboardingStep[];
}

export interface ApiErrorResponse {
  error: {
    code: string;

    message: string;

    requestId?: string;
  };
}
