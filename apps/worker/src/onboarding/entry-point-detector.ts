import type { FileMetrics, RepositoryMetrics } from '../metrics/types.js';

export type EntryPointReason = 'dependency-root' | 'conventional-name' | 'fallback';

export interface EntryPointCandidate {
  filePath: string;

  score: number;

  reasons: EntryPointReason[];
}

const CONVENTIONAL_ENTRY_NAMES = new Map<string, number>([
  ['main', 40],

  ['server', 38],

  ['app', 36],

  ['entry', 34],

  ['bootstrap', 32],

  ['index', 30],

  ['cli', 28],
]);

function getBaseNameWithoutExtension(filePath: string): string {
  const normalized = filePath.replaceAll('\\', '/');

  const fileName = normalized.split('/').at(-1) ?? normalized;

  const firstDot = fileName.indexOf('.');

  if (firstDot === -1) {
    return fileName;
  }

  return fileName.slice(0, firstDot);
}

function getConventionalNameScore(filePath: string): number {
  const baseName = getBaseNameWithoutExtension(filePath).toLowerCase();

  return CONVENTIONAL_ENTRY_NAMES.get(baseName) ?? 0;
}

function isDependencyRoot(file: FileMetrics): boolean {
  return file.dependencies.fanIn === 0 && file.dependencies.fanOut > 0;
}

function calculateCandidate(file: FileMetrics): EntryPointCandidate | null {
  const reasons: EntryPointReason[] = [];

  let score = 0;

  /*
   * A graph root is a strong entry-point signal:
   *
   * nobody inside the repository imports it,
   * but it imports other repository files.
   *
   * Example:
   *
   * server.ts
   *   ↓
   * routes.ts
   *   ↓
   * services.ts
   */
  if (isDependencyRoot(file)) {
    reasons.push('dependency-root');

    score += 50;
  }

  const conventionalNameScore = getConventionalNameScore(file.filePath);

  if (conventionalNameScore > 0) {
    reasons.push('conventional-name');

    score += conventionalNameScore;
  }

  /*
   * Small deterministic bonus for files that
   * immediately introduce the reader to more of
   * the repository.
   *
   * The cap prevents very high fan-out from
   * dominating entry-point selection.
   */
  score += Math.min(file.dependencies.fanOut, 10);

  if (reasons.length === 0) {
    return null;
  }

  return {
    filePath: file.filePath,

    score,

    reasons,
  };
}

function createFallbackCandidate(files: readonly FileMetrics[]): EntryPointCandidate | null {
  if (files.length === 0) {
    return null;
  }

  /*
   * Some repositories have no obvious roots.
   *
   * Example:
   *
   * a.ts → b.ts → c.ts → a.ts
   *
   * Every file has incoming dependencies.
   *
   * In that case choose the file with:
   *
   * 1. lowest fan-in
   * 2. highest fan-out
   * 3. lexical file path
   *
   * This guarantees a deterministic starting
   * point without pretending it is a confirmed
   * application entry point.
   */
  const sorted = [...files].sort((left, right) => {
    const fanInOrder = left.dependencies.fanIn - right.dependencies.fanIn;

    if (fanInOrder !== 0) {
      return fanInOrder;
    }

    const fanOutOrder = right.dependencies.fanOut - left.dependencies.fanOut;

    if (fanOutOrder !== 0) {
      return fanOutOrder;
    }

    return left.filePath.localeCompare(right.filePath);
  });

  const selected = sorted[0];

  if (selected === undefined) {
    return null;
  }

  return {
    filePath: selected.filePath,

    score: 0,

    reasons: ['fallback'],
  };
}

export function detectEntryPointCandidates(metrics: RepositoryMetrics): EntryPointCandidate[] {
  const candidates = metrics.files
    .map((file) => calculateCandidate(file))
    .filter((candidate): candidate is EntryPointCandidate => candidate !== null);

  if (candidates.length === 0) {
    const fallback = createFallbackCandidate(metrics.files);

    return fallback === null ? [] : [fallback];
  }

  return candidates.sort((left, right) => {
    const scoreOrder = right.score - left.score;

    if (scoreOrder !== 0) {
      return scoreOrder;
    }

    return left.filePath.localeCompare(right.filePath);
  });
}
