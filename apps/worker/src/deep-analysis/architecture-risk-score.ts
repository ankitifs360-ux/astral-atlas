import { DEFAULT_SEVERITY_WEIGHTS, getSeverityWeight } from '../health-score/normalization.js';

import type { AnalysisFinding } from './types.js';

export interface FileArchitectureRiskScore {
  filePath: string;

  riskScore: number;
}

const ARCHITECTURE_RISK_FINDING_KINDS = new Set<AnalysisFinding['kind']>([
  'dependency-cycle',
  'unresolved-imports',
  'high-complexity',
  'high-churn',
  'large-blast-radius',
  'high-fan-in',
  'high-fan-out',
  'hotspot',
  'god-file-risk',
]);

function calculateCombinedRisk(findings: readonly AnalysisFinding[]): number {
  let remainingSafety = 1;

  for (const finding of findings) {
    const weight = getSeverityWeight(finding.severity, DEFAULT_SEVERITY_WEIGHTS);

    remainingSafety *= 1 - weight;
  }

  return Math.round((1 - remainingSafety) * 100);
}

export function calculateFileArchitectureRiskScores(
  filePaths: readonly string[],

  findings: readonly AnalysisFinding[],
): FileArchitectureRiskScore[] {
  const findingsByFile = new Map<string, AnalysisFinding[]>();

  for (const filePath of filePaths) {
    findingsByFile.set(filePath, []);
  }

  for (const finding of findings) {
    if (!ARCHITECTURE_RISK_FINDING_KINDS.has(finding.kind)) {
      continue;
    }

    for (const filePath of finding.filePaths) {
      const fileFindings = findingsByFile.get(filePath);

      if (fileFindings === undefined) {
        continue;
      }

      fileFindings.push(finding);
    }
  }

  return [...findingsByFile.entries()]
    .map(([filePath, fileFindings]) => ({
      filePath,

      riskScore: calculateCombinedRisk(fileFindings),
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));
}
