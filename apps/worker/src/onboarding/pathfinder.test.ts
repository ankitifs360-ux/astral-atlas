import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ONBOARDING_MAX_STEPS,
  MAX_ONBOARDING_MAX_STEPS,
  buildOnboardingPath,
} from './pathfinder.js';

import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { OnboardingCandidate } from './candidate-scorer.js';

import type { EntryPointCandidate } from './entry-point-detector.js';

function createCandidate(filePath: string, score: number): OnboardingCandidate {
  return {
    filePath,
    score,
    signals: [],
  };
}

function createEntryPoint(filePath: string, score = 50): EntryPointCandidate {
  return {
    filePath,
    score,
    reasons: ['dependency-root'],
  };
}

function createGraphAnalysis(
  edges: {
    source: string;
    target: string;
  }[] = [],
): RepositoryGraphAnalysis {
  const filePaths = [...new Set(edges.flatMap((edge) => [edge.source, edge.target]))];

  return {
    graph: {
      nodes: filePaths.map((filePath) => ({
        id: filePath,

        kind: 'file',

        filePath,

        language: 'typescript',

        hasSyntaxErrors: false,
      })),

      edges: edges.map((edge, index) => ({
        id: `edge:${index}`,

        kind: 'imports',

        source: edge.source,

        target: edge.target,

        specifier: `./dependency-${index}`,

        range: {
          start: {
            row: index,

            column: 0,
          },

          end: {
            row: index,

            column: 1,
          },
        },
      })),
    },

    graphIndex: {} as RepositoryGraphAnalysis['graphIndex'],

    resolvedImports: [],

    cycles: [],
  };
}

describe('buildOnboardingPath', () => {
  it('starts from the best detected entry point even when another candidate has a higher score', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [createCandidate('src/core.ts', 100), createCandidate('src/server.ts', 50)],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/server.ts', 'src/core.ts']);
  });

  it('falls back to the highest-scoring candidate when there is no valid entry point', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [
        createCandidate('src/helper.ts', 10),

        createCandidate('src/core.ts', 80),

        createCandidate('src/service.ts', 40),
      ],

      entryPoints: [],
    });

    expect(result.steps[0]?.filePath).toBe('src/core.ts');
  });

  it('ignores entry points that do not exist in the candidate set', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [createCandidate('src/core.ts', 80)],

      entryPoints: [createEntryPoint('src/missing.ts')],
    });

    expect(result.steps[0]?.filePath).toBe('src/core.ts');
  });

  it('follows a direct dependency before jumping to a higher-scoring unrelated file', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      candidates: [
        createCandidate('src/server.ts', 50),

        createCandidate('src/routes.ts', 20),

        createCandidate('src/core.ts', 100),
      ],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/core.ts',
    ]);
  });

  it('builds a connected dependency reading chain', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },

        {
          source: 'src/routes.ts',

          target: 'src/service.ts',
        },

        {
          source: 'src/service.ts',

          target: 'src/database.ts',
        },
      ]),

      candidates: [
        createCandidate('src/server.ts', 50),

        createCandidate('src/routes.ts', 30),

        createCandidate('src/service.ts', 40),

        createCandidate('src/database.ts', 35),
      ],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/service.ts',
      'src/database.ts',
    ]);
  });

  it('chooses the highest-scoring unvisited direct dependency', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/config.ts',
        },

        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },

        {
          source: 'src/server.ts',

          target: 'src/container.ts',
        },
      ]),

      candidates: [
        createCandidate('src/server.ts', 50),

        createCandidate('src/config.ts', 15),

        createCandidate('src/routes.ts', 40),

        createCandidate('src/container.ts', 60),
      ],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps[1]?.filePath).toBe('src/container.ts');
  });

  it('breaks equal dependency-score ties lexically', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/z.ts',
        },

        {
          source: 'src/server.ts',

          target: 'src/a.ts',
        },
      ]),

      candidates: [
        createCandidate('src/server.ts', 50),

        createCandidate('src/z.ts', 20),

        createCandidate('src/a.ts', 20),
      ],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps[1]?.filePath).toBe('src/a.ts');
  });

  it('adds dependency continuity evidence to a connected step', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      candidates: [createCandidate('src/server.ts', 50), createCandidate('src/routes.ts', 30)],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps[1]).toMatchObject({
      order: 2,

      filePath: 'src/routes.ts',

      score: 45,
    });

    expect(result.steps[1]?.signals).toContainEqual({
      kind: 'dependency-of-previous',

      weight: 15,

      description:
        'This file is directly imported by src/server.ts, so reading it next preserves dependency context.',
    });
  });

  it('does not add dependency continuity evidence after a global fallback jump', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      candidates: [
        createCandidate('src/server.ts', 50),

        createCandidate('src/routes.ts', 20),

        createCandidate('src/core.ts', 80),
      ],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/server.ts',
      'src/routes.ts',
      'src/core.ts',
    ]);

    const fallbackStep = result.steps[2];

    expect(fallbackStep?.score).toBe(80);

    expect(fallbackStep?.signals.some((signal) => signal.kind === 'dependency-of-previous')).toBe(
      false,
    );
  });

  it('preserves the candidate signals when adding dependency continuity', () => {
    const routesCandidate: OnboardingCandidate = {
      filePath: 'src/routes.ts',

      score: 40,

      signals: [
        {
          kind: 'high-fan-out',

          weight: 12,

          description: 'Test fan-out signal',
        },
      ],
    };

    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      candidates: [createCandidate('src/server.ts', 50), routesCandidate],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps[1]?.signals).toEqual([
      {
        kind: 'high-fan-out',

        weight: 12,

        description: 'Test fan-out signal',
      },

      {
        kind: 'dependency-of-previous',

        weight: 15,

        description:
          'This file is directly imported by src/server.ts, so reading it next preserves dependency context.',
      },
    ]);
  });

  it('does not revisit files when the dependency graph contains a cycle', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/a.ts',

          target: 'src/b.ts',
        },

        {
          source: 'src/b.ts',

          target: 'src/c.ts',
        },

        {
          source: 'src/c.ts',

          target: 'src/a.ts',
        },
      ]),

      candidates: [
        createCandidate('src/a.ts', 50),

        createCandidate('src/b.ts', 40),

        createCandidate('src/c.ts', 30),
      ],

      entryPoints: [createEntryPoint('src/a.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    expect(new Set(result.steps.map((step) => step.filePath)).size).toBe(3);
  });

  it('continues globally after a cyclic branch is exhausted', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/a.ts',

          target: 'src/b.ts',
        },

        {
          source: 'src/b.ts',

          target: 'src/a.ts',
        },
      ]),

      candidates: [
        createCandidate('src/a.ts', 50),

        createCandidate('src/b.ts', 30),

        createCandidate('src/core.ts', 90),
      ],

      entryPoints: [createEntryPoint('src/a.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/core.ts',
    ]);

    expect(
      result.steps[2]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(false);
  });

  it('ignores graph edges whose source or target is not an onboarding candidate', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/not-a-candidate.ts',
        },

        {
          source: 'src/missing-source.ts',

          target: 'src/core.ts',
        },
      ]),

      candidates: [createCandidate('src/server.ts', 50), createCandidate('src/core.ts', 40)],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/server.ts', 'src/core.ts']);

    expect(
      result.steps[1]?.signals.some((signal) => signal.kind === 'dependency-of-previous'),
    ).toBe(false);
  });

  it('respects an explicit maximum number of steps', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/a.ts',

          target: 'src/b.ts',
        },

        {
          source: 'src/b.ts',

          target: 'src/c.ts',
        },
      ]),

      candidates: [
        createCandidate('src/a.ts', 30),

        createCandidate('src/b.ts', 20),

        createCandidate('src/c.ts', 10),
      ],

      entryPoints: [createEntryPoint('src/a.ts')],

      maxSteps: 2,
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/a.ts', 'src/b.ts']);

    expect(result.maxSteps).toBe(2);

    expect(result.consideredFileCount).toBe(3);
  });

  it('uses the default maximum step count', () => {
    const candidates = Array.from(
      {
        length: 15,
      },
      (_, index) => createCandidate(`src/file-${String(index).padStart(2, '0')}.ts`, 100 - index),
    );

    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates,

      entryPoints: [],
    });

    expect(result.maxSteps).toBe(DEFAULT_ONBOARDING_MAX_STEPS);

    expect(result.steps).toHaveLength(DEFAULT_ONBOARDING_MAX_STEPS);
  });

  it('accepts the maximum allowed step limit', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [createCandidate('src/a.ts', 1)],

      entryPoints: [],

      maxSteps: MAX_ONBOARDING_MAX_STEPS,
    });

    expect(result.maxSteps).toBe(MAX_ONBOARDING_MAX_STEPS);
  });

  it('rejects maxSteps equal to zero', () => {
    expect(() =>
      buildOnboardingPath({
        graphAnalysis: createGraphAnalysis(),

        candidates: [],

        entryPoints: [],

        maxSteps: 0,
      }),
    ).toThrow(`maxSteps must be an integer between 1 and ${MAX_ONBOARDING_MAX_STEPS}`);
  });

  it('rejects maxSteps above the configured maximum', () => {
    expect(() =>
      buildOnboardingPath({
        graphAnalysis: createGraphAnalysis(),

        candidates: [],

        entryPoints: [],

        maxSteps: MAX_ONBOARDING_MAX_STEPS + 1,
      }),
    ).toThrow(`maxSteps must be an integer between 1 and ${MAX_ONBOARDING_MAX_STEPS}`);
  });

  it('rejects fractional maxSteps', () => {
    expect(() =>
      buildOnboardingPath({
        graphAnalysis: createGraphAnalysis(),

        candidates: [],

        entryPoints: [],

        maxSteps: 2.5,
      }),
    ).toThrow(`maxSteps must be an integer between 1 and ${MAX_ONBOARDING_MAX_STEPS}`);
  });

  it('rejects duplicate onboarding candidates', () => {
    expect(() =>
      buildOnboardingPath({
        graphAnalysis: createGraphAnalysis(),

        candidates: [createCandidate('src/core.ts', 50), createCandidate('src/core.ts', 80)],

        entryPoints: [],
      }),
    ).toThrow('Duplicate onboarding candidate for "src/core.ts"');
  });

  it('assigns sequential one-based step ordering', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [
        createCandidate('src/a.ts', 30),

        createCandidate('src/b.ts', 20),

        createCandidate('src/c.ts', 10),
      ],

      entryPoints: [],
    });

    expect(result.steps.map((step) => step.order)).toEqual([1, 2, 3]);
  });

  it('uses lexical ordering for equal-scoring global candidates', () => {
    const result = buildOnboardingPath({
      graphAnalysis: createGraphAnalysis(),

      candidates: [
        createCandidate('src/z.ts', 20),

        createCandidate('src/a.ts', 20),

        createCandidate('src/m.ts', 20),
      ],

      entryPoints: [],
    });

    expect(result.steps.map((step) => step.filePath)).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('does not mutate candidate signal arrays while constructing the path', () => {
    const dependencyCandidate: OnboardingCandidate = {
      filePath: 'src/routes.ts',

      score: 20,

      signals: [
        {
          kind: 'high-fan-out',

          weight: 12,

          description: 'Original signal',
        },
      ],
    };

    buildOnboardingPath({
      graphAnalysis: createGraphAnalysis([
        {
          source: 'src/server.ts',

          target: 'src/routes.ts',
        },
      ]),

      candidates: [createCandidate('src/server.ts', 50), dependencyCandidate],

      entryPoints: [createEntryPoint('src/server.ts')],
    });

    expect(dependencyCandidate.signals).toEqual([
      {
        kind: 'high-fan-out',

        weight: 12,

        description: 'Original signal',
      },
    ]);
  });

  it('returns an empty path for an empty candidate set', () => {
    expect(
      buildOnboardingPath({
        graphAnalysis: createGraphAnalysis(),

        candidates: [],

        entryPoints: [],
      }),
    ).toEqual({
      steps: [],

      consideredFileCount: 0,

      maxSteps: DEFAULT_ONBOARDING_MAX_STEPS,
    });
  });
});
