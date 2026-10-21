export const INGESTION_LIMITS = {
  // Maximum uploaded ZIP size: 50 MiB.
  maxArchiveBytes: 50 * 1024 * 1024,

  // Protects against ZIP bombs where a small archive expands massively.
  maxExtractedBytes: 250 * 1024 * 1024,

  // Maximum total number of files we will allow in one repository.
  maxFileCount: 10_000,

  // Maximum number of source files we will actually analyse.
  maxAnalyzableFileCount: 5_000,

  // Ignore individual source files larger than 2 MiB.
  // Large generated/minified files are rarely useful for our graph.
  maxAnalyzableFileBytes: 2 * 1024 * 1024,

  // Prevent absurd or malicious paths.
  maxRelativePathLength: 1_024,

  // Git operations must not be allowed to hang forever.
  gitOperationTimeoutMs: 120_000,
} as const;

export type IngestionLimits = typeof INGESTION_LIMITS;
