import { describe, expect, it } from 'vitest';

import { findDependencyCycles } from './dependency-cycle-rule.js';

import type { FileDependencyCycle } from '../graph/cycle-detector.js';

function createCycle(id: string, nodeIds: string[], edgeIds: string[]): FileDependencyCycle {
  return {
    id,
    nodeIds,
    edgeIds,
  };
}

describe('findDependencyCycles', () => {
  it('creates a low-severity finding for a self-loop', () => {
    const cycles = [createCycle('cycle:self', ['src/config.ts'], ['edge:self'])];

    const finding = findDependencyCycles(cycles)[0];

    expect(finding).toMatchObject({
      kind: 'dependency-cycle',

      severity: 'low',

      title: 'Self dependency cycle in src/config.ts',

      filePaths: ['src/config.ts'],

      evidence: [
        {
          metric: 'cyclicComponentSize',

          value: 1,
        },

        {
          metric: 'internalCycleEdgeCount',

          value: 1,
        },
      ],
    });
  });

  it('creates a medium finding for a two-file cycle', () => {
    const cycles = [createCycle('cycle:two', ['src/b.ts', 'src/a.ts'], ['edge:a-b', 'edge:b-a'])];

    const finding = findDependencyCycles(cycles)[0];

    expect(finding).toMatchObject({
      severity: 'medium',

      title: 'Dependency cycle involving 2 files',

      filePaths: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('creates a high finding for a three-file cycle', () => {
    const cycles = [
      createCycle(
        'cycle:three',
        ['src/c.ts', 'src/a.ts', 'src/b.ts'],
        ['edge:a-b', 'edge:b-c', 'edge:c-a'],
      ),
    ];

    const finding = findDependencyCycles(cycles)[0];

    expect(finding).toMatchObject({
      severity: 'high',

      title: 'Dependency cycle involving 3 files',

      filePaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
  });

  it('keeps larger cyclic components high severity', () => {
    const cycles = [
      createCycle(
        'cycle:large',
        ['src/d.ts', 'src/c.ts', 'src/b.ts', 'src/a.ts'],
        ['edge:1', 'edge:2', 'edge:3', 'edge:4'],
      ),
    ];

    expect(findDependencyCycles(cycles)[0]?.severity).toBe('high');
  });

  it('reports the number of internal cycle edges', () => {
    const cycles = [
      createCycle(
        'cycle:dense',
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        ['edge:1', 'edge:2', 'edge:3', 'edge:4', 'edge:5'],
      ),
    ];

    const finding = findDependencyCycles(cycles)[0];

    expect(finding?.evidence).toContainEqual({
      metric: 'internalCycleEdgeCount',

      value: 5,
    });
  });

  it('sorts file paths inside a cycle deterministically', () => {
    const cycles = [
      createCycle(
        'cycle:unordered',
        ['src/z.ts', 'src/a.ts', 'src/m.ts'],
        ['edge:1', 'edge:2', 'edge:3'],
      ),
    ];

    expect(findDependencyCycles(cycles)[0]?.filePaths).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ]);
  });

  it('produces the same finding id regardless of node order', () => {
    const first = findDependencyCycles([
      createCycle(
        'cycle:first',
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        ['edge:1', 'edge:2', 'edge:3'],
      ),
    ]);

    const second = findDependencyCycles([
      createCycle(
        'cycle:second',
        ['src/c.ts', 'src/a.ts', 'src/b.ts'],
        ['edge:3', 'edge:1', 'edge:2'],
      ),
    ]);

    expect(first[0]?.id).toBe(second[0]?.id);

    expect(first[0]?.id).toMatch(/^finding:[a-f0-9]{24}$/);
  });

  it('produces different ids for different cycle memberships', () => {
    const findings = findDependencyCycles([
      createCycle('cycle:one', ['src/a.ts', 'src/b.ts'], ['edge:1', 'edge:2']),

      createCycle('cycle:two', ['src/a.ts', 'src/c.ts'], ['edge:3', 'edge:4']),
    ]);

    expect(findings[0]?.id).not.toBe(findings[1]?.id);
  });

  it('returns multiple disconnected cycles in deterministic order', () => {
    const cycles = [
      createCycle('cycle:z', ['src/z.ts'], ['edge:z']),

      createCycle('cycle:m', ['src/m.ts', 'src/n.ts'], ['edge:m-n', 'edge:n-m']),

      createCycle('cycle:a', ['src/b.ts', 'src/a.ts'], ['edge:a-b', 'edge:b-a']),
    ];

    const findings = findDependencyCycles(cycles);

    expect(findings.map((finding) => finding.filePaths)).toEqual([
      ['src/a.ts', 'src/b.ts'],

      ['src/m.ts', 'src/n.ts'],

      ['src/z.ts'],
    ]);
  });

  it('explains strongly connected multi-file cycles', () => {
    const cycles = [
      createCycle(
        'cycle:three',
        ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        ['edge:1', 'edge:2', 'edge:3'],
      ),
    ];

    const finding = findDependencyCycles(cycles)[0];

    expect(finding?.description).toContain('strongly connected dependency component');

    expect(finding?.description).toContain('tight coupling');
  });

  it('explains self-dependency separately', () => {
    const cycles = [createCycle('cycle:self', ['src/config.ts'], ['edge:self'])];

    expect(findDependencyCycles(cycles)[0]?.description).toContain('depends on itself');
  });

  it('returns no findings when there are no cycles', () => {
    expect(findDependencyCycles([])).toEqual([]);
  });

  it('defensively ignores an invalid empty cycle', () => {
    const cycles = [createCycle('cycle:invalid', [], [])];

    expect(findDependencyCycles(cycles)).toEqual([]);
  });
});
