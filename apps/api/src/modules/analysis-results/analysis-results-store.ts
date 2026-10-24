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
  sql,
  symbols,
} from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';
import type {
  AnalysisFileDetailResponse,
  AnalysisGraphResponse,
  AnalysisPathfinderResponse,
  ApiAnalysisMetadata,
  ApiFinding,
  ApiFindingEvidence,
  ApiGraphEdge,
  ApiGraphNode,
  ApiHealthDimension,
  ApiOnboardingSignal,
  ApiRepositoryHealth,
  ApiRepositorySummary,
  ApiSymbol,
} from '@astral-atlas/shared';

function validateAnalysisId(analysisId: string): string {
  const normalized = analysisId.trim();

  if (normalized.length === 0) {
    throw new Error('analysisId cannot be empty');
  }

  return normalized;
}

function validateFileId(fileId: string): string {
  const normalized = fileId.trim();

  if (normalized.length === 0) {
    throw new Error('fileId cannot be empty');
  }

  return normalized;
}

function requireJson<T>(value: unknown, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Stored analysis is missing ${label}`);
  }

  return value as T;
}

function mapAnalysisMetadata(row: {
  id: string;
  repositoryId: string;
  commitSha: string;
  warningCount: number;
  fileCount: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date;
}): ApiAnalysisMetadata {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    commitSha: row.commitSha,
    status: 'completed',
    warningCount: row.warningCount,
    fileCount: row.fileCount,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt.toISOString(),
  };
}

function mapFileMetrics(row: {
  metricFileId: string | null;
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
}): ApiGraphNode['metrics'] {
  if (row.metricFileId === null) {
    return null;
  }

  return {
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
}

function mapGraphNode(row: {
  id: string;
  path: string;
  language: string;
  sizeBytes: number;
  isSupported: boolean;
  parseStatus: 'pending' | 'analyzed' | 'partial' | 'unsupported' | 'error';
  metricFileId: string | null;
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
}): ApiGraphNode {
  return {
    id: row.id,
    path: row.path,
    language: row.language,
    sizeBytes: row.sizeBytes,
    isSupported: row.isSupported,
    parseStatus: row.parseStatus,
    metrics: mapFileMetrics(row),
  };
}

function mapHealthDimensions(value: unknown): ApiHealthDimension[] {
  const stored = requireJson<
    {
      dimension: ApiHealthDimension['dimension'];
      maxScore: number;
      score: number;
      deductedPoints: number;
    }[]
  >(value, 'health dimensions');

  return stored.map((dimension) => ({
    dimension: dimension.dimension,
    maxScore: dimension.maxScore,
    score: dimension.score,
    deductedPoints: dimension.deductedPoints,
  }));
}

function mapEvidence(value: unknown, findingKey: string): ApiFindingEvidence[] {
  return requireJson<ApiFindingEvidence[]>(value, `evidence for finding "${findingKey}"`);
}

function mapSignals(value: unknown, order: number): ApiOnboardingSignal[] {
  return requireJson<ApiOnboardingSignal[]>(value, `signals for onboarding step ${order}`);
}

export class AnalysisResultsStore {
  public constructor(private readonly database: Database) {}

  public async getGraph(analysisId: string): Promise<AnalysisGraphResponse | null> {
    const normalizedAnalysisId = validateAnalysisId(analysisId);

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
      .where(and(eq(analyses.id, normalizedAnalysisId), eq(analyses.status, 'completed')))
      .limit(1);

    const analysis = analysisRows[0];

    if (analysis === undefined) {
      return null;
    }

    if (analysis.completedAt === null) {
      throw new Error(`Completed analysis "${normalizedAnalysisId}" has no completedAt timestamp`);
    }

    const resultRows = await this.database
      .select({
        repositorySummary: analysisResults.repositorySummary,
        healthScore: analysisResults.healthScore,
        healthRating: analysisResults.healthRating,
        healthDimensions: analysisResults.healthDimensions,
      })
      .from(analysisResults)
      .where(eq(analysisResults.analysisId, normalizedAnalysisId))
      .limit(1);

    const result = resultRows[0];

    if (result === undefined) {
      throw new Error(
        `Completed analysis "${normalizedAnalysisId}" is missing its analysis result`,
      );
    }

    const fileRows = await this.database
      .select({
        id: files.id,
        path: files.path,
        language: files.language,
        sizeBytes: files.sizeBytes,
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
      .where(eq(files.analysisId, normalizedAnalysisId));

    const nodes = fileRows
      .map(mapGraphNode)
      .sort((left, right) => left.path.localeCompare(right.path));

    const pathByFileId = new Map(nodes.map((node) => [node.id, node.path] as const));

    const edgeRows = await this.database
      .select({
        id: edges.id,
        sourceFileId: edges.fromFileId,
        targetFileId: edges.toFileId,
        fromSymbolId: edges.fromSymbolId,
        toSymbolId: edges.toSymbolId,
        type: edges.type,
        weight: edges.weight,
        isDynamic: edges.isDynamic,
      })
      .from(edges)
      .where(eq(edges.analysisId, normalizedAnalysisId));

    const graphEdges: ApiGraphEdge[] = edgeRows
      .map((edge) => {
        const sourcePath = pathByFileId.get(edge.sourceFileId);
        const targetPath = pathByFileId.get(edge.targetFileId);

        if (sourcePath === undefined || targetPath === undefined) {
          throw new Error(
            `Graph edge "${edge.id}" references a file outside analysis "${normalizedAnalysisId}"`,
          );
        }

        return {
          id: edge.id,
          sourceFileId: edge.sourceFileId,
          sourcePath,
          targetFileId: edge.targetFileId,
          targetPath,
          fromSymbolId: edge.fromSymbolId,
          toSymbolId: edge.toSymbolId,
          type: edge.type,
          weight: edge.weight,
          isDynamic: edge.isDynamic,
        };
      })
      .sort(
        (left, right) =>
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.targetPath.localeCompare(right.targetPath) ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );

    const summary = requireJson<ApiRepositorySummary>(
      result.repositorySummary,
      'repository summary',
    );

    const health: ApiRepositoryHealth = {
      score: result.healthScore,
      rating: result.healthRating,
      analyzedFileCount: summary.fileCount,
      dimensions: mapHealthDimensions(result.healthDimensions),
    };

    return {
      analysis: mapAnalysisMetadata({
        id: analysis.id,
        repositoryId: analysis.repositoryId,
        commitSha: analysis.commitSha,
        warningCount: analysis.warningCount,
        fileCount: analysis.fileCount,
        createdAt: analysis.createdAt,
        startedAt: analysis.startedAt,
        completedAt: analysis.completedAt,
      }),
      summary,
      health,
      nodes,
      edges: graphEdges,
    };
  }

  public async getFileDetail(
    analysisId: string,
    fileId: string,
  ): Promise<AnalysisFileDetailResponse | null> {
    const normalizedAnalysisId = validateAnalysisId(analysisId);
    const normalizedFileId = validateFileId(fileId);

    const completedRows = await this.database
      .select({
        id: analyses.id,
      })
      .from(analyses)
      .where(and(eq(analyses.id, normalizedAnalysisId), eq(analyses.status, 'completed')))
      .limit(1);

    if (completedRows[0] === undefined) {
      return null;
    }

    const fileRows = await this.database
      .select({
        id: files.id,
        path: files.path,
        language: files.language,
        sizeBytes: files.sizeBytes,
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
      .where(and(eq(files.analysisId, normalizedAnalysisId), eq(files.id, normalizedFileId)))
      .limit(1);

    const file = fileRows[0];

    if (file === undefined) {
      return null;
    }

    const pathRows = await this.database
      .select({
        id: files.id,
        path: files.path,
      })
      .from(files)
      .where(eq(files.analysisId, normalizedAnalysisId));

    const pathByFileId = new Map(pathRows.map((row) => [row.id, row.path] as const));

    const edgeRows = await this.database
      .select({
        id: edges.id,
        sourceFileId: edges.fromFileId,
        targetFileId: edges.toFileId,
        fromSymbolId: edges.fromSymbolId,
        toSymbolId: edges.toSymbolId,
        type: edges.type,
        weight: edges.weight,
        isDynamic: edges.isDynamic,
      })
      .from(edges)
      .where(
        and(
          eq(edges.analysisId, normalizedAnalysisId),
          sql<boolean>`(
            ${edges.fromFileId} = ${normalizedFileId}
            OR
            ${edges.toFileId} = ${normalizedFileId}
          )`,
        ),
      );

    const mappedEdges: ApiGraphEdge[] = edgeRows.map((edge) => {
      const sourcePath = pathByFileId.get(edge.sourceFileId);
      const targetPath = pathByFileId.get(edge.targetFileId);

      if (sourcePath === undefined || targetPath === undefined) {
        throw new Error(
          `Graph edge "${edge.id}" references a file outside analysis "${normalizedAnalysisId}"`,
        );
      }

      return {
        id: edge.id,
        sourceFileId: edge.sourceFileId,
        sourcePath,
        targetFileId: edge.targetFileId,
        targetPath,
        fromSymbolId: edge.fromSymbolId,
        toSymbolId: edge.toSymbolId,
        type: edge.type,
        weight: edge.weight,
        isDynamic: edge.isDynamic,
      };
    });

    const outgoingEdges = mappedEdges
      .filter((edge) => edge.sourceFileId === normalizedFileId)
      .sort(
        (left, right) =>
          left.targetPath.localeCompare(right.targetPath) ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );

    const incomingEdges = mappedEdges
      .filter((edge) => edge.targetFileId === normalizedFileId)
      .sort(
        (left, right) =>
          left.sourcePath.localeCompare(right.sourcePath) ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );

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
      .where(eq(symbols.fileId, normalizedFileId));

    const fileSymbols: ApiSymbol[] = symbolRows
      .map((symbol) => ({
        id: symbol.id,
        fileId: symbol.fileId,
        filePath: file.path,
        kind: symbol.kind,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        startLine: symbol.startLine,
        startColumn: symbol.startColumn,
        endLine: symbol.endLine,
        endColumn: symbol.endColumn,
        isExported: symbol.isExported,
        complexity: symbol.complexity,
      }))
      .sort(
        (left, right) =>
          left.startLine - right.startLine ||
          left.startColumn - right.startColumn ||
          left.kind.localeCompare(right.kind) ||
          left.qualifiedName.localeCompare(right.qualifiedName),
      );

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
      .innerJoin(analysisFindingFiles, eq(analysisFindingFiles.findingId, analysisFindings.id))
      .where(
        and(
          eq(analysisFindings.analysisId, normalizedAnalysisId),
          eq(analysisFindingFiles.fileId, normalizedFileId),
        ),
      );

    const fileFindings: ApiFinding[] = findingRows
      .map((finding) => ({
        id: finding.findingKey,
        kind: finding.kind,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        filePaths: [file.path],
        evidence: mapEvidence(finding.evidence, finding.findingKey),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    return {
      analysisId: normalizedAnalysisId,
      file: mapGraphNode(file),
      sourceContent: file.sourceContent,
      symbols: fileSymbols,
      outgoingEdges,
      incomingEdges,
      findings: fileFindings,
    };
  }

  public async getPathfinder(analysisId: string): Promise<AnalysisPathfinderResponse | null> {
    const normalizedAnalysisId = validateAnalysisId(analysisId);

    const completedRows = await this.database
      .select({
        id: analyses.id,
      })
      .from(analyses)
      .where(and(eq(analyses.id, normalizedAnalysisId), eq(analyses.status, 'completed')))
      .limit(1);

    if (completedRows[0] === undefined) {
      return null;
    }

    const resultRows = await this.database
      .select({
        consideredFileCount: analysisResults.onboardingConsideredFileCount,
        maxSteps: analysisResults.onboardingMaxSteps,
      })
      .from(analysisResults)
      .where(eq(analysisResults.analysisId, normalizedAnalysisId))
      .limit(1);

    const result = resultRows[0];

    if (result === undefined) {
      throw new Error(
        `Completed analysis "${normalizedAnalysisId}" is missing its analysis result`,
      );
    }

    const stepRows = await this.database
      .select({
        order: onboardingSteps.stepOrder,
        filePath: files.path,
        score: onboardingSteps.score,
        signals: onboardingSteps.signals,
      })
      .from(onboardingSteps)
      .innerJoin(files, eq(onboardingSteps.fileId, files.id))
      .where(eq(onboardingSteps.analysisId, normalizedAnalysisId));

    return {
      analysisId: normalizedAnalysisId,
      consideredFileCount: result.consideredFileCount,
      maxSteps: result.maxSteps,
      steps: stepRows
        .map((step) => ({
          order: step.order,
          filePath: step.filePath,
          score: step.score,
          signals: mapSignals(step.signals, step.order),
        }))
        .sort((left, right) => left.order - right.order),
    };
  }
}
