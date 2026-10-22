export type HealthScoreDimension =
  'maintainability' | 'change-risk' | 'dependency-health' | 'coupling' | 'resolution-quality';

export interface HealthScoreDeduction {
  /*
   * Stable machine-readable reason.
   *
   * Examples:
   *
   * high-complexity
   * dependency-cycle
   * hotspot
   */
  reason: string;

  /*
   * Human-readable explanation that can later
   * be shown directly in the UI.
   */
  description: string;

  /*
   * Number of health points removed from this
   * dimension.
   *
   * Always positive.
   */
  points: number;

  /*
   * Files associated with this deduction.
   *
   * Repository-wide deductions may use [].
   */
  filePaths: string[];
}

export interface HealthScoreDimensionResult {
  dimension: HealthScoreDimension;

  /*
   * Maximum contribution this dimension can make
   * to the repository health score.
   */
  maxScore: number;

  /*
   * Remaining points after deductions.
   *
   * Always:
   *
   * 0 <= score <= maxScore
   */
  score: number;

  /*
   * Helpful for the API/UI so consumers do not
   * need to calculate it themselves.
   */
  deductedPoints: number;

  deductions: HealthScoreDeduction[];
}

export type RepositoryHealthRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface RepositoryHealthScore {
  /*
   * Final normalized repository score.
   *
   * 0 = extremely unhealthy
   * 100 = excellent health
   */
  score: number;

  rating: RepositoryHealthRating;

  /*
   * Individual explainable score components.
   */
  dimensions: HealthScoreDimensionResult[];

  /*
   * Number of files considered while calculating
   * the health score.
   */
  analyzedFileCount: number;
}
