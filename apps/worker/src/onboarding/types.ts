export type OnboardingSignalKind =
  | 'entry-point'
  | 'high-fan-in'
  | 'high-fan-out'
  | 'large-blast-radius'
  | 'hotspot'
  | 'dependency-cycle'
  | 'dependency-of-previous';

export interface OnboardingSignal {
  kind: OnboardingSignalKind;

  /*
   * Explainable contribution used while ranking
   * candidate files.
   */
  weight: number;

  description: string;
}

export interface OnboardingPathStep {
  /*
   * 1-based reading position.
   *
   * Example:
   *
   * 1 -> read first
   * 2 -> read second
   */
  order: number;

  filePath: string;

  /*
   * Internal deterministic ranking score.
   *
   * Higher means the file was considered more
   * useful for understanding the repository.
   */
  score: number;

  /*
   * Explain why this file was selected.
   */
  signals: OnboardingSignal[];
}

export interface OnboardingPathResult {
  /*
   * Ordered files recommended to a developer.
   */
  steps: OnboardingPathStep[];

  /*
   * Total repository files considered when
   * constructing the path.
   */
  consideredFileCount: number;

  /*
   * Maximum number of steps requested.
   */
  maxSteps: number;
}
