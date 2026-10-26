import { describe, expect, it, vi } from 'vitest';

import { goodFirstTaskRecommendations } from '@astral-atlas/database';

import { persistGoodFirstTaskRecommendations } from './good-first-task-persistence.js';

import type { GoodFirstTaskResult } from '../onboarding/good-first-task-types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

function createResult(): GoodFirstTaskResult {
  return {
    recommendations: [
      {
        filePath: 'src/simple.ts',

        score: 95,

        architectureRiskScore: 10,

        signals: [
          {
            kind: 'useful-context',

            impact: 'bonus',

            points: 5,

            description: 'Useful but moderately coupled file.',
          },
        ],
      },

      {
        filePath: 'src/helper.ts',

        score: 80,

        architectureRiskScore: 25,

        signals: [
          {
            kind: 'architecture-risk',

            impact: 'penalty',

            points: 10,

            description: 'Some architecture risk exists.',
          },
        ],
      },
    ],

    consideredFileCount: 2,

    maxRecommendations: 5,
  };
}

function requireRecommendation(
  result: GoodFirstTaskResult,
  index: number,
): GoodFirstTaskResult['recommendations'][number] {
  const recommendation = result.recommendations[index];

  if (recommendation === undefined) {
    throw new Error(`Expected good-first-task recommendation at index ${index}`);
  }

  return recommendation;
}

function createFileIdByPath(): FileIdByPath {
  return new Map([
    ['src/simple.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

    ['src/helper.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
  ]);
}

function createTransaction(): {
  transaction: DatabaseTransaction;

  insertSpy: ReturnType<typeof vi.fn>;

  valuesSpy: ReturnType<typeof vi.fn>;
} {
  const valuesSpy = vi.fn(async () => undefined);

  const insertSpy = vi.fn((table: unknown) => {
    if (table !== goodFirstTaskRecommendations) {
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

describe('persistGoodFirstTaskRecommendations', () => {
  it('persists ranked recommendations and returns their count', async () => {
    const result = createResult();

    const { transaction, valuesSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
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

        score: 95,

        architectureRiskScore: 10,

        signals: result.recommendations[0]?.signals,
      },

      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        recommendationRank: 2,

        fileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        score: 80,

        architectureRiskScore: 25,

        signals: result.recommendations[1]?.signals,
      },
    ]);
  });

  it('does not insert rows for an empty recommendation result', async () => {
    const result: GoodFirstTaskResult = {
      recommendations: [],

      consideredFileCount: 0,

      maxRecommendations: 5,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
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

    result.recommendations = [requireRecommendation(result, 0), requireRecommendation(result, 0)];

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Duplicate good-first-task file path "src/simple.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects recommendations for unknown persisted files', async () => {
    const result = createResult();

    const fileIds: FileIdByPath = new Map([
      ['src/simple.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ]);

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        fileIds,
      ),
    ).rejects.toThrow(
      'Good-first-task recommendation references unknown persisted file "src/helper.ts"',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects recommendation scores outside 0..100', async () => {
    const result = createResult();

    result.recommendations[0] = {
      ...requireRecommendation(result, 0),

      score: 101,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Good-first-task score for "src/simple.ts" must be an integer between 0 and 100',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects architecture risk scores outside 0..100', async () => {
    const result = createResult();

    result.recommendations[0] = {
      ...requireRecommendation(result, 0),

      architectureRiskScore: -1,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Architecture risk score for "src/simple.ts" must be an integer between 0 and 100',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects more recommendations than maxRecommendations', async () => {
    const result = createResult();

    result.maxRecommendations = 1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Good-first-task result contains more recommendations than maxRecommendations',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects more recommendations than considered files', async () => {
    const result = createResult();

    result.consideredFileCount = 1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow('Good-first-task recommendations cannot exceed consideredFileCount');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects negative signal points', async () => {
    const result = createResult();

    result.recommendations[0] = {
      ...requireRecommendation(result, 0),

      signals: [
        {
          kind: 'architecture-risk',

          impact: 'penalty',

          points: -1,

          description: 'Invalid test signal.',
        },
      ],
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistGoodFirstTaskRecommendations(
        transaction,

        '11111111-1111-1111-1111-111111111111',

        result,

        createFileIdByPath(),
      ),
    ).rejects.toThrow(
      'Good-first-task signal points for "src/simple.ts" must be a non-negative integer',
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
