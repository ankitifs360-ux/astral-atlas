import { describe, expect, it, vi } from 'vitest';

import { analysisResults, onboardingSteps } from '@astral-atlas/database';

import { persistAnalysisResult } from './result-persistence.js';

import type { RepositoryHealthScore } from '../health-score/types.js';

import type { RepositoryMetricSummary } from '../metrics/types.js';

import type { OnboardingPathResult } from '../onboarding/types.js';

import type { DatabaseTransaction, FileIdByPath } from './file-metrics-persistence.js';

interface CapturedInsert {
  table: unknown;

  values: unknown;
}

function createRepositorySummary(): RepositoryMetricSummary {
  return {
    fileCount: 2,

    internalDependencyCount: 1,

    externalImportCount: 0,

    unresolvedImportCount: 0,

    cyclicComponentCount: 0,

    cyclicFileCount: 0,

    totalCyclomaticComplexity: 5,

    averageCyclomaticComplexity: 2.5,

    maxCyclomaticComplexity: 3,

    historyAvailable: true,

    totalChangedCommitCount: 7,

    averageChangedCommitCount: 3.5,

    maxChangedCommitCount: 5,
  };
}

function createHealthScore(): RepositoryHealthScore {
  return {
    score: 88,

    rating: 'good',

    dimensions: [
      {
        dimension: 'maintainability',

        maxScore: 25,

        score: 22,

        deductedPoints: 3,

        deductions: [
          {
            reason: 'high-complexity',

            description: 'One file has high complexity.',

            points: 3,

            filePaths: ['src/core.ts'],
          },
        ],
      },

      {
        dimension: 'change-risk',

        maxScore: 20,

        score: 18,

        deductedPoints: 2,

        deductions: [],
      },

      {
        dimension: 'dependency-health',

        maxScore: 25,

        score: 23,

        deductedPoints: 2,

        deductions: [],
      },

      {
        dimension: 'coupling',

        maxScore: 20,

        score: 17,

        deductedPoints: 3,

        deductions: [],
      },

      {
        dimension: 'resolution-quality',

        maxScore: 10,

        score: 8,

        deductedPoints: 2,

        deductions: [],
      },
    ],

    analyzedFileCount: 2,
  };
}

function createOnboarding(): OnboardingPathResult {
  return {
    steps: [
      {
        order: 1,

        filePath: 'src/server.ts',

        score: 50,

        signals: [
          {
            kind: 'entry-point',

            weight: 50,

            description: 'Likely repository entry point.',
          },
        ],
      },

      {
        order: 2,

        filePath: 'src/core.ts',

        score: 45,

        signals: [
          {
            kind: 'dependency-of-previous',

            weight: 15,

            description: 'Direct dependency of the previous file.',
          },
        ],
      },
    ],

    consideredFileCount: 2,

    maxSteps: 10,
  };
}

function createFileIdByPath(): FileIdByPath {
  return new Map([
    ['src/server.ts', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],

    ['src/core.ts', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'],
  ]);
}

function createTransaction(): {
  transaction: DatabaseTransaction;

  inserts: CapturedInsert[];

  insertSpy: ReturnType<typeof vi.fn>;
} {
  const inserts: CapturedInsert[] = [];

  const insertSpy = vi.fn((table: unknown) => {
    if (table !== analysisResults && table !== onboardingSteps) {
      throw new Error('Unexpected table insert');
    }

    return {
      values: vi.fn(async (values: unknown) => {
        inserts.push({
          table,
          values,
        });
      }),
    };
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

describe('persistAnalysisResult', () => {
  it('persists B8 summary and B10 health result', async () => {
    const { transaction, inserts } = createTransaction();

    const repositorySummary = createRepositorySummary();

    const healthScore = createHealthScore();

    const onboarding = createOnboarding();

    await persistAnalysisResult(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      repositorySummary,
      healthScore,
      onboarding,
      createFileIdByPath(),
    );

    const resultInsert = inserts.find((insert) => insert.table === analysisResults);

    expect(resultInsert?.values).toEqual({
      analysisId: '11111111-1111-1111-1111-111111111111',

      repositorySummary,

      healthScore: 88,

      healthRating: 'good',

      healthDimensions: healthScore.dimensions,

      onboardingConsideredFileCount: 2,

      onboardingMaxSteps: 10,
    });
  });

  it('persists ordered B11 onboarding steps', async () => {
    const { transaction, inserts } = createTransaction();

    await persistAnalysisResult(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      createRepositorySummary(),
      createHealthScore(),
      createOnboarding(),
      createFileIdByPath(),
    );

    const onboardingInsert = inserts.find((insert) => insert.table === onboardingSteps);

    expect(onboardingInsert?.values).toEqual([
      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        stepOrder: 1,

        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',

        score: 50,

        signals: [
          {
            kind: 'entry-point',

            weight: 50,

            description: 'Likely repository entry point.',
          },
        ],
      },

      {
        analysisId: '11111111-1111-1111-1111-111111111111',

        stepOrder: 2,

        fileId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',

        score: 45,

        signals: [
          {
            kind: 'dependency-of-previous',

            weight: 15,

            description: 'Direct dependency of the previous file.',
          },
        ],
      },
    ]);
  });

  it('sorts onboarding steps by step order before persistence', async () => {
    const onboarding = createOnboarding();

    onboarding.steps = [onboarding.steps[1]!, onboarding.steps[0]!];

    const { transaction, inserts } = createTransaction();

    await persistAnalysisResult(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      createRepositorySummary(),
      createHealthScore(),
      onboarding,
      createFileIdByPath(),
    );

    const onboardingInsert = inserts.find((insert) => insert.table === onboardingSteps);

    const values = onboardingInsert?.values as
      | {
          stepOrder: number;
        }[]
      | undefined;

    expect(values?.map((row) => row.stepOrder)).toEqual([1, 2]);
  });

  it('persists analysis result without onboarding rows when the path is empty', async () => {
    const onboarding: OnboardingPathResult = {
      steps: [],

      consideredFileCount: 0,

      maxSteps: 10,
    };

    const { transaction, inserts } = createTransaction();

    await persistAnalysisResult(
      transaction,
      '11111111-1111-1111-1111-111111111111',
      createRepositorySummary(),
      createHealthScore(),
      onboarding,
      new Map(),
    );

    expect(inserts.filter((insert) => insert.table === analysisResults)).toHaveLength(1);

    expect(inserts.filter((insert) => insert.table === onboardingSteps)).toHaveLength(0);
  });

  it('rejects a negative repository health score before writing', async () => {
    const healthScore = createHealthScore();

    healthScore.score = -1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        healthScore,
        createOnboarding(),
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Repository health score must be an integer between 0 and 100');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a health score above 100 before writing', async () => {
    const healthScore = createHealthScore();

    healthScore.score = 101;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        healthScore,
        createOnboarding(),
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Repository health score must be an integer between 0 and 100');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a fractional repository health score before writing', async () => {
    const healthScore = createHealthScore();

    healthScore.score = 88.5;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        healthScore,
        createOnboarding(),
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Repository health score must be an integer between 0 and 100');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a health score that disagrees with its dimension total', async () => {
    const healthScore = createHealthScore();

    healthScore.score = 90;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        healthScore,
        createOnboarding(),
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Repository health score does not match the sum of dimension scores');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects an onboarding step that references an unknown file before writing', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[1] = {
      ...onboarding.steps[1]!,

      filePath: 'src/missing.ts',
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Onboarding step references unknown persisted file "src/missing.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate onboarding step orders', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[1] = {
      ...onboarding.steps[1]!,

      order: 1,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Duplicate onboarding step order 1');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects duplicate onboarding file paths', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[1] = {
      ...onboarding.steps[1]!,

      filePath: 'src/server.ts',
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Duplicate onboarding file path "src/server.ts"');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects non-sequential onboarding step orders', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[1] = {
      ...onboarding.steps[1]!,

      order: 3,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Onboarding step orders must be sequential starting at 1');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-positive onboarding step order', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[0] = {
      ...onboarding.steps[0]!,

      order: 0,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Onboarding step order must be a positive integer, received 0');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a negative onboarding step score', async () => {
    const onboarding = createOnboarding();

    onboarding.steps[0] = {
      ...onboarding.steps[0]!,

      score: -1,
    };

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Onboarding score for "src/server.ts" must be a non-negative integer');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects more onboarding steps than maxSteps', async () => {
    const onboarding = createOnboarding();

    onboarding.maxSteps = 1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('Onboarding path contains more steps than maxSteps');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a negative consideredFileCount', async () => {
    const onboarding = createOnboarding();

    onboarding.consideredFileCount = -1;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('onboarding.consideredFileCount must be a non-negative integer');

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-positive maxSteps', async () => {
    const onboarding = createOnboarding();

    onboarding.maxSteps = 0;

    const { transaction, insertSpy } = createTransaction();

    await expect(
      persistAnalysisResult(
        transaction,
        '11111111-1111-1111-1111-111111111111',
        createRepositorySummary(),
        createHealthScore(),
        onboarding,
        createFileIdByPath(),
      ),
    ).rejects.toThrow('onboarding.maxSteps must be a positive integer');

    expect(insertSpy).not.toHaveBeenCalled();
  });
});
