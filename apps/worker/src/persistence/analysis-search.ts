import { analyses, and, eq, files, sql, symbols } from '@astral-atlas/database';

import type { Database } from '@astral-atlas/database';

export interface AnalysisSearchFileResult {
  id: string;
  path: string;
  language: string;
  isSupported: boolean;
  parseStatus: 'pending' | 'analyzed' | 'partial' | 'unsupported' | 'error';
}

export interface AnalysisSearchSymbolResult {
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

export interface AnalysisSearchResult {
  analysisId: string;
  query: string;

  files: AnalysisSearchFileResult[];
  symbols: AnalysisSearchSymbolResult[];
}

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;
const MAX_SEARCH_QUERY_LENGTH = 200;

function validateAnalysisId(analysisId: string): string {
  const normalized = analysisId.trim();

  if (normalized.length === 0) {
    throw new Error('analysisId cannot be empty');
  }

  return normalized;
}

function validateSearchQuery(query: string): string {
  const normalized = query.trim();

  if (normalized.length === 0) {
    throw new Error('Search query cannot be empty');
  }

  if (normalized.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new Error(`Search query cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters`);
  }

  return normalized;
}

function validateSearchLimit(limit: number): number {
  if (!Number.isInteger(limit)) {
    throw new Error('Search limit must be an integer');
  }

  if (limit < 1 || limit > MAX_SEARCH_LIMIT) {
    throw new Error(`Search limit must be between 1 and ${MAX_SEARCH_LIMIT}`);
  }

  return limit;
}

export class AnalysisSearchStore {
  public constructor(private readonly database: Database) {}

  public async search(
    analysisId: string,
    query: string,
    limit: number = DEFAULT_SEARCH_LIMIT,
  ): Promise<AnalysisSearchResult | null> {
    const normalizedAnalysisId = validateAnalysisId(analysisId);
    const normalizedQuery = validateSearchQuery(query);
    const normalizedLimit = validateSearchLimit(limit);

    /*
     * Only completed analyses are searchable.
     *
     * This mirrors AnalysisStore: callers must never receive a
     * half-written architecture map.
     */
    const completedAnalysisRows = await this.database
      .select({
        id: analyses.id,
      })
      .from(analyses)
      .where(and(eq(analyses.id, normalizedAnalysisId), eq(analyses.status, 'completed')))
      .limit(1);

    if (completedAnalysisRows[0] === undefined) {
      return null;
    }

    /*
     * Literal, case-insensitive substring search.
     *
     * We deliberately use PostgreSQL position(lower(query) in
     * lower(column)) instead of ILIKE '%query%'.
     *
     * That means user characters such as "%" and "_" are treated as
     * normal text rather than wildcard operators.
     */
    const fileMatch = sql<boolean>`
      position(
        lower(${normalizedQuery})
        in lower(${files.path})
      ) > 0
    `;

    const symbolMatch = sql<boolean>`
      (
        position(
          lower(${normalizedQuery})
          in lower(${symbols.name})
        ) > 0
        OR
        position(
          lower(${normalizedQuery})
          in lower(${symbols.qualifiedName})
        ) > 0
      )
    `;

    const fileRows = await this.database
      .select({
        id: files.id,
        path: files.path,
        language: files.language,
        isSupported: files.isSupported,
        parseStatus: files.parseStatus,
      })
      .from(files)
      .where(and(eq(files.analysisId, normalizedAnalysisId), fileMatch))
      .orderBy(files.path)
      .limit(normalizedLimit);

    const symbolRows = await this.database
      .select({
        id: symbols.id,

        fileId: symbols.fileId,
        filePath: files.path,

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
      .where(and(eq(files.analysisId, normalizedAnalysisId), symbolMatch))
      .orderBy(
        files.path,
        symbols.startLine,
        symbols.startColumn,
        symbols.kind,
        symbols.qualifiedName,
      )
      .limit(normalizedLimit);

    return {
      analysisId: normalizedAnalysisId,
      query: normalizedQuery,

      files: fileRows.map((row) => ({
        id: row.id,
        path: row.path,
        language: row.language,
        isSupported: row.isSupported,
        parseStatus: row.parseStatus,
      })),

      symbols: symbolRows.map((row) => ({
        id: row.id,

        fileId: row.fileId,
        filePath: row.filePath,

        kind: row.kind,

        name: row.name,
        qualifiedName: row.qualifiedName,

        startLine: row.startLine,
        startColumn: row.startColumn,
        endLine: row.endLine,
        endColumn: row.endColumn,

        isExported: row.isExported,
        complexity: row.complexity,
      })),
    };
  }
}
