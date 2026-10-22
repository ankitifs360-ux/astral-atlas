import { describe, expect, it, vi } from 'vitest';

import { analysisFindingFiles, analysisFindings } from '@astral-atlas/database';

import { persistAnalysisFindings } from './finding-persistence.js';

import type { AnalysisFinding } from '../deep-analysis/types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

interface CapturedInsert {
  table: unknown;

  values: unknown;
}

function createFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
  return {
    id: 'finding:abc123',

    kind: 'high-complexity',

    severity: 'high',

    title: 'High complexity',

    description: 'Complex file detected',

    filePaths: ['src/core.ts'],

    evidence: [
      {
        metric: 'cyclomaticComplexity',

        value: 25,

        threshold: 20,
      },
    ],

    ...overrides,
  };
}

function createFileIdByPath(entries: [string, string][]): FileIdByPath {
  return new Map(entries);
}

function createTransaction(
  returnedFindings: {
    id: string;

    findingKey: string;
  }[] = [],
): {
  transaction: DatabaseTransaction;

  inserts: CapturedInsert[];

  insertSpy: ReturnType<typeof vi.fn>;
} {
  const inserts: CapturedInsert[] = [];

  const insertSpy = vi.fn((table: unknown) => {
    if (table === analysisFindings) {
      return {
        values(values: unknown) {
          inserts.push({
            table,
            values,
          });

          return {
            returning: vi.fn(async () => returnedFindings),
          };
        },
      };
    }

    if (table === analysisFindingFiles) {
      return {
        values: vi.fn(async (values: unknown) => {
          inserts.push({
            table,
            values,
          });
        }),
      };
    }

    throw new Error('Unexpected table insert');
  });

  const transaction = {
    insert: insertSpy,
  } as unknown as DatabaseTransaction;

  return {
    transaction,
    inserts,
    insertSpy,
  };
}

describe('persistAnalysisFindings', () => {
  it('persists a B9 finding and returns its database ID', async () => {
    const finding = createFinding();

    const { transaction } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: finding.id,
      },
    ]);

    const result = await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [finding],
      createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
    );

    expect(result.get(finding.id)).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('persists finding metadata and evidence', async () => {
    const finding = createFinding();

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: finding.id,
      },
    ]);

    await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [finding],
      createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
    );

    const findingInsert = inserts.find((insert) => insert.table === analysisFindings);

    expect(findingInsert?.values).toEqual([
      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        findingKey: 'finding:abc123',

        kind: 'high-complexity',

        severity: 'high',

        title: 'High complexity',

        description: 'Complex file detected',

        evidence: [
          {
            metric: 'cyclomaticComplexity',

            value: 25,

            threshold: 20,
          },
        ],
      },
    ]);
  });

  it('persists finding-to-file associations', async () => {
    const finding = createFinding({
      id: 'finding:cycle',

      kind: 'dependency-cycle',

      filePaths: ['src/a.ts', 'src/b.ts'],
    });

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: finding.id,
      },
    ]);

    await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [finding],
      createFileIdByPath([
        ['src/a.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],

        ['src/b.ts', 'cccccccc-cccc-cccc-cccc-cccccccccccc'],
      ]),
    );

    const linkInsert = inserts.find((insert) => insert.table === analysisFindingFiles);

    expect(linkInsert?.values).toEqual([
      {
        findingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        fileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      },

      {
        findingId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        fileId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      },
    ]);
  });

  it('supports findings with no file associations', async () => {
    const finding = createFinding({
      filePaths: [],
    });

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: finding.id,
      },
    ]);

    const result = await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [finding],
      createFileIdByPath([]),
    );

    expect(result.size).toBe(1);

    expect(inserts.filter((insert) => insert.table === analysisFindingFiles)).toHaveLength(0);
  });

  it('sorts findings deterministically by finding ID before insert', async () => {
    const first = createFinding({
      id: 'finding:z',

      filePaths: [],
    });

    const second = createFinding({
      id: 'finding:a',

      filePaths: [],
    });

    const { transaction, inserts } = createTransaction([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: 'finding:a',
      },

      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        findingKey: 'finding:z',
      },
    ]);

    await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [first, second],
      createFileIdByPath([]),
    );

    const findingInsert = inserts.find((insert) => insert.table === analysisFindings);

    expect(findingInsert?.values).toEqual([
      expect.objectContaining({
        findingKey: 'finding:a',
      }),

      expect.objectContaining({
        findingKey: 'finding:z',
      }),
    ]);
  });

  it('uses returned finding keys instead of relying on database return order', async () => {
    const first = createFinding({
      id: 'finding:a',
      filePaths: [],
    });

    const second = createFinding({
      id: 'finding:b',
      filePaths: [],
    });

    const { transaction } = createTransaction([
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        findingKey: 'finding:b',
      },

      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        findingKey: 'finding:a',
      },
    ]);

    const result = await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [first, second],
      createFileIdByPath([]),
    );

    expect(result.get('finding:a')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

    expect(result.get('finding:b')).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('rejects an empty finding ID before writing', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [
          createFinding({
            id: '   ',
          }),
        ],
        createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
      ),
    ).rejects.toThrow('Analysis finding ID cannot be empty');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate finding IDs', async () => {
    const finding = createFinding();

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [finding, finding],
        createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
      ),
    ).rejects.toThrow('Duplicate analysis finding ID "finding:abc123"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate file paths inside one finding', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [
          createFinding({
            filePaths: ['src/core.ts', 'src/core.ts'],
          }),
        ],
        createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
      ),
    ).rejects.toThrow(
      'Analysis finding "finding:abc123" contains duplicate file path "src/core.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a finding that references an unknown persisted file', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [createFinding()],
        createFileIdByPath([]),
      ),
    ).rejects.toThrow('Analysis finding references unknown persisted file "src/core.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('validates all findings before inserting any rows', async () => {
    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [
          createFinding({
            id: 'finding:valid',

            filePaths: ['src/core.ts'],
          }),

          createFinding({
            id: 'finding:invalid',

            filePaths: ['src/missing.ts'],
          }),
        ],
        createFileIdByPath([['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']]),
      ),
    ).rejects.toThrow('Analysis finding references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an unexpected number of returned finding rows', async () => {
    const finding = createFinding({
      filePaths: [],
    });

    const { transaction } = createTransaction([]);

    await expect(
      persistAnalysisFindings(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        [finding],
        createFileIdByPath([]),
      ),
    ).rejects.toThrow('Expected to persist 1 findings but PostgreSQL returned 0');
  });

  it('does not insert anything for an empty finding list', async () => {
    const { transaction, insertSpy } = createTransaction();

    const result = await persistAnalysisFindings(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      [],
      createFileIdByPath([]),
    );

    expect(result.size).toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
