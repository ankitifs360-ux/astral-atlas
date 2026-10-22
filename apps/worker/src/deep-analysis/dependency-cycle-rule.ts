import { createFindingId } from './finding-utils.js';

import type { AnalysisFinding, AnalysisFindingSeverity } from './types.js';

import type { FileDependencyCycle } from '../graph/cycle-detector.js';

function determineCycleSeverity(componentSize: number): AnalysisFindingSeverity {
  /*
   * A self-loop is still a real dependency cycle,
   * but it is more localized than a multi-file
   * architectural cycle.
   */
  if (componentSize === 1) {
    return 'low';
  }

  /*
   * Two-file cycles are important but relatively
   * contained.
   */
  if (componentSize === 2) {
    return 'medium';
  }

  /*
   * Three or more mutually dependent files usually
   * indicate a broader architectural coupling issue.
   */
  return 'high';
}

export function findDependencyCycles(cycles: readonly FileDependencyCycle[]): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];

  for (const cycle of cycles) {
    const filePaths = [...cycle.nodeIds].sort();

    const componentSize = filePaths.length;

    /*
     * Defensive guard.
     *
     * A valid dependency cycle can never contain
     * zero nodes.
     */
    if (componentSize === 0) {
      continue;
    }

    const severity = determineCycleSeverity(componentSize);

    const fileDescription = componentSize === 1 ? filePaths[0] : `${componentSize} files`;

    findings.push({
      id: createFindingId('dependency-cycle', filePaths),

      kind: 'dependency-cycle',

      severity,

      title:
        componentSize === 1
          ? `Self dependency cycle in ${filePaths[0]}`
          : `Dependency cycle involving ${componentSize} files`,

      description:
        componentSize === 1
          ? `${filePaths[0]} directly or indirectly depends on itself. Self-dependencies can make module boundaries harder to reason about and may indicate an import-structure problem.`
          : `${fileDescription} form a strongly connected dependency component, meaning every file in this group can eventually reach every other file through imports. This creates tight coupling and can make refactoring, testing, and change isolation more difficult.`,

      filePaths,

      evidence: [
        {
          metric: 'cyclicComponentSize',

          value: componentSize,
        },

        {
          metric: 'internalCycleEdgeCount',

          value: cycle.edgeIds.length,
        },
      ],
    });
  }

  return findings.sort((left, right) => {
    const leftPaths = left.filePaths.join('\0');

    const rightPaths = right.filePaths.join('\0');

    return leftPaths.localeCompare(rightPaths);
  });
}
