export type GoodFirstTaskSignalKind =
  | 'architecture-risk'
  | 'cyclomatic-complexity'
  | 'fan-out'
  | 'blast-radius'
  | 'dependency-cycle'
  | 'useful-context';

export type GoodFirstTaskSignalImpact = 'bonus' | 'penalty';

export interface GoodFirstTaskSignal {
  kind: GoodFirstTaskSignalKind;

  impact: GoodFirstTaskSignalImpact;

  /*
   * Absolute number of points contributed by
   * this signal.
   *
   * The impact field determines whether those
   * points are added or deducted.
   */
  points: number;

  description: string;
}

export interface GoodFirstTaskRecommendation {
  filePath: string;

  /*
   * Normalized beginner-suitability score.
   *
   * 0   -> very risky as a first contribution
   * 100 -> highly suitable as a first contribution
   */
  score: number;

  /*
   * B15.4 normalized architecture risk used when
   * evaluating this candidate.
   */
  architectureRiskScore: number;

  /*
   * Explain why this file received its score.
   */
  signals: GoodFirstTaskSignal[];
}

export interface GoodFirstTaskResult {
  recommendations: GoodFirstTaskRecommendation[];

  /*
   * Number of analyzed files considered.
   */
  consideredFileCount: number;

  /*
   * Maximum number of recommendations requested.
   */
  maxRecommendations: number;
}
