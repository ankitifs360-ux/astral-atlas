import type { RepositoryGraphAnalysis } from '../graph/repository-graph.js';

import type { EntryPointCandidate } from './entry-point-detector.js';

import type { OnboardingCandidate } from './candidate-scorer.js';

import type { OnboardingPathResult, OnboardingPathStep, OnboardingSignal } from './types.js';

export const DEFAULT_ONBOARDING_MAX_STEPS = 10;

export const MAX_ONBOARDING_MAX_STEPS = 50;

const DEPENDENCY_CONTINUITY_WEIGHT = 15;

export interface BuildOnboardingPathInput {
  graphAnalysis: RepositoryGraphAnalysis;

  candidates: readonly OnboardingCandidate[];

  entryPoints: readonly EntryPointCandidate[];

  maxSteps?: number;
}

function validateMaxSteps(maxSteps: number): void {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_ONBOARDING_MAX_STEPS) {
    throw new Error(`maxSteps must be an integer between 1 and ${MAX_ONBOARDING_MAX_STEPS}`);
  }
}

function compareCandidates(
  left: OnboardingCandidate,

  right: OnboardingCandidate,
): number {
  const scoreOrder = right.score - left.score;

  if (scoreOrder !== 0) {
    return scoreOrder;
  }

  return left.filePath.localeCompare(right.filePath);
}

function createCandidateIndex(
  candidates: readonly OnboardingCandidate[],
): Map<string, OnboardingCandidate> {
  const index = new Map<string, OnboardingCandidate>();

  for (const candidate of candidates) {
    if (index.has(candidate.filePath)) {
      throw new Error(`Duplicate onboarding candidate for "${candidate.filePath}"`);
    }

    index.set(candidate.filePath, candidate);
  }

  return index;
}

function createOutgoingDependencyIndex(
  graphAnalysis: RepositoryGraphAnalysis,

  candidateIndex: ReadonlyMap<string, OnboardingCandidate>,
): Map<string, Set<string>> {
  const outgoing = new Map<string, Set<string>>();

  for (const edge of graphAnalysis.graph.edges) {
    /*
     * File graph direction:
     *
     * source imports target
     *
     * server.ts
     *    ↓
     * routes.ts
     */
    if (!candidateIndex.has(edge.source) || !candidateIndex.has(edge.target)) {
      continue;
    }

    let dependencies = outgoing.get(edge.source);

    if (dependencies === undefined) {
      dependencies = new Set<string>();

      outgoing.set(edge.source, dependencies);
    }

    dependencies.add(edge.target);
  }

  return outgoing;
}

function chooseStartingCandidate(
  candidates: readonly OnboardingCandidate[],

  entryPoints: readonly EntryPointCandidate[],

  candidateIndex: ReadonlyMap<string, OnboardingCandidate>,
): OnboardingCandidate | null {
  /*
   * Prefer the best detected entry point even if
   * another architectural hotspot has a higher
   * global candidate score.
   */
  for (const entryPoint of entryPoints) {
    const candidate = candidateIndex.get(entryPoint.filePath);

    if (candidate !== undefined) {
      return candidate;
    }
  }

  return [...candidates].sort(compareCandidates)[0] ?? null;
}

function chooseConnectedDependency(
  currentFilePath: string,

  outgoingDependencies: ReadonlyMap<string, ReadonlySet<string>>,

  candidateIndex: ReadonlyMap<string, OnboardingCandidate>,

  visited: ReadonlySet<string>,
): OnboardingCandidate | null {
  const dependencyPaths = outgoingDependencies.get(currentFilePath);

  if (dependencyPaths === undefined) {
    return null;
  }

  const available: OnboardingCandidate[] = [];

  for (const filePath of dependencyPaths) {
    if (visited.has(filePath)) {
      continue;
    }

    const candidate = candidateIndex.get(filePath);

    if (candidate !== undefined) {
      available.push(candidate);
    }
  }

  return available.sort(compareCandidates)[0] ?? null;
}

function chooseGlobalCandidate(
  candidates: readonly OnboardingCandidate[],

  visited: ReadonlySet<string>,
): OnboardingCandidate | null {
  return (
    candidates.filter((candidate) => !visited.has(candidate.filePath)).sort(compareCandidates)[0] ??
    null
  );
}

function createDependencyContinuitySignal(previousFilePath: string): OnboardingSignal {
  return {
    kind: 'dependency-of-previous',

    weight: DEPENDENCY_CONTINUITY_WEIGHT,

    description: `This file is directly imported by ${previousFilePath}, so reading it next preserves dependency context.`,
  };
}

function createStep(
  candidate: OnboardingCandidate,

  order: number,

  dependencySourceFilePath?: string,
): OnboardingPathStep {
  if (dependencySourceFilePath === undefined) {
    return {
      order,

      filePath: candidate.filePath,

      score: candidate.score,

      signals: [...candidate.signals],
    };
  }

  const continuitySignal = createDependencyContinuitySignal(dependencySourceFilePath);

  return {
    order,

    filePath: candidate.filePath,

    score: candidate.score + continuitySignal.weight,

    signals: [...candidate.signals, continuitySignal],
  };
}

export function buildOnboardingPath(input: BuildOnboardingPathInput): OnboardingPathResult {
  const maxSteps = input.maxSteps ?? DEFAULT_ONBOARDING_MAX_STEPS;

  validateMaxSteps(maxSteps);

  const candidateIndex = createCandidateIndex(input.candidates);

  if (input.candidates.length === 0) {
    return {
      steps: [],

      consideredFileCount: 0,

      maxSteps,
    };
  }

  const outgoingDependencies = createOutgoingDependencyIndex(input.graphAnalysis, candidateIndex);

  const startingCandidate = chooseStartingCandidate(
    input.candidates,
    input.entryPoints,
    candidateIndex,
  );

  if (startingCandidate === null) {
    return {
      steps: [],

      consideredFileCount: input.candidates.length,

      maxSteps,
    };
  }

  const visited = new Set<string>();

  const steps: OnboardingPathStep[] = [];

  let current = startingCandidate;

  /*
   * True only when current was selected because
   * the previous file directly imports it.
   *
   * This is important:
   *
   * connected transition
   * server.ts -> routes.ts
   * ✅ continuity signal
   *
   * global fallback
   * routes.ts   core.ts
   * ❌ continuity signal
   */
  let connectedFromPrevious = false;

  while (steps.length < maxSteps && visited.size < input.candidates.length) {
    visited.add(current.filePath);

    const previousStep = steps.at(-1);

    const dependencySourceFilePath = connectedFromPrevious ? previousStep?.filePath : undefined;

    steps.push(createStep(current, steps.length + 1, dependencySourceFilePath));

    /*
     * Prefer a direct unvisited dependency of the
     * current file.
     */
    const connectedDependency = chooseConnectedDependency(
      current.filePath,
      outgoingDependencies,
      candidateIndex,
      visited,
    );

    if (connectedDependency !== null) {
      current = connectedDependency;

      connectedFromPrevious = true;

      continue;
    }

    /*
     * The connected branch ended.
     *
     * Jump to the globally most useful remaining
     * candidate. Because this is NOT a dependency
     * transition, the next step must not receive
     * dependency-of-previous.
     */
    const globalCandidate = chooseGlobalCandidate(input.candidates, visited);

    if (globalCandidate === null) {
      break;
    }

    current = globalCandidate;

    connectedFromPrevious = false;
  }

  return {
    steps,

    consideredFileCount: input.candidates.length,

    maxSteps,
  };
}
