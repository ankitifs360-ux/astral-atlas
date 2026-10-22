import { describe, expect, it } from 'vitest';

import { findUnresolvedImports } from './unresolved-import-rule.js';

describe('findUnresolvedImports', () => {
  it('creates one low-severity finding for one unresolved import', () => {
    const findings = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing-helper',

        reason: 'target-not-found',
      },
    ]);

    expect(findings).toHaveLength(1);

    expect(findings[0]).toMatchObject({
      kind: 'unresolved-imports',

      severity: 'low',

      title: 'Unresolved imports in src/service.ts',

      filePaths: ['src/service.ts'],

      evidence: [
        {
          metric: 'unresolvedImportCount',

          value: 1,
        },

        {
          metric: 'targetNotFoundCount',

          value: 1,
        },

        {
          metric: 'unsupportedSpecifierCount',

          value: 0,
        },
      ],
    });
  });

  it('groups multiple unresolved imports from the same file into one finding', () => {
    const findings = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing-a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/service.ts',

        specifier: './missing-b',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/service.ts',

        specifier: 'virtual:special',

        reason: 'unsupported-specifier',
      },
    ]);

    expect(findings).toHaveLength(1);

    expect(findings[0]?.evidence).toEqual([
      {
        metric: 'unresolvedImportCount',

        value: 3,
      },

      {
        metric: 'targetNotFoundCount',

        value: 2,
      },

      {
        metric: 'unsupportedSpecifierCount',

        value: 1,
      },
    ]);
  });

  it('creates separate findings for different files', () => {
    const findings = findUnresolvedImports([
      {
        filePath: 'src/a.ts',

        specifier: './missing-a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/b.ts',

        specifier: './missing-b',

        reason: 'target-not-found',
      },
    ]);

    expect(findings).toHaveLength(2);

    expect(findings.map((finding) => finding.filePaths[0])).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('counts target-not-found imports separately', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/app.ts',

        specifier: './one',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/app.ts',

        specifier: './two',

        reason: 'target-not-found',
      },
    ])[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'targetNotFoundCount',

      value: 2,
    });

    expect(finding?.evidence).toContainEqual({
      metric: 'unsupportedSpecifierCount',

      value: 0,
    });
  });

  it('counts unsupported specifiers separately', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/app.ts',

        specifier: 'virtual:foo',

        reason: 'unsupported-specifier',
      },

      {
        filePath: 'src/app.ts',

        specifier: 'custom:bar',

        reason: 'unsupported-specifier',
      },
    ])[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'unsupportedSpecifierCount',

      value: 2,
    });

    expect(finding?.evidence).toContainEqual({
      metric: 'targetNotFoundCount',

      value: 0,
    });
  });

  it('uses singular wording for one unresolved import', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing',

        reason: 'target-not-found',
      },
    ])[0];

    expect(finding?.description).toContain('contains 1 import that Astral Atlas could not connect');
  });

  it('uses plural wording for multiple unresolved imports', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing-a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/service.ts',

        specifier: './missing-b',

        reason: 'target-not-found',
      },
    ])[0];

    expect(finding?.description).toContain(
      'contains 2 imports that Astral Atlas could not connect',
    );
  });

  it('explains target-not-found reasons in the description', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing-helper',

        reason: 'target-not-found',
      },
    ])[0];

    expect(finding?.description).toContain(
      './missing-helper: the referenced repository target could not be found',
    );
  });

  it('explains unsupported-specifier reasons in the description', () => {
    const finding = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: 'virtual:generated',

        reason: 'unsupported-specifier',
      },
    ])[0];

    expect(finding?.description).toContain(
      'virtual:generated: the import specifier format is not currently supported',
    );
  });

  it('produces deterministic finding ids', () => {
    const imports = [
      {
        filePath: 'src/service.ts',

        specifier: './missing',

        reason: 'target-not-found' as const,
      },
    ];

    const first = findUnresolvedImports(imports);

    const second = findUnresolvedImports(imports);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('keeps the same finding id when unresolved imports in the same file are reordered', () => {
    const first = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './missing-a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/service.ts',

        specifier: 'virtual:b',

        reason: 'unsupported-specifier',
      },
    ]);

    const second = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: 'virtual:b',

        reason: 'unsupported-specifier',
      },

      {
        filePath: 'src/service.ts',

        specifier: './missing-a',

        reason: 'target-not-found',
      },
    ]);

    expect(first[0]?.id).toBe(second[0]?.id);
  });

  it('returns findings in deterministic file-path order', () => {
    const findings = findUnresolvedImports([
      {
        filePath: 'src/z.ts',

        specifier: './z',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/a.ts',

        specifier: './a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/m.ts',

        specifier: './m',

        reason: 'target-not-found',
      },
    ]);

    expect(findings.map((finding) => finding.filePaths[0])).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('sorts unresolved imports inside the description deterministically', () => {
    const first = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: 'virtual:z',

        reason: 'unsupported-specifier',
      },

      {
        filePath: 'src/service.ts',

        specifier: './a',

        reason: 'target-not-found',
      },
    ]);

    const second = findUnresolvedImports([
      {
        filePath: 'src/service.ts',

        specifier: './a',

        reason: 'target-not-found',
      },

      {
        filePath: 'src/service.ts',

        specifier: 'virtual:z',

        reason: 'unsupported-specifier',
      },
    ]);

    expect(first[0]?.description).toBe(second[0]?.description);
  });

  it('returns no findings when there are no unresolved imports', () => {
    expect(findUnresolvedImports([])).toEqual([]);
  });
});
