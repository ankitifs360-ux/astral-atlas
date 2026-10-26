export type AnalysisFindingKind =
  | 'dependency-cycle'
  | 'unresolved-imports'
  | 'high-complexity'
  | 'high-churn'
  | 'large-blast-radius'
  | 'high-fan-in'
  | 'high-fan-out'
  | 'hotspot'
  | 'god-file-risk';

export type AnalysisFindingSeverity = 'low' | 'medium' | 'high';

export interface AnalysisFindingEvidence {
  /*
   * Machine-readable metric/evidence name.
   *
   * Examples:
   *
   * cyclomaticComplexity
   * changedCommitCount
   * affectedFileCount
   */
  metric: string;

  /*
   * Actual observed value.
   */
  value: number | string | boolean;

  /*
   * Optional threshold used by the rule.
   *
   * Example:
   *
   * complexity = 18
   * threshold  = 15
   */
  threshold?: number;
}

export interface AnalysisFinding {
  /*
   * Stable deterministic identifier.
   */
  id: string;

  kind: AnalysisFindingKind;

  severity: AnalysisFindingSeverity;

  /*
   * Human-readable short description.
   */
  title: string;

  /*
   * Explanation suitable for the API/frontend.
   *
   * This should explain WHY the finding exists,
   * rather than just repeating the metric value.
   */
  description: string;

  /*
   * Repository files related to the finding.
   *
   * Deterministically sorted.
   */
  filePaths: string[];

  /*
   * Raw facts supporting the finding.
   *
   * Keeping evidence structured makes the
   * result explainable and useful to the UI.
   */
  evidence: AnalysisFindingEvidence[];
}

export interface FileHotspotSignals {
  filePath: string;

  highComplexity: boolean;

  highChurn: boolean;

  largeBlastRadius: boolean;

  highFanIn: boolean;

  inDependencyCycle: boolean;

  /*
   * Number of independent hotspot signals
   * currently active for this file.
   */
  signalCount: number;
}

export interface DeepAnalysisResult {
  findings: AnalysisFinding[];

  hotspots: FileHotspotSignals[];
}
