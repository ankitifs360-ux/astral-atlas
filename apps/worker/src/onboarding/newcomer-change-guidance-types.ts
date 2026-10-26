export type NewcomerChangeRiskLevel = 'low' | 'medium' | 'high';

export type NewcomerChangeGuidanceSignalKind =
  'blast-radius' | 'blast-distance' | 'dependency-cycle' | 'fan-in' | 'architecture-risk';

export interface NewcomerChangeGuidanceSignal {
  kind: NewcomerChangeGuidanceSignalKind;

  /*
   * Human-readable explanation of why this signal
   * affects newcomer change safety.
   */
  description: string;
}

export interface NewcomerChangeGuidanceRecommendation {
  filePath: string;

  /*
   * Normalized safety score for making a newcomer change.
   *
   * 0   -> very risky change surface
   * 100 -> highly contained change surface
   */
  safetyScore: number;

  riskLevel: NewcomerChangeRiskLevel;

  /*
   * Number of files that may be transitively affected
   * by changes to this file.
   */
  blastRadius: number;

  /*
   * Furthest dependency distance reached by the
   * blast-radius traversal.
   */
  blastMaxDistance: number;

  /*
   * Small ordered set of affected files that a newcomer
   * should inspect before changing this file.
   */
  reviewFilePaths: string[];

  /*
   * Explain why this change surface received its
   * safety score and risk level.
   */
  signals: NewcomerChangeGuidanceSignal[];
}

export interface NewcomerChangeGuidanceResult {
  recommendations: NewcomerChangeGuidanceRecommendation[];

  /*
   * Number of analyzed files considered for guidance.
   */
  consideredFileCount: number;

  /*
   * Maximum number of guidance recommendations requested.
   */
  maxRecommendations: number;
}
