import { describe, expect, it } from 'vitest';

import { detectEntryPointCandidates } from './entry-point-detector.js';

import type { RepositoryMetrics } from '../metrics/types.js';

interface TestFileInput {
  filePath: string;

  fanIn?: number;

  fanOut?: number;
}

function createMetrics(files: TestFileInput[]): RepositoryMetrics {
  return {
    summary: {
      fileCount: files.length,

      internalDependencyCount: 0,

      externalImportCount: 0,

      unresolvedImportCount: 0,

      cyclicComponentCount: 0,

      cyclicFileCount: 0,

      totalCyclomaticComplexity: files.length,

      averageCyclomaticComplexity: files.length === 0 ? 0 : 1,

      maxCyclomaticComplexity: files.length === 0 ? 0 : 1,

      historyAvailable: false,

      totalChangedCommitCount: null,

      averageChangedCommitCount: null,

      maxChangedCommitCount: null,
    },

    files: files.map((file) => ({
      filePath: file.filePath,

      dependencies: {
        fanIn: file.fanIn ?? 0,

        fanOut: file.fanOut ?? 0,

        transitiveDependencyCount: 0,
      },

      blastRadius: {
        affectedFileCount: 0,

        maxDistance: 0,
      },

      cycles: {
        inDependencyCycle: false,

        cyclicComponentSize: 0,
      },

      structure: {
        importCount: 0,

        functionCount: 0,

        classCount: 0,

        cyclomaticComplexity: 1,

        hasSyntaxErrors: false,
      },

      churn: null,
    })),
  };
}

describe('detectEntryPointCandidates', () => {
  it('detects a dependency root', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/start.ts',

          fanIn: 0,

          fanOut: 3,
        },

        {
          filePath: 'src/service.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),
    );

    expect(result[0]).toMatchObject({
      filePath: 'src/start.ts',

      reasons: ['dependency-root'],
    });
  });

  it('detects a conventional server filename', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 2,

          fanOut: 0,
        },
      ]),
    );

    expect(result[0]).toEqual({
      filePath: 'src/server.ts',

      score: 38,

      reasons: ['conventional-name'],
    });
  });

  it('combines dependency-root and conventional-name signals', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/server.ts',

          fanIn: 0,

          fanOut: 4,
        },
      ]),
    );

    expect(result[0]).toEqual({
      filePath: 'src/server.ts',

      score: 92,

      reasons: ['dependency-root', 'conventional-name'],
    });
  });

  it('prefers main over other conventional filenames when graph evidence is equal', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/index.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/app.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/server.ts',

          fanIn: 1,

          fanOut: 0,
        },

        {
          filePath: 'src/main.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),
    );

    expect(result.map((candidate) => candidate.filePath)).toEqual([
      'src/main.ts',
      'src/server.ts',
      'src/app.ts',
      'src/index.ts',
    ]);
  });

  it('lets strong graph-root evidence outrank a conventional filename', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/startup.ts',

          fanIn: 0,

          fanOut: 8,
        },

        {
          filePath: 'src/index.ts',

          fanIn: 2,

          fanOut: 0,
        },
      ]),
    );

    expect(result[0]?.filePath).toBe('src/startup.ts');

    expect(result[0]?.score).toBe(58);
  });

  it('caps the fan-out bonus at ten points', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/start.ts',

          fanIn: 0,

          fanOut: 100,
        },
      ]),
    );

    expect(result[0]?.score).toBe(60);
  });

  it('does not treat an isolated ordinary file as a dependency root', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/helper.ts',

          fanIn: 0,

          fanOut: 0,
        },

        {
          filePath: 'src/server.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),
    );

    expect(result.some((candidate) => candidate.filePath === 'src/helper.ts')).toBe(false);

    expect(result[0]?.filePath).toBe('src/server.ts');
  });

  it('recognizes conventional names case-insensitively', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/Server.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),
    );

    expect(result[0]).toMatchObject({
      filePath: 'src/Server.ts',

      score: 38,

      reasons: ['conventional-name'],
    });
  });

  it('handles Windows-style file paths when detecting conventional names', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src\\api\\main.ts',

          fanIn: 1,

          fanOut: 0,
        },
      ]),
    );

    expect(result[0]).toMatchObject({
      filePath: 'src\\api\\main.ts',

      score: 40,

      reasons: ['conventional-name'],
    });
  });

  it('uses a deterministic fallback when there are no roots or conventional filenames', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/c.ts',

          fanIn: 2,

          fanOut: 4,
        },

        {
          filePath: 'src/a.ts',

          fanIn: 1,

          fanOut: 2,
        },

        {
          filePath: 'src/b.ts',

          fanIn: 1,

          fanOut: 5,
        },
      ]),
    );

    expect(result).toEqual([
      {
        filePath: 'src/b.ts',

        score: 0,

        reasons: ['fallback'],
      },
    ]);
  });

  it('breaks fallback ties lexically', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/z.ts',

          fanIn: 1,

          fanOut: 3,
        },

        {
          filePath: 'src/a.ts',

          fanIn: 1,

          fanOut: 3,
        },
      ]),
    );

    expect(result).toEqual([
      {
        filePath: 'src/a.ts',

        score: 0,

        reasons: ['fallback'],
      },
    ]);
  });

  it('returns candidates deterministically when scores tie', () => {
    const result = detectEntryPointCandidates(
      createMetrics([
        {
          filePath: 'src/z-start.ts',

          fanIn: 0,

          fanOut: 2,
        },

        {
          filePath: 'src/a-start.ts',

          fanIn: 0,

          fanOut: 2,
        },
      ]),
    );

    expect(result.map((candidate) => candidate.filePath)).toEqual([
      'src/a-start.ts',
      'src/z-start.ts',
    ]);
  });

  it('returns an empty array for an empty repository', () => {
    expect(detectEntryPointCandidates(createMetrics([]))).toEqual([]);
  });
});
