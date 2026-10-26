import { sql } from 'drizzle-orm';

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/*
 * ---------------------------------------------------------------------------
 * Enums
 * ---------------------------------------------------------------------------
 */

export const analysisFindingKindEnum = pgEnum('analysis_finding_kind', [
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

export const analysisFindingSeverityEnum = pgEnum('analysis_finding_severity', [
  'low',
  'medium',
  'high',
]);

export const repositoryHealthRatingEnum = pgEnum('repository_health_rating', [
  'excellent',
  'good',
  'fair',
  'poor',
  'critical',
]);

export const repositorySourceEnum = pgEnum('repository_source', ['github', 'zip']);

export const analysisStatusEnum = pgEnum('analysis_status', [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
]);

export const fileParseStatusEnum = pgEnum('file_parse_status', [
  'pending',
  'analyzed',
  'partial',
  'unsupported',
  'error',
]);

export const symbolKindEnum = pgEnum('symbol_kind', [
  'function',
  'class',
  'method',
  'interface',
  'type',
  'enum',
  'variable',
]);

export const edgeTypeEnum = pgEnum('edge_type', ['import', 'call']);

export const issueStateEnum = pgEnum('issue_state', ['open', 'closed']);

/*
 * ---------------------------------------------------------------------------
 * Repositories
 * ---------------------------------------------------------------------------
 */

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    sourceType: repositorySourceEnum('source_type').notNull(),

    /*
     * Examples:
     *
     * github:facebook/react
     * zip:<sha256>
     */
    sourceKey: text('source_key').notNull(),

    githubOwner: varchar('github_owner', {
      length: 255,
    }),

    githubName: varchar('github_name', {
      length: 255,
    }),

    canonicalUrl: text('canonical_url'),

    defaultBranch: varchar('default_branch', {
      length: 255,
    }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('repositories_source_key_unique').on(table.sourceKey),

    index('repositories_source_type_idx').on(table.sourceType),

    index('repositories_github_owner_name_idx').on(table.githubOwner, table.githubName),

    check(
      'repositories_github_metadata_check',
      sql`
          ${table.sourceType} <> 'github'
          OR (
            ${table.githubOwner} IS NOT NULL
            AND ${table.githubName} IS NOT NULL
            AND ${table.canonicalUrl} IS NOT NULL
          )
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Analyses
 * ---------------------------------------------------------------------------
 */

export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    repositoryId: uuid('repository_id')
      .notNull()
      .references(() => repositories.id, {
        onDelete: 'cascade',
      }),

    /*
     * GitHub:
     * exact commit SHA.
     *
     * ZIP:
     * deterministic SHA-256 content revision.
     */
    commitSha: varchar('commit_sha', {
      length: 64,
    }).notNull(),

    status: analysisStatusEnum('status').default('queued').notNull(),

    errorCode: varchar('error_code', {
      length: 64,
    }),

    errorMessage: text('error_message'),

    warningCount: integer('warning_count').default(0).notNull(),

    fileCount: integer('file_count').default(0).notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    startedAt: timestamp('started_at', {
      withTimezone: true,
    }),

    completedAt: timestamp('completed_at', {
      withTimezone: true,
    }),
  },
  (table) => [
    unique('analyses_repository_commit_unique').on(table.repositoryId, table.commitSha),

    index('analyses_repository_idx').on(table.repositoryId),

    index('analyses_status_idx').on(table.status),

    index('analyses_created_at_idx').on(table.createdAt),

    check(
      'analyses_warning_count_nonnegative',
      sql`
          ${table.warningCount} >= 0
        `,
    ),

    check(
      'analyses_file_count_nonnegative',
      sql`
          ${table.fileCount} >= 0
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Files
 * ---------------------------------------------------------------------------
 */

export const files = pgTable(
  'files',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    path: text('path').notNull(),

    language: varchar('language', {
      length: 32,
    }).notNull(),

    sizeBytes: integer('size_bytes').notNull(),

    contentHash: varchar('content_hash', {
      length: 64,
    }),

    /*
     * Source text used by the read-only CodeMirror panel.
     *
     * Nullable so analyses created before this migration
     * remain valid. New B13 analyses will persist it.
     */
    sourceContent: text('source_content'),

    isSupported: boolean('is_supported').default(true).notNull(),

    parseStatus: fileParseStatusEnum('parse_status').default('pending').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('files_analysis_path_unique').on(table.analysisId, table.path),

    index('files_analysis_idx').on(table.analysisId),

    index('files_analysis_language_idx').on(table.analysisId, table.language),

    index('files_parse_status_idx').on(table.parseStatus),

    check(
      'files_size_bytes_nonnegative',
      sql`
          ${table.sizeBytes} >= 0
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Symbols
 * ---------------------------------------------------------------------------
 */

export const symbols = pgTable(
  'symbols',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    kind: symbolKindEnum('kind').notNull(),

    name: text('name').notNull(),

    qualifiedName: text('qualified_name').notNull(),

    /*
     * Lines are 1-based.
     * Columns are 0-based.
     */
    startLine: integer('start_line').notNull(),

    startColumn: integer('start_column').notNull(),

    endLine: integer('end_line').notNull(),

    endColumn: integer('end_column').notNull(),

    isExported: boolean('is_exported').default(false).notNull(),

    complexity: integer('complexity'),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('symbols_file_location_unique').on(
      table.fileId,
      table.kind,
      table.qualifiedName,
      table.startLine,
    ),

    index('symbols_file_idx').on(table.fileId),

    index('symbols_name_idx').on(table.name),

    index('symbols_qualified_name_idx').on(table.qualifiedName),

    check(
      'symbols_start_line_positive',
      sql`
          ${table.startLine} >= 1
        `,
    ),

    check(
      'symbols_end_line_valid',
      sql`
          ${table.endLine} >= ${table.startLine}
        `,
    ),

    check(
      'symbols_start_column_nonnegative',
      sql`
          ${table.startColumn} >= 0
        `,
    ),

    check(
      'symbols_end_column_nonnegative',
      sql`
          ${table.endColumn} >= 0
        `,
    ),

    check(
      'symbols_complexity_positive',
      sql`
          ${table.complexity} IS NULL
          OR ${table.complexity} >= 1
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Per-file metrics
 * ---------------------------------------------------------------------------
 */

export const metrics = pgTable(
  'metrics',
  {
    /*
     * Exactly one metrics record per file.
     */
    fileId: uuid('file_id')
      .primaryKey()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    /*
     * Older / optional source-level metrics.
     */
    loc: integer('loc'),

    tokenCount: integer('token_count'),

    /*
     * B8 structure metrics.
     */
    cyclomaticComplexity: integer('cyclomatic_complexity'),

    importCount: integer('import_count'),

    functionCount: integer('function_count'),

    classCount: integer('class_count'),

    hasSyntaxErrors: boolean('has_syntax_errors'),

    /*
     * Historical churn.
     *
     * churnCommits maps directly to B8
     * changedCommitCount.
     */
    churnAdditions: integer('churn_additions'),

    churnDeletions: integer('churn_deletions'),

    churnCommits: integer('churn_commits'),

    /*
     * B8 dependency metrics.
     */
    fanIn: integer('fan_in'),

    fanOut: integer('fan_out'),

    transitiveDependencyCount: integer('transitive_dependency_count'),

    /*
     * B8 blast-radius metrics.
     *
     * Existing blastRadius stores
     * affectedFileCount.
     */
    blastRadius: integer('blast_radius'),

    blastMaxDistance: integer('blast_max_distance'),

    /*
     * B8 cycle metrics.
     */
    inDependencyCycle: boolean('in_dependency_cycle'),

    cyclicComponentSize: integer('cyclic_component_size'),

    /*
     * Reserved normalized per-file risk score.
     *
     * B10 repository health is persisted
     * separately in analysis_results.
     */
    riskScore: real('risk_score'),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('metrics_risk_score_idx').on(table.riskScore),

    index('metrics_fan_in_idx').on(table.fanIn),

    index('metrics_fan_out_idx').on(table.fanOut),

    index('metrics_blast_radius_idx').on(table.blastRadius),

    check(
      'metrics_loc_nonnegative',
      sql`
          ${table.loc} IS NULL
          OR ${table.loc} >= 0
        `,
    ),

    check(
      'metrics_token_count_nonnegative',
      sql`
          ${table.tokenCount} IS NULL
          OR ${table.tokenCount} >= 0
        `,
    ),

    check(
      'metrics_complexity_positive',
      sql`
          ${table.cyclomaticComplexity} IS NULL
          OR ${table.cyclomaticComplexity} >= 1
        `,
    ),

    check(
      'metrics_import_count_nonnegative',
      sql`
          ${table.importCount} IS NULL
          OR ${table.importCount} >= 0
        `,
    ),

    check(
      'metrics_function_count_nonnegative',
      sql`
          ${table.functionCount} IS NULL
          OR ${table.functionCount} >= 0
        `,
    ),

    check(
      'metrics_class_count_nonnegative',
      sql`
          ${table.classCount} IS NULL
          OR ${table.classCount} >= 0
        `,
    ),

    check(
      'metrics_churn_additions_nonnegative',
      sql`
          ${table.churnAdditions} IS NULL
          OR ${table.churnAdditions} >= 0
        `,
    ),

    check(
      'metrics_churn_deletions_nonnegative',
      sql`
          ${table.churnDeletions} IS NULL
          OR ${table.churnDeletions} >= 0
        `,
    ),

    check(
      'metrics_churn_commits_nonnegative',
      sql`
          ${table.churnCommits} IS NULL
          OR ${table.churnCommits} >= 0
        `,
    ),

    check(
      'metrics_fan_in_nonnegative',
      sql`
          ${table.fanIn} IS NULL
          OR ${table.fanIn} >= 0
        `,
    ),

    check(
      'metrics_fan_out_nonnegative',
      sql`
          ${table.fanOut} IS NULL
          OR ${table.fanOut} >= 0
        `,
    ),

    check(
      'metrics_transitive_dependency_count_nonnegative',
      sql`
          ${table.transitiveDependencyCount} IS NULL
          OR ${table.transitiveDependencyCount} >= 0
        `,
    ),

    check(
      'metrics_blast_radius_nonnegative',
      sql`
          ${table.blastRadius} IS NULL
          OR ${table.blastRadius} >= 0
        `,
    ),

    check(
      'metrics_blast_max_distance_nonnegative',
      sql`
          ${table.blastMaxDistance} IS NULL
          OR ${table.blastMaxDistance} >= 0
        `,
    ),

    check(
      'metrics_cyclic_component_size_nonnegative',
      sql`
          ${table.cyclicComponentSize} IS NULL
          OR ${table.cyclicComponentSize} >= 0
        `,
    ),

    check(
      'metrics_cycle_consistency',
      sql`
          ${table.inDependencyCycle} IS NULL
          OR ${table.cyclicComponentSize} IS NULL
          OR (
            ${table.inDependencyCycle} = true
            AND ${table.cyclicComponentSize} >= 1
          )
          OR (
            ${table.inDependencyCycle} = false
            AND ${table.cyclicComponentSize} = 0
          )
        `,
    ),

    check(
      'metrics_risk_score_range',
      sql`
          ${table.riskScore} IS NULL
          OR (
            ${table.riskScore} >= 0
            AND ${table.riskScore} <= 100
          )
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Repository-level analysis results
 *
 * Stores B8 repository summary + B10 health result +
 * B11 onboarding metadata.
 * ---------------------------------------------------------------------------
 */

export const analysisResults = pgTable(
  'analysis_results',
  {
    analysisId: uuid('analysis_id')
      .primaryKey()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    /*
     * B8 RepositoryMetricSummary.
     *
     * Per-file metrics remain normalized in the
     * metrics table.
     */
    repositorySummary: jsonb('repository_summary').notNull(),

    /*
     * B10 final repository health.
     */
    healthScore: integer('health_score').notNull(),

    healthRating: repositoryHealthRatingEnum('health_rating').notNull(),

    /*
     * Complete B10 dimension breakdown:
     *
     * maintainability
     * change-risk
     * dependency-health
     * coupling
     * resolution-quality
     *
     * Includes explainable deductions.
     */
    healthDimensions: jsonb('health_dimensions').notNull(),

    /*
     * B11 summary information.
     */
    onboardingConsideredFileCount: integer('onboarding_considered_file_count').notNull(),

    onboardingMaxSteps: integer('onboarding_max_steps').notNull(),

    /*
     * B15.5 smart good-first-task recommendation metadata.
     *
     * Defaults preserve compatibility with analyses that
     * were persisted before B15.5 existed.
     */
    goodFirstTaskConsideredFileCount: integer('good_first_task_considered_file_count')
      .default(0)
      .notNull(),

    goodFirstTaskMaxRecommendations: integer('good_first_task_max_recommendations')
      .default(5)
      .notNull(),

    /*
     * B15.6 blast-radius-aware newcomer change guidance metadata.
     *
     * Defaults preserve compatibility with analyses persisted
     * before B15.6 existed.
     */
    newcomerChangeGuidanceConsideredFileCount: integer(
      'newcomer_change_guidance_considered_file_count',
    )
      .default(0)
      .notNull(),

    newcomerChangeGuidanceMaxRecommendations: integer(
      'newcomer_change_guidance_max_recommendations',
    )
      .default(5)
      .notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('analysis_results_health_score_idx').on(table.healthScore),

    index('analysis_results_health_rating_idx').on(table.healthRating),

    check(
      'analysis_results_health_score_range',
      sql`
          ${table.healthScore} >= 0
          AND ${table.healthScore} <= 100
        `,
    ),

    check(
      'analysis_results_onboarding_considered_nonnegative',
      sql`
          ${table.onboardingConsideredFileCount} >= 0
        `,
    ),

    check(
      'analysis_results_onboarding_max_steps_positive',
      sql`
          ${table.onboardingMaxSteps} >= 1
        `,
    ),

    check(
      'analysis_results_good_first_task_considered_nonnegative',
      sql`
          ${table.goodFirstTaskConsideredFileCount} >= 0
        `,
    ),

    check(
      'analysis_results_good_first_task_max_positive',
      sql`
          ${table.goodFirstTaskMaxRecommendations} >= 1
        `,
    ),

    check(
      'analysis_results_newcomer_change_guidance_considered_nonnegative',
      sql`
          ${table.newcomerChangeGuidanceConsideredFileCount} >= 0
        `,
    ),

    check(
      'analysis_results_newcomer_change_guidance_max_positive',
      sql`
          ${table.newcomerChangeGuidanceMaxRecommendations} >= 1
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * B9 Deep-analysis findings
 * ---------------------------------------------------------------------------
 */

export const analysisFindings = pgTable(
  'analysis_findings',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    /*
     * Deterministic B9 finding ID.
     *
     * Example:
     *
     * finding:abc123...
     */
    findingKey: text('finding_key').notNull(),

    kind: analysisFindingKindEnum('kind').notNull(),

    severity: analysisFindingSeverityEnum('severity').notNull(),

    title: text('title').notNull(),

    description: text('description').notNull(),

    /*
     * AnalysisFindingEvidence[].
     */
    evidence: jsonb('evidence').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('analysis_findings_analysis_key_unique').on(table.analysisId, table.findingKey),

    index('analysis_findings_analysis_idx').on(table.analysisId),

    index('analysis_findings_analysis_kind_idx').on(table.analysisId, table.kind),

    index('analysis_findings_analysis_severity_idx').on(table.analysisId, table.severity),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * B9 Finding ↔ File association
 * ---------------------------------------------------------------------------
 */

export const analysisFindingFiles = pgTable(
  'analysis_finding_files',
  {
    findingId: uuid('finding_id')
      .notNull()
      .references(() => analysisFindings.id, {
        onDelete: 'cascade',
      }),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'analysis_finding_files_pk',

      columns: [table.findingId, table.fileId],
    }),

    index('analysis_finding_files_file_idx').on(table.fileId),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * B11 Onboarding path
 * ---------------------------------------------------------------------------
 */

export const onboardingSteps = pgTable(
  'onboarding_steps',
  {
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    /*
     * 1-based reading order.
     */
    stepOrder: integer('step_order').notNull(),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    score: integer('score').notNull(),

    /*
     * OnboardingSignal[].
     */
    signals: jsonb('signals').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'onboarding_steps_pk',

      columns: [table.analysisId, table.stepOrder],
    }),

    unique('onboarding_steps_analysis_file_unique').on(table.analysisId, table.fileId),

    index('onboarding_steps_file_idx').on(table.fileId),

    check(
      'onboarding_steps_order_positive',
      sql`
          ${table.stepOrder} >= 1
        `,
    ),

    check(
      'onboarding_steps_score_nonnegative',
      sql`
          ${table.score} >= 0
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * B15.5 Smart good-first-task recommendations
 * ---------------------------------------------------------------------------
 */

export const goodFirstTaskRecommendations = pgTable(
  'good_first_task_recommendations',
  {
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    /*
     * 1-based recommendation order.
     */
    recommendationRank: integer('recommendation_rank').notNull(),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    /*
     * Normalized beginner-suitability score.
     */
    score: integer('score').notNull(),

    /*
     * Snapshot of the B15.4 architecture risk score
     * used when this recommendation was calculated.
     */
    architectureRiskScore: integer('architecture_risk_score').notNull(),

    /*
     * GoodFirstTaskSignal[].
     */
    signals: jsonb('signals').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'good_first_task_recommendations_pk',

      columns: [table.analysisId, table.recommendationRank],
    }),

    unique('good_first_task_recommendations_analysis_file_unique').on(
      table.analysisId,
      table.fileId,
    ),

    index('good_first_task_recommendations_file_idx').on(table.fileId),

    check(
      'good_first_task_recommendations_rank_positive',
      sql`
          ${table.recommendationRank} >= 1
        `,
    ),

    check(
      'good_first_task_recommendations_score_range',
      sql`
          ${table.score} >= 0
          AND ${table.score} <= 100
        `,
    ),

    check(
      'good_first_task_recommendations_risk_score_range',
      sql`
          ${table.architectureRiskScore} >= 0
          AND ${table.architectureRiskScore} <= 100
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * B15.6 Blast-radius-aware newcomer change guidance
 * ---------------------------------------------------------------------------
 */

export const newcomerChangeGuidanceRecommendations = pgTable(
  'newcomer_change_guidance_recommendations',
  {
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    /*
     * 1-based recommendation order.
     */
    recommendationRank: integer('recommendation_rank').notNull(),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    /*
     * Normalized newcomer change-safety score.
     */
    safetyScore: integer('safety_score').notNull(),

    /*
     * low | medium | high
     */
    riskLevel: varchar('risk_level', {
      length: 16,
    }).notNull(),

    /*
     * Snapshot of blast-radius metrics used when
     * this guidance was calculated.
     */
    blastRadius: integer('blast_radius').notNull(),

    blastMaxDistance: integer('blast_max_distance').notNull(),

    /*
     * Ordered repository-relative file paths that a
     * newcomer should inspect before changing this file.
     */
    reviewFilePaths: jsonb('review_file_paths').notNull(),

    /*
     * NewcomerChangeGuidanceSignal[].
     */
    signals: jsonb('signals').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'newcomer_change_guidance_recommendations_pk',

      columns: [table.analysisId, table.recommendationRank],
    }),

    unique('newcomer_change_guidance_recommendations_analysis_file_unique').on(
      table.analysisId,
      table.fileId,
    ),

    index('newcomer_change_guidance_recommendations_file_idx').on(table.fileId),

    check(
      'newcomer_change_guidance_recommendations_rank_positive',
      sql`
          ${table.recommendationRank} >= 1
        `,
    ),

    check(
      'newcomer_change_guidance_recommendations_safety_score_range',
      sql`
          ${table.safetyScore} >= 0
          AND ${table.safetyScore} <= 100
        `,
    ),

    check(
      'newcomer_change_guidance_recommendations_risk_level_valid',
      sql`
          ${table.riskLevel} IN ('low', 'medium', 'high')
        `,
    ),

    check(
      'newcomer_change_guidance_recommendations_blast_radius_nonnegative',
      sql`
          ${table.blastRadius} >= 0
        `,
    ),

    check(
      'newcomer_change_guidance_recommendations_blast_distance_nonnegative',
      sql`
          ${table.blastMaxDistance} >= 0
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * Graph edges
 * ---------------------------------------------------------------------------
 */

export const edges = pgTable(
  'edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    fromFileId: uuid('from_file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    toFileId: uuid('to_file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    /*
     * Null for file-level imports.
     *
     * Populated for function/method calls.
     */
    fromSymbolId: uuid('from_symbol_id').references(() => symbols.id, {
      onDelete: 'cascade',
    }),

    toSymbolId: uuid('to_symbol_id').references(() => symbols.id, {
      onDelete: 'cascade',
    }),

    type: edgeTypeEnum('type').notNull(),

    weight: integer('weight').default(1).notNull(),

    isDynamic: boolean('is_dynamic').default(false).notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /*
     * PostgreSQL 15+ supports
     * NULLS NOT DISTINCT.
     *
     * Therefore two identical file-level
     * edges with NULL symbol IDs are still
     * considered duplicates.
     */
    unique('edges_identity_unique')
      .on(
        table.analysisId,
        table.fromFileId,
        table.toFileId,
        table.type,
        table.fromSymbolId,
        table.toSymbolId,
      )
      .nullsNotDistinct(),

    index('edges_analysis_type_idx').on(table.analysisId, table.type),

    index('edges_from_file_idx').on(table.fromFileId),

    index('edges_to_file_idx').on(table.toFileId),

    index('edges_from_symbol_idx').on(table.fromSymbolId),

    index('edges_to_symbol_idx').on(table.toSymbolId),

    check(
      'edges_weight_positive',
      sql`
          ${table.weight} >= 1
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * GitHub issues
 * ---------------------------------------------------------------------------
 */

export const issues = pgTable(
  'issues',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => analyses.id, {
        onDelete: 'cascade',
      }),

    issueNumber: integer('issue_number').notNull(),

    title: text('title').notNull(),

    htmlUrl: text('html_url').notNull(),

    state: issueStateEnum('state').notNull(),

    labels: text('labels')
      .array()
      .default(
        sql`
              ARRAY[]::text[]
            `,
      )
      .notNull(),

    isGoodFirstIssue: boolean('is_good_first_issue').default(false).notNull(),

    githubCreatedAt: timestamp('github_created_at', {
      withTimezone: true,
    }),

    githubUpdatedAt: timestamp('github_updated_at', {
      withTimezone: true,
    }),

    fetchedAt: timestamp('fetched_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('issues_analysis_number_unique').on(table.analysisId, table.issueNumber),

    index('issues_analysis_idx').on(table.analysisId),

    index('issues_good_first_idx').on(table.analysisId, table.isGoodFirstIssue),

    check(
      'issues_number_positive',
      sql`
          ${table.issueNumber} >= 1
        `,
    ),
  ],
);

/*
 * ---------------------------------------------------------------------------
 * GitHub issue ↔ file matches
 * ---------------------------------------------------------------------------
 */

export const issueFileMatches = pgTable(
  'issue_file_matches',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, {
        onDelete: 'cascade',
      }),

    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, {
        onDelete: 'cascade',
      }),

    confidence: real('confidence').notNull(),

    reason: text('reason').notNull(),

    createdAt: timestamp('created_at', {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'issue_file_matches_pk',

      columns: [table.issueId, table.fileId],
    }),

    index('issue_file_matches_file_idx').on(table.fileId),

    check(
      'issue_file_matches_confidence_range',
      sql`
          ${table.confidence} >= 0
          AND ${table.confidence} <= 1
        `,
    ),
  ],
);

export { eq } from 'drizzle-orm';
