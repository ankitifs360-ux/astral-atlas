CREATE TYPE "public"."analysis_finding_kind" AS ENUM(
  'dependency-cycle',
  'unresolved-imports',
  'high-complexity',
  'high-churn',
  'large-blast-radius',
  'high-fan-in',
  'high-fan-out',
  'hotspot'
);--> statement-breakpoint

CREATE TYPE "public"."analysis_finding_severity" AS ENUM(
  'low',
  'medium',
  'high'
);--> statement-breakpoint

CREATE TYPE "public"."repository_health_rating" AS ENUM(
  'excellent',
  'good',
  'fair',
  'poor',
  'critical'
);--> statement-breakpoint

CREATE TABLE "analysis_finding_files" (
  "finding_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analysis_finding_files_pk"
    PRIMARY KEY("finding_id", "file_id")
);--> statement-breakpoint

CREATE TABLE "analysis_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "analysis_id" uuid NOT NULL,
  "finding_key" text NOT NULL,
  "kind" "analysis_finding_kind" NOT NULL,
  "severity" "analysis_finding_severity" NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "evidence" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "analysis_findings_analysis_key_unique"
    UNIQUE("analysis_id", "finding_key")
);--> statement-breakpoint

CREATE TABLE "analysis_results" (
  "analysis_id" uuid PRIMARY KEY NOT NULL,
  "repository_summary" jsonb NOT NULL,
  "health_score" integer NOT NULL,
  "health_rating" "repository_health_rating" NOT NULL,
  "health_dimensions" jsonb NOT NULL,
  "onboarding_considered_file_count" integer NOT NULL,
  "onboarding_max_steps" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "analysis_results_health_score_range"
    CHECK (
      "analysis_results"."health_score" >= 0
      AND "analysis_results"."health_score" <= 100
    ),

  CONSTRAINT "analysis_results_onboarding_considered_nonnegative"
    CHECK (
      "analysis_results"."onboarding_considered_file_count" >= 0
    ),

  CONSTRAINT "analysis_results_onboarding_max_steps_positive"
    CHECK (
      "analysis_results"."onboarding_max_steps" >= 1
    )
);--> statement-breakpoint

CREATE TABLE "onboarding_steps" (
  "analysis_id" uuid NOT NULL,
  "step_order" integer NOT NULL,
  "file_id" uuid NOT NULL,
  "score" integer NOT NULL,
  "signals" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "onboarding_steps_pk"
    PRIMARY KEY("analysis_id", "step_order"),

  CONSTRAINT "onboarding_steps_analysis_file_unique"
    UNIQUE("analysis_id", "file_id"),

  CONSTRAINT "onboarding_steps_order_positive"
    CHECK (
      "onboarding_steps"."step_order" >= 1
    ),

  CONSTRAINT "onboarding_steps_score_nonnegative"
    CHECK (
      "onboarding_steps"."score" >= 0
    )
);--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "import_count" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "function_count" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "class_count" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "has_syntax_errors" boolean;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "fan_in" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "fan_out" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "transitive_dependency_count" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "blast_max_distance" integer;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "in_dependency_cycle" boolean;--> statement-breakpoint

ALTER TABLE "metrics"
  ADD COLUMN "cyclic_component_size" integer;--> statement-breakpoint

ALTER TABLE "analysis_finding_files"
  ADD CONSTRAINT "analysis_finding_files_finding_id_analysis_findings_id_fk"
  FOREIGN KEY ("finding_id")
  REFERENCES "public"."analysis_findings"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "analysis_finding_files"
  ADD CONSTRAINT "analysis_finding_files_file_id_files_id_fk"
  FOREIGN KEY ("file_id")
  REFERENCES "public"."files"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "analysis_findings"
  ADD CONSTRAINT "analysis_findings_analysis_id_analyses_id_fk"
  FOREIGN KEY ("analysis_id")
  REFERENCES "public"."analyses"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "analysis_results"
  ADD CONSTRAINT "analysis_results_analysis_id_analyses_id_fk"
  FOREIGN KEY ("analysis_id")
  REFERENCES "public"."analyses"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "onboarding_steps"
  ADD CONSTRAINT "onboarding_steps_analysis_id_analyses_id_fk"
  FOREIGN KEY ("analysis_id")
  REFERENCES "public"."analyses"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "onboarding_steps"
  ADD CONSTRAINT "onboarding_steps_file_id_files_id_fk"
  FOREIGN KEY ("file_id")
  REFERENCES "public"."files"("id")
  ON DELETE cascade
  ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "analysis_finding_files_file_idx"
  ON "analysis_finding_files"
  USING btree ("file_id");--> statement-breakpoint

CREATE INDEX "analysis_findings_analysis_idx"
  ON "analysis_findings"
  USING btree ("analysis_id");--> statement-breakpoint

CREATE INDEX "analysis_findings_analysis_kind_idx"
  ON "analysis_findings"
  USING btree ("analysis_id", "kind");--> statement-breakpoint

CREATE INDEX "analysis_findings_analysis_severity_idx"
  ON "analysis_findings"
  USING btree ("analysis_id", "severity");--> statement-breakpoint

CREATE INDEX "analysis_results_health_score_idx"
  ON "analysis_results"
  USING btree ("health_score");--> statement-breakpoint

CREATE INDEX "analysis_results_health_rating_idx"
  ON "analysis_results"
  USING btree ("health_rating");--> statement-breakpoint

CREATE INDEX "onboarding_steps_file_idx"
  ON "onboarding_steps"
  USING btree ("file_id");--> statement-breakpoint

CREATE INDEX "metrics_fan_in_idx"
  ON "metrics"
  USING btree ("fan_in");--> statement-breakpoint

CREATE INDEX "metrics_fan_out_idx"
  ON "metrics"
  USING btree ("fan_out");--> statement-breakpoint

CREATE INDEX "metrics_blast_radius_idx"
  ON "metrics"
  USING btree ("blast_radius");--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_import_count_nonnegative"
  CHECK (
    "metrics"."import_count" IS NULL
    OR "metrics"."import_count" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_function_count_nonnegative"
  CHECK (
    "metrics"."function_count" IS NULL
    OR "metrics"."function_count" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_class_count_nonnegative"
  CHECK (
    "metrics"."class_count" IS NULL
    OR "metrics"."class_count" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_fan_in_nonnegative"
  CHECK (
    "metrics"."fan_in" IS NULL
    OR "metrics"."fan_in" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_fan_out_nonnegative"
  CHECK (
    "metrics"."fan_out" IS NULL
    OR "metrics"."fan_out" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_transitive_dependency_count_nonnegative"
  CHECK (
    "metrics"."transitive_dependency_count" IS NULL
    OR "metrics"."transitive_dependency_count" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_blast_max_distance_nonnegative"
  CHECK (
    "metrics"."blast_max_distance" IS NULL
    OR "metrics"."blast_max_distance" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_cyclic_component_size_nonnegative"
  CHECK (
    "metrics"."cyclic_component_size" IS NULL
    OR "metrics"."cyclic_component_size" >= 0
  );--> statement-breakpoint

ALTER TABLE "metrics"
  ADD CONSTRAINT "metrics_cycle_consistency"
  CHECK (
    "metrics"."in_dependency_cycle" IS NULL
    OR "metrics"."cyclic_component_size" IS NULL
    OR (
      "metrics"."in_dependency_cycle" = true
      AND "metrics"."cyclic_component_size" >= 1
    )
    OR (
      "metrics"."in_dependency_cycle" = false
      AND "metrics"."cyclic_component_size" = 0
    )
  );