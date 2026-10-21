CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."edge_type" AS ENUM('import', 'call');--> statement-breakpoint
CREATE TYPE "public"."file_parse_status" AS ENUM('pending', 'analyzed', 'partial', 'unsupported', 'error');--> statement-breakpoint
CREATE TYPE "public"."issue_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."repository_source" AS ENUM('github', 'zip');--> statement-breakpoint
CREATE TYPE "public"."symbol_kind" AS ENUM('function', 'class', 'method', 'interface', 'type', 'enum', 'variable');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "analyses_repository_commit_unique" UNIQUE("repository_id","commit_sha"),
	CONSTRAINT "analyses_warning_count_nonnegative" CHECK ("analyses"."warning_count" >= 0),
	CONSTRAINT "analyses_file_count_nonnegative" CHECK ("analyses"."file_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"from_file_id" uuid NOT NULL,
	"to_file_id" uuid NOT NULL,
	"from_symbol_id" uuid,
	"to_symbol_id" uuid,
	"type" "edge_type" NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"is_dynamic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edges_identity_unique" UNIQUE NULLS NOT DISTINCT("analysis_id","from_file_id","to_file_id","type","from_symbol_id","to_symbol_id"),
	CONSTRAINT "edges_weight_positive" CHECK ("edges"."weight" >= 1)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" varchar(32) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" varchar(64),
	"is_supported" boolean DEFAULT true NOT NULL,
	"parse_status" "file_parse_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_analysis_path_unique" UNIQUE("analysis_id","path"),
	CONSTRAINT "files_size_bytes_nonnegative" CHECK ("files"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "issue_file_matches" (
	"issue_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_file_matches_pk" PRIMARY KEY("issue_id","file_id"),
	CONSTRAINT "issue_file_matches_confidence_range" CHECK ("issue_file_matches"."confidence" >= 0 AND "issue_file_matches"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"html_url" text NOT NULL,
	"state" "issue_state" NOT NULL,
	"labels" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"is_good_first_issue" boolean DEFAULT false NOT NULL,
	"github_created_at" timestamp with time zone,
	"github_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issues_analysis_number_unique" UNIQUE("analysis_id","issue_number"),
	CONSTRAINT "issues_number_positive" CHECK ("issues"."issue_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "metrics" (
	"file_id" uuid PRIMARY KEY NOT NULL,
	"loc" integer,
	"token_count" integer,
	"cyclomatic_complexity" integer,
	"churn_additions" integer,
	"churn_deletions" integer,
	"churn_commits" integer,
	"blast_radius" integer,
	"risk_score" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_loc_nonnegative" CHECK ("metrics"."loc" IS NULL OR "metrics"."loc" >= 0),
	CONSTRAINT "metrics_token_count_nonnegative" CHECK ("metrics"."token_count" IS NULL OR "metrics"."token_count" >= 0),
	CONSTRAINT "metrics_complexity_positive" CHECK (
        "metrics"."cyclomatic_complexity" IS NULL
        OR "metrics"."cyclomatic_complexity" >= 1
      ),
	CONSTRAINT "metrics_churn_additions_nonnegative" CHECK ("metrics"."churn_additions" IS NULL OR "metrics"."churn_additions" >= 0),
	CONSTRAINT "metrics_churn_deletions_nonnegative" CHECK ("metrics"."churn_deletions" IS NULL OR "metrics"."churn_deletions" >= 0),
	CONSTRAINT "metrics_churn_commits_nonnegative" CHECK ("metrics"."churn_commits" IS NULL OR "metrics"."churn_commits" >= 0),
	CONSTRAINT "metrics_blast_radius_nonnegative" CHECK ("metrics"."blast_radius" IS NULL OR "metrics"."blast_radius" >= 0),
	CONSTRAINT "metrics_risk_score_range" CHECK (
        "metrics"."risk_score" IS NULL
        OR ("metrics"."risk_score" >= 0 AND "metrics"."risk_score" <= 100)
      )
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "repository_source" NOT NULL,
	"source_key" text NOT NULL,
	"github_owner" varchar(255),
	"github_name" varchar(255),
	"canonical_url" text,
	"default_branch" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repositories_source_key_unique" UNIQUE("source_key"),
	CONSTRAINT "repositories_github_metadata_check" CHECK (
        "repositories"."source_type" <> 'github'
        OR (
          "repositories"."github_owner" IS NOT NULL
          AND "repositories"."github_name" IS NOT NULL
          AND "repositories"."canonical_url" IS NOT NULL
        )
      )
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" "symbol_kind" NOT NULL,
	"name" text NOT NULL,
	"qualified_name" text NOT NULL,
	"start_line" integer NOT NULL,
	"start_column" integer NOT NULL,
	"end_line" integer NOT NULL,
	"end_column" integer NOT NULL,
	"is_exported" boolean DEFAULT false NOT NULL,
	"complexity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symbols_file_location_unique" UNIQUE("file_id","kind","qualified_name","start_line"),
	CONSTRAINT "symbols_start_line_positive" CHECK ("symbols"."start_line" >= 1),
	CONSTRAINT "symbols_end_line_valid" CHECK ("symbols"."end_line" >= "symbols"."start_line"),
	CONSTRAINT "symbols_start_column_nonnegative" CHECK ("symbols"."start_column" >= 0),
	CONSTRAINT "symbols_end_column_nonnegative" CHECK ("symbols"."end_column" >= 0),
	CONSTRAINT "symbols_complexity_positive" CHECK ("symbols"."complexity" IS NULL OR "symbols"."complexity" >= 1)
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_from_file_id_files_id_fk" FOREIGN KEY ("from_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_to_file_id_files_id_fk" FOREIGN KEY ("to_file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_from_symbol_id_symbols_id_fk" FOREIGN KEY ("from_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_to_symbol_id_symbols_id_fk" FOREIGN KEY ("to_symbol_id") REFERENCES "public"."symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_file_matches" ADD CONSTRAINT "issue_file_matches_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_file_matches" ADD CONSTRAINT "issue_file_matches_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbols" ADD CONSTRAINT "symbols_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_repository_idx" ON "analyses" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "analyses_status_idx" ON "analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analyses_created_at_idx" ON "analyses" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "edges_analysis_type_idx" ON "edges" USING btree ("analysis_id","type");--> statement-breakpoint
CREATE INDEX "edges_from_file_idx" ON "edges" USING btree ("from_file_id");--> statement-breakpoint
CREATE INDEX "edges_to_file_idx" ON "edges" USING btree ("to_file_id");--> statement-breakpoint
CREATE INDEX "edges_from_symbol_idx" ON "edges" USING btree ("from_symbol_id");--> statement-breakpoint
CREATE INDEX "edges_to_symbol_idx" ON "edges" USING btree ("to_symbol_id");--> statement-breakpoint
CREATE INDEX "files_analysis_idx" ON "files" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "files_analysis_language_idx" ON "files" USING btree ("analysis_id","language");--> statement-breakpoint
CREATE INDEX "files_parse_status_idx" ON "files" USING btree ("parse_status");--> statement-breakpoint
CREATE INDEX "issue_file_matches_file_idx" ON "issue_file_matches" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "issues_analysis_idx" ON "issues" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "issues_good_first_idx" ON "issues" USING btree ("analysis_id","is_good_first_issue");--> statement-breakpoint
CREATE INDEX "metrics_risk_score_idx" ON "metrics" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "repositories_source_type_idx" ON "repositories" USING btree ("source_type");--> statement-breakpoint
CREATE INDEX "repositories_github_owner_name_idx" ON "repositories" USING btree ("github_owner","github_name");--> statement-breakpoint
CREATE INDEX "symbols_file_idx" ON "symbols" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "symbols_name_idx" ON "symbols" USING btree ("name");--> statement-breakpoint
CREATE INDEX "symbols_qualified_name_idx" ON "symbols" USING btree ("qualified_name");