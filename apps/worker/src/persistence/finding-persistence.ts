import { analysisFindingFiles, analysisFindings } from '@astral-atlas/database';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

export type FindingIdByKey = ReadonlyMap<string, string>;

function requireFileId(
  fileIdByPath: FileIdByPath,

  filePath: string,
): string {
  const fileId = fileIdByPath.get(filePath);

  if (fileId === undefined) {
    throw new Error(`Analysis finding references unknown persisted file "${filePath}"`);
  }

  return fileId;
}

function validateFindings(
  findings: readonly AnalysisFinding[],

  fileIdByPath: FileIdByPath,
): void {
  const findingKeys = new Set<string>();

  for (const finding of findings) {
    if (finding.id.trim().length === 0) {
      throw new Error('Analysis finding ID cannot be empty');
    }

    if (findingKeys.has(finding.id)) {
      throw new Error(`Duplicate analysis finding ID "${finding.id}"`);
    }

    findingKeys.add(finding.id);

    const findingFilePaths = new Set<string>();

    for (const filePath of finding.filePaths) {
      if (findingFilePaths.has(filePath)) {
        throw new Error(
          `Analysis finding "${finding.id}" contains duplicate file path "${filePath}"`,
        );
      }

      findingFilePaths.add(filePath);

      requireFileId(fileIdByPath, filePath);
    }
  }
}

function requireFindingDatabaseId(
  findingIdByKey: ReadonlyMap<string, string>,

  findingKey: string,
): string {
  const findingId = findingIdByKey.get(findingKey);

  if (findingId === undefined) {
    throw new Error(`Missing persisted finding ID for "${findingKey}"`);
  }

  return findingId;
}

export async function persistAnalysisFindings(
  transaction: DatabaseTransaction,

  analysisId: string,

  findings: readonly AnalysisFinding[],

  fileIdByPath: FileIdByPath,
): Promise<FindingIdByKey> {
  /*
   * Validate every finding and every referenced
   * file before starting any insert.
   */
  validateFindings(findings, fileIdByPath);

  if (findings.length === 0) {
    return new Map<string, string>();
  }

  /*
   * -----------------------------------------------------------------------
   * B9 findings
   * -----------------------------------------------------------------------
   *
   * finding.id is deterministic inside the
   * analysis engine.
   *
   * PostgreSQL still gets its own UUID primary
   * key, while finding.id is stored as findingKey.
   */
  const insertedFindings = await transaction
    .insert(analysisFindings)
    .values(
      [...findings]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((finding) => ({
          analysisId,

          findingKey: finding.id,

          kind: finding.kind,

          severity: finding.severity,

          title: finding.title,

          description: finding.description,

          evidence: finding.evidence,
        })),
    )
    .returning({
      id: analysisFindings.id,

      findingKey: analysisFindings.findingKey,
    });

  if (insertedFindings.length !== findings.length) {
    throw new Error(
      `Expected to persist ${findings.length} findings but PostgreSQL returned ${insertedFindings.length}`,
    );
  }

  const findingIdByKey = new Map<string, string>();

  for (const insertedFinding of insertedFindings) {
    if (findingIdByKey.has(insertedFinding.findingKey)) {
      throw new Error(
        `PostgreSQL returned duplicate persisted finding key "${insertedFinding.findingKey}"`,
      );
    }

    findingIdByKey.set(insertedFinding.findingKey, insertedFinding.id);
  }

  /*
   * -----------------------------------------------------------------------
   * Finding ↔ file associations
   * -----------------------------------------------------------------------
   */
  const findingFileRows = findings.flatMap((finding) =>
    finding.filePaths.map((filePath) => ({
      findingId: requireFindingDatabaseId(findingIdByKey, finding.id),

      fileId: requireFileId(fileIdByPath, filePath),
    })),
  );

  if (findingFileRows.length > 0) {
    /*
     * Deterministic ordering is useful for tests,
     * debugging and reproducible persistence.
     */
    findingFileRows.sort((left, right) => {
      const findingOrder = left.findingId.localeCompare(right.findingId);

      if (findingOrder !== 0) {
        return findingOrder;
      }

      return left.fileId.localeCompare(right.fileId);
    });

    await transaction.insert(analysisFindingFiles).values(findingFileRows);
  }

  return findingIdByKey;
}
