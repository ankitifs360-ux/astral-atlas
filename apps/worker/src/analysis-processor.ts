import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  ANALYSIS_JOB_NAME,
  ANALYSIS_JOB_SCHEMA_VERSION,
  type AnalysisJobData,
  type AnalysisJobResult,
  type AnalysisProgress,
} from '@astral-atlas/shared';

import { UnrecoverableError } from 'bullmq';
import { z } from 'zod';

import type { Redis } from 'ioredis';

import { acquireAnalysisLock, ANALYSIS_LOCK_RENEW_INTERVAL_MS } from './analysis-lock.js';

import { calculateFileArchitectureRiskScores } from './deep-analysis/architecture-risk-score.js';
import { analyzeRepositoryDeeply } from './deep-analysis/repository-deep-analysis.js';

import { buildRepositoryGraph } from './graph/repository-graph.js';

import { calculateRepositoryHealthScore } from './health-score/repository-health-score.js';

import {
  createChurnInputsFromGitHistory,
  type GitHistoryFileTouch,
} from './metrics/git-history-churn.js';

import { calculateRepositoryMetrics } from './metrics/repository-metrics.js';

import { scoreGoodFirstTasks } from './onboarding/good-first-task-scorer.js';
import { scoreNewcomerChangeGuidance } from './onboarding/newcomer-change-guidance-scorer.js';
import { buildRepositoryOnboardingPath } from './onboarding/repository-onboarding.js';

import { ParserThreadPool } from './parsing/parser-thread-pool.js';

import { parseRepositoryFiles } from './parsing/repository-parser.js';

import {
  scanRepositorySourceFiles,
  type WorkerRepositorySkippedFile,
  type WorkerRepositorySourceFile,
} from './parsing/repository-source-files.js';

import type { ParseSourceResult } from './parsing/types.js';

import type { AnalysisStore } from './persistence/analysis-store.js';

import type { PersistAnalysisSymbolInput } from './persistence/symbol-persistence.js';

import type { PersistAnalysisFileInput } from './persistence/types.js';

import { resolveRepositoryFunctionCalls } from './resolution/repository-function-call-resolver.js';

import {
  getAnalysisSourceRevision,
  type AnalysisSourcePreparer,
} from './repository-source-preparer.js';

import type { AnalysisJob, AnalysisJobProcessor } from './analysis-worker.js';

const GitHubAnalysisSourceSchema = z
  .object({
    sourceType: z.literal('github'),

    owner: z.string().min(1).max(39),

    repo: z.string().min(1).max(100),

    canonicalUrl: z.string().url(),

    sourceKey: z.string().min(1),

    commitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/i, 'Git commit SHA must contain exactly 40 hexadecimal characters.'),
  })
  .strict();

const ZipAnalysisSourceSchema = z
  .object({
    sourceType: z.literal('zip'),

    sourceKey: z.string().min(1),

    contentSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'ZIP SHA-256 must contain exactly 64 hexadecimal characters.'),

    archivePath: z.string().min(1),
  })
  .strict();

const AnalysisJobDataSchema = z
  .object({
    schemaVersion: z.literal(ANALYSIS_JOB_SCHEMA_VERSION),

    analysisId: z.string().uuid(),

    repositoryId: z.string().uuid(),

    source: z.discriminatedUnion('sourceType', [
      GitHubAnalysisSourceSchema,
      ZipAnalysisSourceSchema,
    ]),
  })
  .strict();

interface SourceSnapshot {
  sourceContent: string;

  contentHash: string;
}

interface ParserSkippedFile {
  filePath: string;

  reason: 'unsupported-language' | 'too-large';
}

export interface AnalysisProcessorDependencies {
  /*
   * Expensive Git checkout / ZIP extraction.
   *
   * The processor owns the returned repository
   * until cleanup() is called.
   */
  sourcePreparer: AnalysisSourcePreparer;

  /*
   * Completed analysis persistence.
   *
   * getCompletedById() provides retry idempotency:
   * if a previous attempt committed successfully but
   * BullMQ retried afterwards, we do not redo the heavy work.
   */
  analysisStore: Pick<AnalysisStore, 'getCompletedById' | 'put'>;

  /*
   * Tests can inject a lightweight parser pool.
   *
   * Production uses the real worker_threads pool.
   */
  parserPoolFactory?: () => ParserThreadPool;

  /*
   * Optional bounded Git-history collector.
   *
   * ZIP repositories have no Git history.
   *
   * When this dependency is absent, churn remains
   * explicitly unavailable rather than pretending
   * unknown history means zero churn.
   */
  loadGitHistoryTouches?: (repositoryDirectory: string) => Promise<readonly GitHistoryFileTouch[]>;
}

function validateJobData(data: unknown): AnalysisJobData {
  const result = AnalysisJobDataSchema.safeParse(data);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const field = issue.path.join('.') || 'job';

        return `${field}: ${issue.message}`;
      })
      .join('; ');

    throw new UnrecoverableError(`Invalid analysis job data: ${details}`);
  }

  return result.data;
}

function validateAnalysisJob(job: AnalysisJob): AnalysisJobData {
  /*
   * The queue should contain only one job type.
   *
   * A malformed/old job name will never become valid
   * simply by retrying it.
   */
  if (job.name !== ANALYSIS_JOB_NAME) {
    throw new UnrecoverableError(`Unsupported analysis job name: ${job.name}`);
  }

  return validateJobData(job.data);
}

async function reportProgress(job: AnalysisJob, progress: AnalysisProgress): Promise<void> {
  await job.updateProgress(progress);
}

function createCompletedResult(analysisId: string): AnalysisJobResult {
  return {
    analysisId,

    status: 'completed',
  };
}

async function loadSourceSnapshots(
  files: readonly WorkerRepositorySourceFile[],
): Promise<ReadonlyMap<string, SourceSnapshot>> {
  const snapshots = new Map<string, SourceSnapshot>();

  for (const file of files) {
    const contents = await readFile(file.absolutePath);

    const sourceContent = contents.toString('utf8');

    const contentHash = createHash('sha256').update(contents).digest('hex');

    snapshots.set(file.relativePath, {
      sourceContent,

      contentHash,
    });
  }

  return snapshots;
}

function requireSourceSnapshot(
  snapshots: ReadonlyMap<string, SourceSnapshot>,

  filePath: string,
): SourceSnapshot {
  const snapshot = snapshots.get(filePath);

  if (snapshot === undefined) {
    throw new Error(`Parsed file is missing its source snapshot: ${filePath}`);
  }

  return snapshot;
}

function createPersistenceFiles(
  sourceFiles: readonly WorkerRepositorySourceFile[],

  scannerSkippedFiles: readonly WorkerRepositorySkippedFile[],

  parsedFiles: readonly ParseSourceResult[],

  parserSkippedFiles: readonly ParserSkippedFile[],

  snapshots: ReadonlyMap<string, SourceSnapshot>,
): PersistAnalysisFileInput[] {
  const parsedPaths = new Set(parsedFiles.map((file) => file.filePath));

  /*
   * Parser-level skips apply to files that passed
   * the repository scanner but still could not be
   * deeply parsed.
   */
  const parserSkippedReasonByPath = new Map(
    parserSkippedFiles.map((file) => [file.filePath, file.reason] as const),
  );

  /*
   * Files accepted by the repository scanner have
   * source snapshots available.
   *
   * Even when the parser later skips one, we can
   * still persist its path, source, hash and size.
   */
  const acceptedFiles = sourceFiles.map((file): PersistAnalysisFileInput => {
    const snapshot = requireSourceSnapshot(snapshots, file.relativePath);

    const parserSkipReason = parserSkippedReasonByPath.get(file.relativePath);

    let parseStatus: NonNullable<PersistAnalysisFileInput['parseStatus']> = 'analyzed';

    let isSupported = true;

    if (!parsedPaths.has(file.relativePath)) {
      if (parserSkipReason === 'unsupported-language') {
        parseStatus = 'unsupported';

        isSupported = false;
      } else {
        /*
         * Includes:
         *
         * - parser too-large protection
         * - unexpected parser omission
         *
         * The file remains visible but is
         * explicitly not considered fully analyzed.
         */
        parseStatus = 'partial';
      }
    }

    return {
      filePath: file.relativePath,

      language: file.language,

      sizeBytes: file.sizeBytes,

      contentHash: snapshot.contentHash,

      sourceContent: snapshot.sourceContent,

      isSupported,

      parseStatus,
    };
  });

  /*
   * Scanner-level skipped files never reached
   * Tree-sitter.
   *
   * They deliberately contain only basic metadata:
   *
   * - repository path
   * - detected language when available
   * - byte size
   * - support / parse status
   *
   * We do not read sourceContent for these files:
   *
   * - oversized files could consume excessive memory
   * - unsupported/generated files do not need source
   *   text for the dependency-analysis pipeline
   */
  const skippedFiles = scannerSkippedFiles.map((file): PersistAnalysisFileInput => {
    const isSupported = file.language !== null && file.reason !== 'unsupported-language';

    const parseStatus: NonNullable<PersistAnalysisFileInput['parseStatus']> = isSupported
      ? 'partial'
      : 'unsupported';

    return {
      filePath: file.relativePath,

      /*
       * Database/API contracts use a string for
       * language. "unknown" explicitly represents
       * a file type outside our supported parser set.
       */
      language: file.language ?? 'unknown',

      sizeBytes: file.sizeBytes,

      isSupported,

      parseStatus,
    };
  });

  /*
   * Deterministic ordering makes persistence,
   * testing and API responses easier to reason about.
   */
  return [...acceptedFiles, ...skippedFiles].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  );
}

function createPersistenceSymbols(
  parsedFiles: readonly ParseSourceResult[],
): PersistAnalysisSymbolInput[] {
  const symbols: PersistAnalysisSymbolInput[] = [];

  for (const parsedFile of parsedFiles) {
    for (const parsedFunction of parsedFile.functions) {
      const name = parsedFunction.name?.trim();

      /*
       * Anonymous functions do not have a stable
       * symbol identity for search/persistence.
       */
      if (name === undefined || name.length === 0) {
        continue;
      }

      symbols.push({
        filePath: parsedFile.filePath,

        kind: 'function',

        name,

        qualifiedName: name,

        /*
         * Tree-sitter rows are zero-based.
         *
         * PostgreSQL symbol lines are one-based.
         */
        startLine: parsedFunction.range.start.row + 1,

        startColumn: parsedFunction.range.start.column,

        endLine: parsedFunction.range.end.row + 1,

        endColumn: parsedFunction.range.end.column,

        isExported: parsedFunction.isExported,
      });
    }

    for (const parsedClass of parsedFile.classes) {
      const name = parsedClass.name?.trim();

      if (name === undefined || name.length === 0) {
        continue;
      }

      symbols.push({
        filePath: parsedFile.filePath,

        kind: 'class',

        name,

        qualifiedName: name,

        startLine: parsedClass.range.start.row + 1,

        startColumn: parsedClass.range.start.column,

        endLine: parsedClass.range.end.row + 1,

        endColumn: parsedClass.range.end.column,

        isExported: parsedClass.isExported,
      });
    }
  }

  return symbols.sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.startLine - right.startLine ||
      left.startColumn - right.startColumn ||
      left.kind.localeCompare(right.kind) ||
      left.qualifiedName.localeCompare(right.qualifiedName),
  );
}

function validatePreparedRepositoryIdentity(
  data: AnalysisJobData,

  prepared: {
    sourceType: 'github' | 'zip';

    sourceKey: string;

    revision: string;
  },
): void {
  if (prepared.sourceType !== data.source.sourceType) {
    throw new Error(
      `Prepared repository source type does not match queued analysis source: expected ${data.source.sourceType}, received ${prepared.sourceType}`,
    );
  }

  if (prepared.sourceKey !== data.source.sourceKey) {
    throw new Error(
      `Prepared repository source key does not match queued analysis source: expected "${data.source.sourceKey}", received "${prepared.sourceKey}"`,
    );
  }

  const expectedRevision = getAnalysisSourceRevision(data.source);

  if (prepared.revision.toLowerCase() !== expectedRevision.toLowerCase()) {
    throw new Error('Prepared repository revision does not match queued analysis revision');
  }
}

async function processRepositoryAnalysis(
  job: AnalysisJob,

  data: AnalysisJobData,

  dependencies: AnalysisProcessorDependencies,

  assertLockHealthy: () => Promise<void>,
): Promise<AnalysisJobResult> {
  /*
   * Retry safety.
   *
   * A previous attempt may have successfully committed
   * PostgreSQL results before failing during later cleanup.
   */
  const existingCompleted = await dependencies.analysisStore.getCompletedById(data.analysisId);

  if (existingCompleted !== null) {
    return createCompletedResult(data.analysisId);
  }

  await reportProgress(job, {
    analysisId: data.analysisId,

    stage: 'ingesting',

    percent: 5,

    message: 'Worker accepted the analysis job.',

    timestamp: new Date().toISOString(),
  });

  const prepared = await dependencies.sourcePreparer.prepare(data.source);

  validatePreparedRepositoryIdentity(data, prepared);

  let parserPool: ParserThreadPool | undefined;

  try {
    /*
     * ---------------------------------------------------------------
     * B3/B5: scan + parse repository
     * ---------------------------------------------------------------
     */
    const scan = await scanRepositorySourceFiles(prepared.repositoryDirectory);

    parserPool = dependencies.parserPoolFactory?.() ?? new ParserThreadPool();

    const parsed = await parseRepositoryFiles(
      parserPool,

      prepared.repositoryDirectory,

      scan.sourceFiles.map((file) => ({
        relativePath: file.relativePath,
      })),
    );

    /*
     * Source text is needed by:
     *
     * - B8 complexity
     * - B12/B13 source-code persistence
     * - deterministic content hashes
     *
     * Only analyzable source files are loaded here.
     * Scanner-level skipped/oversized files remain
     * metadata-only and cannot inflate worker memory.
     */
    const sourceSnapshots = await loadSourceSnapshots(scan.sourceFiles);

    /*
     * ---------------------------------------------------------------
     * B6/B7: import resolution + graph
     * ---------------------------------------------------------------
     */
    const graphAnalysis = buildRepositoryGraph(parsed.parsed);

    /*
     * ---------------------------------------------------------------
     * B15: function-level call resolution
     * ---------------------------------------------------------------
     */
    const functionCallResolution = resolveRepositoryFunctionCalls(parsed.parsed);

    /*
     * ---------------------------------------------------------------
     * B8: structure + optional Git churn metrics
     * ---------------------------------------------------------------
     */
    const structureInputs = parsed.parsed.map((parsedFile) => ({
      parsedFile,

      source: requireSourceSnapshot(
        sourceSnapshots,

        parsedFile.filePath,
      ).sourceContent,
    }));

    let churnInputs: ReturnType<typeof createChurnInputsFromGitHistory> | undefined;

    if (prepared.sourceType === 'github' && dependencies.loadGitHistoryTouches !== undefined) {
      const historyTouches = await dependencies.loadGitHistoryTouches(prepared.repositoryDirectory);

      churnInputs = createChurnInputsFromGitHistory(
        graphAnalysis.graph.nodes.map((node) => node.filePath),

        historyTouches,
      );
    }

    const metrics = calculateRepositoryMetrics({
      graphAnalysis,

      structureInputs,

      ...(churnInputs === undefined
        ? {}
        : {
            churnInputs,
          }),
    });

    /*
     * ---------------------------------------------------------------
     * B9: explainable deep analysis
     * ---------------------------------------------------------------
     */
    const deepAnalysis = analyzeRepositoryDeeply({
      metrics,

      graphAnalysis,
    });

    /*
     * ---------------------------------------------------------------
     * B15.4: heatmap-ready per-file architecture risk
     * ---------------------------------------------------------------
     *
     * Deep-analysis findings are converted into normalized
     * 0..100 scores for every analyzed metric file.
     */
    const architectureRiskScores = calculateFileArchitectureRiskScores(
      metrics.files.map((file) => file.filePath),

      deepAnalysis.findings,
    );

    /*
     * ---------------------------------------------------------------
     * B10: repository health
     * ---------------------------------------------------------------
     *
     * Only deeply analyzed source files contribute
     * to the health denominator.
     *
     * Unsupported / partial files remain visible in
     * persistence but are not falsely treated as fully
     * analyzed metric inputs.
     */
    const healthScore = calculateRepositoryHealthScore({
      deepAnalysis,

      analyzedFileCount: metrics.summary.fileCount,
    });

    /*
     * ---------------------------------------------------------------
     * B11: onboarding pathfinder
     * ---------------------------------------------------------------
     */
    const onboarding = buildRepositoryOnboardingPath({
      graphAnalysis,

      metrics,

      deepAnalysis,
    });

    /*
     * ---------------------------------------------------------------
     * B15.5: smart good-first-task recommendations
     * ---------------------------------------------------------------
     *
     * Prefer files that are useful enough to provide
     * repository context while avoiding excessive
     * complexity, coupling and architecture risk.
     */
    const goodFirstTasks = scoreGoodFirstTasks({
      metrics,

      architectureRiskScores,
    });

    /*
     * ---------------------------------------------------------------
     * B15.6: blast-radius-aware newcomer change guidance
     * ---------------------------------------------------------------
     *
     * Recommend safer change surfaces and identify nearby/transitive
     * dependents that a newcomer should review before editing a file.
     */
    const newcomerChangeGuidance = scoreNewcomerChangeGuidance({
      metrics,

      graph: graphAnalysis.graph,

      architectureRiskScores,
    });

    /*
     * ---------------------------------------------------------------
     * B12/B13: persistence payload
     * ---------------------------------------------------------------
     *
     * Persist BOTH:
     *
     * - analyzable source files
     * - scanner-level skipped files
     *
     * so unsupported/oversized/generated files do
     * not silently disappear from repository results.
     */
    const persistenceFiles = createPersistenceFiles(
      scan.sourceFiles,

      scan.skippedFiles,

      parsed.parsed,

      parsed.skipped,

      sourceSnapshots,
    );

    const persistenceSymbols = createPersistenceSymbols(parsed.parsed);

    /*
     * Do not commit a completed analysis after we already
     * know the distributed revision lock was lost.
     */
    await assertLockHealthy();

    /*
     * AnalysisStore.put() performs the complete write in
     * one PostgreSQL transaction and marks the analysis
     * completed only after every persistence stage succeeds.
     */
    await dependencies.analysisStore.put({
      analysisId: data.analysisId,

      files: persistenceFiles,

      symbols: persistenceSymbols,

      graphAnalysis,

      resolvedCalls: functionCallResolution.calls,

      metrics,

      architectureRiskScores,

      findings: deepAnalysis.findings,

      healthScore,

      onboarding,

      goodFirstTasks,

      newcomerChangeGuidance,
    });

    return createCompletedResult(data.analysisId);
  } finally {
    /*
     * Parser worker_threads belong to this analysis run.
     */
    if (parserPool !== undefined) {
      await parserPool.close();
    }

    /*
     * Always remove the cloned/extracted temporary repo.
     *
     * The staged ZIP itself remains untouched by the
     * source preparer so BullMQ retries can still use it.
     */
    await prepared.cleanup();
  }
}

/*
 * Legacy/pure B4 processor.
 *
 * Existing queue/validation tests use this processor
 * without Redis locking or heavy filesystem analysis.
 *
 * Production uses createAnalysisJobProcessor()
 * with AnalysisProcessorDependencies.
 */
async function processValidatedAnalysisJob(
  job: AnalysisJob,

  data: AnalysisJobData,
): Promise<AnalysisJobResult> {
  await reportProgress(job, {
    analysisId: data.analysisId,

    stage: 'ingesting',

    percent: 5,

    message: 'Worker accepted the analysis job.',

    timestamp: new Date().toISOString(),
  });

  return {
    analysisId: data.analysisId,

    status: 'partial',
  };
}

/*
 * Pure compatibility processor used by existing B4 tests.
 *
 * It validates runtime queue data but does not require
 * Redis locking or repository dependencies.
 */
export const processAnalysisJob: AnalysisJobProcessor = async (job): Promise<AnalysisJobResult> => {
  const data = validateAnalysisJob(job);

  return processValidatedAnalysisJob(job, data);
};

/*
 * Production processor.
 *
 * Responsibilities:
 *
 * - runtime job validation
 * - revision-level Redis lock
 * - lock renewal
 * - full repository analysis when dependencies are supplied
 * - lock-safe persistence
 * - ownership-safe lock release
 *
 * dependencies remains optional for the legacy/pure
 * processor tests. Production server wiring supplies
 * all real dependencies.
 */
export function createAnalysisJobProcessor(
  redis: Redis,

  dependencies?: AnalysisProcessorDependencies,
): AnalysisJobProcessor {
  return async (job): Promise<AnalysisJobResult> => {
    /*
     * Validate BEFORE touching Redis lock state.
     */
    const data = validateAnalysisJob(job);

    const lock = await acquireAnalysisLock(redis, data.source);

    if (!lock) {
      /*
       * Another worker currently owns the same
       * exact immutable repository revision.
       *
       * This is retryable, not unrecoverable.
       */
      throw new Error(`Analysis revision is already being processed: ${data.source.sourceKey}`);
    }

    let renewalFailure: Error | undefined;

    let renewalPromise: Promise<void> | undefined;

    const renewLock = () => {
      /*
       * Never overlap two lock-renewal operations.
       */
      if (renewalPromise) {
        return;
      }

      renewalPromise = lock
        .extend()
        .then((extended) => {
          if (!extended) {
            renewalFailure = new Error(`Analysis lock ownership was lost: ${lock.key}`);
          }
        })
        .catch((error: unknown) => {
          renewalFailure = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          renewalPromise = undefined;
        });
    };

    const renewalTimer = setInterval(renewLock, ANALYSIS_LOCK_RENEW_INTERVAL_MS);

    /*
     * Lock renewal must not keep Node alive by itself.
     */
    renewalTimer.unref();

    const assertLockHealthy = async (): Promise<void> => {
      if (renewalPromise) {
        await renewalPromise;
      }

      if (renewalFailure) {
        throw renewalFailure;
      }
    };

    try {
      const result =
        dependencies === undefined
          ? await processValidatedAnalysisJob(job, data)
          : await processRepositoryAnalysis(job, data, dependencies, assertLockHealthy);

      /*
       * Final ownership check before reporting the
       * BullMQ job as successfully completed.
       */
      await assertLockHealthy();

      return result;
    } finally {
      clearInterval(renewalTimer);

      /*
       * Allow an already-running Redis renewal to settle
       * before releasing ownership.
       */
      if (renewalPromise) {
        await renewalPromise.catch(() => undefined);
      }

      /*
       * release() validates the ownership token.
       *
       * If ownership changed, it will not delete another
       * worker's lock.
       */
      await lock.release().catch(() => false);
    }
  };
}
