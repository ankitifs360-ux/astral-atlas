import { describe, expect, it, vi } from 'vitest';

import { newcomerChangeGuidanceRecommendations } from '@astral-atlas/database';

import type {
  NewcomerChangeGuidanceRecommendation,
  NewcomerChangeGuidanceResult,
} from '../onboarding/newcomer-change-guidance-types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

import { persistNewcomerChangeGuidanceRecommendations } from './newcomer-change-guidance-persistence.js';

function createResult(): NewcomerChangeGuidanceResult {
  return {
    recommendations: [
      {
        filePath: 'src/simple.ts',

        safetyScore: 95,

        riskLevel: 'low',

        blastRadius: 1,

        blastMaxDistance: 1,

        reviewFilePaths: ['src/reviewer.ts'],

        signals: [
          {
            kind: 'blast-radius',

            description: 'Only one dependent file may be affected.',
          },
        ],
      },

      {
        filePath: 'src/helper.ts',

        safetyScore: 70,

        riskLevel: 'medium',

        blastRadius: 4,

        blastMaxDistance: 2,

        reviewFilePaths: ['src/simple.ts', 'src/reviewer.ts'],

        signals: [
          {
            kind: 'blast-distance',

            description: 'Impact can propagate across two dependency hops.',
          },
        ],
      },
    ],

    consideredFileCount: 3,

    maxRecommendations: 5,
  };
}

function requireRecommendation(
  result: NewcomerChangeGuidanceResult,

  index: number,
): NewcomerChangeGuidanceRecommendation {
  const recommendation = result.recommendations[index];

  if (recommendation === undefined) {
    throw new Error(`Expected newcomer change guidance recommendation at index ${index}`);
  }

  return recommendation;
}

function createFileIdByPath(): FileIdByPath {
  return new Map([
    ['src/simple.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

    ['src/helper.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],

    ['src/reviewer.ts', 'cccccccc-cccc-cccc-cccc-cccccccccccc'],
  ]);
}

function createTransaction(): {
  transaction: DatabaseTransaction;

  insertSpy: ReturnType<typeof vi.fn>;

  valuesSpy: ReturnType<typeof vi.fn>;
} {
  const valuesSpy = vi.fn(async () => undefined);

  const insertSpy = vi.fn((table: unknown) => {
    if (table !== newcomerChangeGuidanceRecommendations) {
      throw new Error('Unexpected table insert');
    }

    return {
      values: valuesSpy,
    };
  });

  return {
    transaction: {
      insert: insertSpy,
    } as unknown as DatabaseTransaction,

    insertSpy,

    valuesSpy,
  };
}

describe('persistNewcomerChangeGuidanceRecommendations', () => {
  it('persists ranked guidance recommendations and returns their count', async () => {
    const result = createResult();

    const { transaction, valuesSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).resolves.toBe(2);

    expect(valuesSpy).toHaveBeenCalledWith([
      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        recommendationRank: 1,

        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        safetyScore: 95,

        riskLevel: 'low',

        blastRadius: 1,

        blastMaxDistance: 1,

        reviewFilePaths: ['src/reviewer.ts'],

        signals: result.recommendations[0]?.signals,
      },

      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        recommendationRank: 2,

        fileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        safetyScore: 70,

        riskLevel: 'medium',

        blastRadius: 4,

        blastMaxDistance: 2,

        reviewFilePaths: ['src/simple.ts', 'src/reviewer.ts'],

        signals: result.recommendations[1]?.signals,
      },
    ]);
  });

  it('does not insert rows for an empty guidance result', async () => {
    const result: NewcomerChangeGuidanceResult = {
      recommendations: [],

      consideredFileCount: 0,

      maxRecommendations: 5,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        new Map(),
      ),
    ).resolves.toBe(0);

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate recommendation file paths', async () => {
    const result = createResult();

    const first = requireRecommendation(result, 0);

    result.recommendations = [first, first];

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Duplicate newcomer change guidance file path "src/simple.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects recommendations for unknown persisted files', async () => {
    const result = createResult();

    requireRecommendation(result, 0).filePath = 'src/missing.ts';

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change guidance references unknown persisted file "src/missing.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects safety scores outside 0..100', async () => {
    const result = createResult();

    requireRecommendation(result, 0).safetyScore = 101;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change safety score for "src/simple.ts" must be an integer between 0 and 100',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid risk levels', async () => {
    const result = createResult();

    Object.assign(requireRecommendation(result, 0), {
      riskLevel: 'critical',
    });

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Newcomer change risk level for "src/simple.ts" must be low, medium or high');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects negative blast radius values', async () => {
    const result = createResult();

    requireRecommendation(result, 0).blastRadius = -1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change blast radius for "src/simple.ts" must be a non-negative integer',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects negative blast max distance values', async () => {
    const result = createResult();

    requireRecommendation(result, 0).blastMaxDistance = -1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change blast max distance for "src/simple.ts" must be a non-negative integer',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects self-references in review files', async () => {
    const result = createResult();

    requireRecommendation(result, 0).reviewFilePaths = ['src/simple.ts'];

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Newcomer change guidance for "src/simple.ts" cannot review itself');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate review file paths', async () => {
    const result = createResult();

    requireRecommendation(result, 0).reviewFilePaths = ['src/reviewer.ts', 'src/reviewer.ts'];

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Duplicate review file path "src/reviewer.ts" for newcomer change guidance "src/simple.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects unknown review files', async () => {
    const result = createResult();

    requireRecommendation(result, 0).reviewFilePaths = ['src/missing.ts'];

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change guidance references unknown persisted file "src/missing.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects more recommendations than maxRecommendations', async () => {
    const result = createResult();

    result.maxRecommendations = 1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Newcomer change guidance contains more recommendations than maxRecommendations',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects more recommendations than considered files', async () => {
    const result = createResult();

    result.consideredFileCount = 1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistNewcomerChangeGuidanceRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Newcomer change guidance recommendations cannot exceed consideredFileCount');

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
