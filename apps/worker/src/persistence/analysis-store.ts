import {
  analyses,
  analysisFindingFiles,
  analysisFindings,
  analysisResults,
  and,
  edges,
  eq,
  files,
  metrics,
  onboardingSteps,
  repositories,
  symbols,
} from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

import type { AnalysisFinding } from '../deep-analysis/types.js';
import type { RepositoryHealthScore } from '../health-score/types.js';
import type { RepositoryMetricSummary } from '../metrics/types.js';
import type { OnboardingPathResult, OnboardingSignal } from '../onboarding/types.js';

import { persistCompletedAnalysis } from './completed-analysis-persistence.js';

import type { PersistCompletedAnalysisResult } from './completed-analysis-persistence.js';
import type { PersistCompletedAnalysisInput } from './types.js';

export interface StoredAnalysisFileMetrics {
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

export interface StoredAnalysisFile {
  id: string;

  path: string;

  language: string;

  sizeBytes: number;

  contentHash: string | null;

  sourceContent: string | null;

  isSupported: boolean;

  parseStatus: 'pending' | 'analyzed' | 'partial' | 'unsupported' | 'error';

  metrics: StoredAnalysisFileMetrics | null;
}

export interface StoredAnalysisSymbol {
  id: string;

  fileId: string;

  filePath: string;

  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable';

  name: string;

  qualifiedName: string;

  startLine: number;

  startColumn: number;

  endLine: number;

  endColumn: number;

  isExported: boolean;

  complexity: number | null;
}

export interface StoredAnalysisEdge {
  id: string;

  sourceFileId: string;
  sourcePath: string;

  targetFileId: string;
  targetPath: string;

  fromSymbolId: string | null;
  toSymbolId: string | null;

  type: 'import' | 'call';

  weight: number;

  isDynamic: boolean;
}

export interface StoredCompletedAnalysis {
  analysis: {
    id: string;

    repositoryId: string;

    commitSha: string;

    status: 'completed';

    warningCount: number;

    fileCount: number;

    createdAt: Date;

    startedAt: Date | null;

    completedAt: Date;
  };

  repositorySummary: RepositoryMetricSummary;

  healthScore: RepositoryHealthScore;

  files: StoredAnalysisFile[];

  symbols: StoredAnalysisSymbol[];

  edges: StoredAnalysisEdge[];

  findings: AnalysisFinding[];

  onboarding: OnboardingPathResult;
}

function validateAnalysisId(analysisId: string): void {
  if (analysisId.trim().length === 0) {
    throw new Error('analysisId cannot be empty');
  }
}

function validateSourceKey(sourceKey: string): void {
  if (sourceKey.trim().length === 0) {
    throw new Error('sourceKey cannot be empty');
  }
}

function validateRevision(revision: string): void {
  if (revision.trim().length === 0) {
    throw new Error('revision cannot be empty');
  }
}

function requireJson<T>(value: unknown, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Stored analysis is missing ${label}`);
  }

  return value as T;
}

function requireFilePath(
  filePathById: ReadonlyMap<string, string>,
  fileId: string,
  context: string,
): string {
  const path = filePathById.get(fileId);

  if (path === undefined) {
    throw new Error(`${context} references unknown persisted file "${fileId}"`);
  }

  return path;
}

export class AnalysisStore {
  public constructor(private readonly database: Database) {}

  public async put(input: PersistCompletedAnalysisInput): Promise<PersistCompletedAnalysisResult> {
    return persistCompletedAnalysis(this.database, input);
  }

  public async getCompletedBySourceRevision(
    sourceKey: string,
    revision: string,
  ): Promise<StoredCompletedAnalysis | null> {
    validateSourceKey(sourceKey);

    validateRevision(revision);

    /*
     * Cache identity:
     *
     * repository source key + exact revision.
     *
     * GitHub example:
     *
     *   github:facebook/react
     *   +
     *   exact Git commit SHA
     *
     * ZIP example:
     *
     *   zip:<sha256>
     *   +
     *   deterministic ZIP content SHA-256
     *
     * We only consider COMPLETED analyses cache hits.
     */
    const rows = await this.database
      .select({
        analysisId: analyses.id,
      })
      .from(analyses)
      .innerJoin(repositories, eq(analyses.repositoryId, repositories.id))
      .where(
        and(
          eq(repositories.sourceKey, sourceKey),

          eq(analyses.commitSha, revision),

          eq(analyses.status, 'completed'),
        ),
      )
      .limit(1);

    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    /*
     * Keep reconstruction logic centralized.
     *
     * This query only finds which completed analysis
     * belongs to the repository revision.
     *
     * getCompletedById() rebuilds the actual stored
     * analysis.
     */
    return this.getCompletedById(row.analysisId);
  }

  public async getCompletedById(analysisId: string): Promise<StoredCompletedAnalysis | null> {
    validateAnalysisId(analysisId);

    /*
     * ---------------------------------------------------------------
     * 1. Read the analysis header.
     * ---------------------------------------------------------------
     *
     * Only completed analyses are returned.
     *
     * queued/running/failed/partial analyses must never be served
     * as a finished architecture map.
     */
    const analysisRows = await this.database
      .select({
        id: analyses.id,

        repositoryId: analyses.repositoryId,

        commitSha: analyses.commitSha,

        status: analyses.status,

        warningCount: analyses.warningCount,

        fileCount: analyses.fileCount,

        createdAt: analyses.createdAt,

        startedAt: analyses.startedAt,

        completedAt: analyses.completedAt,
      })
      .from(analyses)
      .where(eq(analyses.id, analysisId))
      .limit(1);

    const analysis = analysisRows[0];

    if (analysis === undefined || analysis.status !== 'completed') {
      return null;
    }

    /*
     * completedAt should always be populated when status is completed.
     *
     * If not, the database contains an invalid completed analysis and
     * we fail loudly instead of silently returning inconsistent data.
     */
    if (analysis.completedAt === null) {
      throw new Error(`Completed analysis "${analysisId}" has no completedAt timestamp`);
    }

    /*
     * ---------------------------------------------------------------
     * 2. Repository-level result:
     *
     * B8 summary
     * B10 health score
     * B11 onboarding metadata
     * ---------------------------------------------------------------
     */
    const resultRows = await this.database
      .select({
        repositorySummary: analysisResults.repositorySummary,

        healthScore: analysisResults.healthScore,

        healthRating: analysisResults.healthRating,

        healthDimensions: analysisResults.healthDimensions,

        onboardingConsideredFileCount: analysisResults.onboardingConsideredFileCount,

        onboardingMaxSteps: analysisResults.onboardingMaxSteps,
      })
      .from(analysisResults)
      .where(eq(analysisResults.analysisId, analysisId))
      .limit(1);

    const result = resultRows[0];

    if (result === undefined) {
      throw new Error(`Completed analysis "${analysisId}" is missing its analysis result`);
    }

    const repositorySummary = requireJson<RepositoryMetricSummary>(
      result.repositorySummary,
      'repository summary',
    );

    const healthDimensions = requireJson<RepositoryHealthScore['dimensions']>(
      result.healthDimensions,
      'health dimensions',
    );

    /*
     * ---------------------------------------------------------------
     * 3. Files + metrics
     * ---------------------------------------------------------------
     */
    const fileRows = await this.database
      .select({
        id: files.id,

        path: files.path,

        language: files.language,

        sizeBytes: files.sizeBytes,

        contentHash: files.contentHash,

        sourceContent: files.sourceContent,

        isSupported: files.isSupported,

        parseStatus: files.parseStatus,

        metricFileId: metrics.fileId,

        loc: metrics.loc,

        tokenCount: metrics.tokenCount,

        cyclomaticComplexity: metrics.cyclomaticComplexity,

        churnAdditions: metrics.churnAdditions,

        churnDeletions: metrics.churnDeletions,

        churnCommits: metrics.churnCommits,

        importCount: metrics.importCount,

        functionCount: metrics.functionCount,

        classCount: metrics.classCount,

        hasSyntaxErrors: metrics.hasSyntaxErrors,

        fanIn: metrics.fanIn,

        fanOut: metrics.fanOut,

        transitiveDependencyCount: metrics.transitiveDependencyCount,

        blastRadius: metrics.blastRadius,

        blastMaxDistance: metrics.blastMaxDistance,

        inDependencyCycle: metrics.inDependencyCycle,

        cyclicComponentSize: metrics.cyclicComponentSize,

        riskScore: metrics.riskScore,
      })
      .from(files)
      .leftJoin(metrics, eq(metrics.fileId, files.id))
      .where(eq(files.analysisId, analysisId));

    const filePathById = new Map<string, string>();

    const storedFiles: StoredAnalysisFile[] = fileRows.map((row) => {
      filePathById.set(row.id, row.path);

      const storedMetrics: StoredAnalysisFileMetrics | null =
        row.metricFileId === null
          ? null
          : {
              loc: row.loc,

              tokenCount: row.tokenCount,

              cyclomaticComplexity: row.cyclomaticComplexity,

              churnAdditions: row.churnAdditions,

              churnDeletions: row.churnDeletions,

              churnCommits: row.churnCommits,

              importCount: row.importCount,

              functionCount: row.functionCount,

              classCount: row.classCount,

              hasSyntaxErrors: row.hasSyntaxErrors,

              fanIn: row.fanIn,

              fanOut: row.fanOut,

              transitiveDependencyCount: row.transitiveDependencyCount,

              blastRadius: row.blastRadius,

              blastMaxDistance: row.blastMaxDistance,

              inDependencyCycle: row.inDependencyCycle,

              cyclicComponentSize: row.cyclicComponentSize,

              riskScore: row.riskScore,
            };

      return {
        id: row.id,

        path: row.path,

        language: row.language,

        sizeBytes: row.sizeBytes,

        contentHash: row.contentHash,

        sourceContent: row.sourceContent,

        isSupported: row.isSupported,

        parseStatus: row.parseStatus,

        metrics: storedMetrics,
      };
    });

    storedFiles.sort((left, right) => left.path.localeCompare(right.path));

    /*
     * ---------------------------------------------------------------
     * 4. Symbols
     * ---------------------------------------------------------------
     *
     * Symbols belong to files, not directly to an
     * analysis row.
     *
     * Join symbols -> files and restrict the query
     * to files that belong to this analysis.
     */
    const symbolRows = await this.database
      .select({
        id: symbols.id,

        fileId: symbols.fileId,

        kind: symbols.kind,

        name: symbols.name,

        qualifiedName: symbols.qualifiedName,

        startLine: symbols.startLine,

        startColumn: symbols.startColumn,

        endLine: symbols.endLine,

        endColumn: symbols.endColumn,

        isExported: symbols.isExported,

        complexity: symbols.complexity,
      })
      .from(symbols)
      .innerJoin(files, eq(symbols.fileId, files.id))
      .where(eq(files.analysisId, analysisId));

    const storedSymbols: StoredAnalysisSymbol[] = symbolRows.map((symbol) => ({
      id: symbol.id,

      fileId: symbol.fileId,

      filePath: requireFilePath(filePathById, symbol.fileId, 'Symbol'),

      kind: symbol.kind,

      name: symbol.name,

      qualifiedName: symbol.qualifiedName,

      startLine: symbol.startLine,

      startColumn: symbol.startColumn,

      endLine: symbol.endLine,

      endColumn: symbol.endColumn,

      isExported: symbol.isExported,

      complexity: symbol.complexity,
    }));

    storedSymbols.sort(
      (left, right) =>
        left.filePath.localeCompare(right.filePath) ||
        left.startLine - right.startLine ||
        left.startColumn - right.startColumn ||
        left.kind.localeCompare(right.kind) ||
        left.qualifiedName.localeCompare(right.qualifiedName),
    );

    /*
     * ---------------------------------------------------------------
     * 5. Graph edges
     * ---------------------------------------------------------------
     */
    const edgeRows = await this.database
      .select({
        id: edges.id,

        fromFileId: edges.fromFileId,

        toFileId: edges.toFileId,

        fromSymbolId: edges.fromSymbolId,

        toSymbolId: edges.toSymbolId,

        type: edges.type,

        weight: edges.weight,

        isDynamic: edges.isDynamic,
      })
      .from(edges)
      .where(eq(edges.analysisId, analysisId));

    const storedEdges: StoredAnalysisEdge[] = edgeRows.map((edge) => ({
      id: edge.id,

      sourceFileId: edge.fromFileId,

      sourcePath: requireFilePath(filePathById, edge.fromFileId, 'Graph edge'),

      targetFileId: edge.toFileId,

      targetPath: requireFilePath(filePathById, edge.toFileId, 'Graph edge'),

      fromSymbolId: edge.fromSymbolId,

      toSymbolId: edge.toSymbolId,

      type: edge.type,

      weight: edge.weight,

      isDynamic: edge.isDynamic,
    }));

    storedEdges.sort(
      (left, right) =>
        left.sourcePath.localeCompare(right.sourcePath) ||
        left.targetPath.localeCompare(right.targetPath) ||
        left.type.localeCompare(right.type),
    );

    /*
     * ---------------------------------------------------------------
     * 6. Findings
     * ---------------------------------------------------------------
     */
    const findingRows = await this.database
      .select({
        id: analysisFindings.id,

        findingKey: analysisFindings.findingKey,

        kind: analysisFindings.kind,

        severity: analysisFindings.severity,

        title: analysisFindings.title,

        description: analysisFindings.description,

        evidence: analysisFindings.evidence,
      })
      .from(analysisFindings)
      .where(eq(analysisFindings.analysisId, analysisId));

    /*
     * A finding can point at zero, one, or many files.
     *
     * Repo-level findings therefore work as well.
     */
    const findingFileRows = await this.database
      .select({
        findingId: analysisFindingFiles.findingId,

        fileId: analysisFindingFiles.fileId,
      })
      .from(analysisFindingFiles)
      .innerJoin(analysisFindings, eq(analysisFindingFiles.findingId, analysisFindings.id))
      .where(eq(analysisFindings.analysisId, analysisId));

    const filePathsByFindingId = new Map<string, string[]>();

    for (const relation of findingFileRows) {
      const filePath = requireFilePath(filePathById, relation.fileId, 'Analysis finding');

      const existing = filePathsByFindingId.get(relation.findingId);

      if (existing === undefined) {
        filePathsByFindingId.set(relation.findingId, [filePath]);

        continue;
      }

      existing.push(filePath);
    }

    const storedFindings: AnalysisFinding[] = findingRows.map((finding) => {
      const filePaths = filePathsByFindingId.get(finding.id) ?? [];

      filePaths.sort((left, right) => left.localeCompare(right));

      return {
        id: finding.findingKey,

        kind: finding.kind,

        severity: finding.severity,

        title: finding.title,

        description: finding.description,

        filePaths,

        evidence: requireJson<AnalysisFinding['evidence']>(
          finding.evidence,
          `evidence for finding "${finding.findingKey}"`,
        ),
      };
    });

    storedFindings.sort((left, right) => left.id.localeCompare(right.id));

    /*
     * ---------------------------------------------------------------
     * 7. Onboarding path
     * ---------------------------------------------------------------
     */
    const onboardingRows = await this.database
      .select({
        order: onboardingSteps.stepOrder,

        fileId: onboardingSteps.fileId,

        score: onboardingSteps.score,

        signals: onboardingSteps.signals,
      })
      .from(onboardingSteps)
      .where(eq(onboardingSteps.analysisId, analysisId));

    const onboarding: OnboardingPathResult = {
      steps: onboardingRows
        .map((step) => ({
          order: step.order,

          filePath: requireFilePath(filePathById, step.fileId, 'Onboarding step'),

          score: step.score,

          signals: requireJson<OnboardingSignal[]>(
            step.signals,
            `signals for onboarding step ${step.order}`,
          ),
        }))
        .sort((left, right) => left.order - right.order),

      consideredFileCount: result.onboardingConsideredFileCount,

      maxSteps: result.onboardingMaxSteps,
    };

    /*
     * analyzedFileCount is already represented by the
     * repository metrics summary, so we reconstruct it
     * rather than storing the same number twice.
     */
    const healthScore: RepositoryHealthScore = {
      score: result.healthScore,

      rating: result.healthRating,

      dimensions: healthDimensions,

      analyzedFileCount: repositorySummary.fileCount,
    };

    return {
      analysis: {
        id: analysis.id,

        repositoryId: analysis.repositoryId,

        commitSha: analysis.commitSha,

        status: 'completed',

        warningCount: analysis.warningCount,

        fileCount: analysis.fileCount,

        createdAt: analysis.createdAt,

        startedAt: analysis.startedAt,

        completedAt: analysis.completedAt,
      },

      repositorySummary,

      healthScore,

      files: storedFiles,

      symbols: storedSymbols,

      edges: storedEdges,

      findings: storedFindings,

      onboarding,
    };
  }
}
