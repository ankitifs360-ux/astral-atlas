ALTER TABLE "analysis_results"
ADD COLUMN "newcomer_change_guidance_considered_file_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "analysis_results"
ADD COLUMN "newcomer_change_guidance_max_recommendations" integer DEFAULT 5 NOT NULL;

ALTER TABLE "analysis_results"
ADD CONSTRAINT "analysis_results_newcomer_change_guidance_considered_nonnegative"
CHECK ("newcomer_change_guidance_considered_file_count" >= 0);

ALTER TABLE "analysis_results"
ADD CONSTRAINT "analysis_results_newcomer_change_guidance_max_positive"
CHECK ("newcomer_change_guidance_max_recommendations" >= 1);

CREATE TABLE "newcomer_change_guidance_recommendations" (
  "analysis_id" uuid NOT NULL,
  "recommendation_rank" integer NOT NULL,
  "file_id" uuid NOT NULL,
  "safety_score" integer NOT NULL,
  "risk_level" varchar(16) NOT NULL,
  "blast_radius" integer NOT NULL,
  "blast_max_distance" integer NOT NULL,
  "review_file_paths" jsonb NOT NULL,
  "signals" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "newcomer_change_guidance_recommendations_pk"
    PRIMARY KEY ("analysis_id", "recommendation_rank"),

  CONSTRAINT "newcomer_change_guidance_recommendations_analysis_file_unique"
    UNIQUE ("analysis_id", "file_id"),

  CONSTRAINT "newcomer_change_guidance_recommendations_rank_positive"
    CHECK ("recommendation_rank" >= 1),

  CONSTRAINT "newcomer_change_guidance_recommendations_safety_score_range"
    CHECK ("safety_score" >= 0 AND "safety_score" <= 100),

  CONSTRAINT "newcomer_change_guidance_recommendations_risk_level_valid"
    CHECK ("risk_level" IN ('low', 'medium', 'high')),

  CONSTRAINT "newcomer_change_guidance_recommendations_blast_radius_nonnegative"
    CHECK ("blast_radius" >= 0),

  CONSTRAINT "newcomer_change_guidance_recommendations_blast_distance_nonnegative"
    CHECK ("blast_max_distance" >= 0)
);

ALTER TABLE "newcomer_change_guidance_recommendations"
ADD CONSTRAINT "newcomer_change_guidance_recommendations_analysis_id_analyses_id_fk"
FOREIGN KEY ("analysis_id")
REFERENCES "public"."analyses"("id")
ON DELETE cascade
ON UPDATE no action;

ALTER TABLE "newcomer_change_guidance_recommendations"
ADD CONSTRAINT "newcomer_change_guidance_recommendations_file_id_files_id_fk"
FOREIGN KEY ("file_id")
REFERENCES "public"."files"("id")
ON DELETE cascade
ON UPDATE no action;

CREATE INDEX "newcomer_change_guidance_recommendations_file_idx"
ON "newcomer_change_guidance_recommendations" USING btree ("file_id");
