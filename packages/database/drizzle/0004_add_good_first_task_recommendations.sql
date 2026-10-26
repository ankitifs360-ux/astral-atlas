ALTER TABLE "analysis_results"
ADD COLUMN "good_first_task_considered_file_count" integer DEFAULT 0 NOT NULL;

ALTER TABLE "analysis_results"
ADD COLUMN "good_first_task_max_recommendations" integer DEFAULT 5 NOT NULL;

ALTER TABLE "analysis_results"
ADD CONSTRAINT "analysis_results_good_first_task_considered_nonnegative"
CHECK ("good_first_task_considered_file_count" >= 0);

ALTER TABLE "analysis_results"
ADD CONSTRAINT "analysis_results_good_first_task_max_positive"
CHECK ("good_first_task_max_recommendations" >= 1);

CREATE TABLE "good_first_task_recommendations" (
  "analysis_id" uuid NOT NULL,
  "recommendation_rank" integer NOT NULL,
  "file_id" uuid NOT NULL,
  "score" integer NOT NULL,
  "architecture_risk_score" integer NOT NULL,
  "signals" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "good_first_task_recommendations_pk"
    PRIMARY KEY ("analysis_id", "recommendation_rank"),

  CONSTRAINT "good_first_task_recommendations_analysis_file_unique"
    UNIQUE ("analysis_id", "file_id"),

  CONSTRAINT "good_first_task_recommendations_rank_positive"
    CHECK ("recommendation_rank" >= 1),

  CONSTRAINT "good_first_task_recommendations_score_range"
    CHECK ("score" >= 0 AND "score" <= 100),

  CONSTRAINT "good_first_task_recommendations_risk_score_range"
    CHECK (
      "architecture_risk_score" >= 0
      AND "architecture_risk_score" <= 100
    )
);

ALTER TABLE "good_first_task_recommendations"
ADD CONSTRAINT "good_first_task_recommendations_analysis_id_analyses_id_fk"
FOREIGN KEY ("analysis_id")
REFERENCES "public"."analyses"("id")
ON DELETE cascade
ON UPDATE no action;

ALTER TABLE "good_first_task_recommendations"
ADD CONSTRAINT "good_first_task_recommendations_file_id_files_id_fk"
FOREIGN KEY ("file_id")
REFERENCES "public"."files"("id")
ON DELETE cascade
ON UPDATE no action;

CREATE INDEX "good_first_task_recommendations_file_idx"
ON "good_first_task_recommendations" USING btree ("file_id");
