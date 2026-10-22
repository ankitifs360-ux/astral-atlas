import type {
  AnalysisFinding,
  DeepAnalysisResult,
  FileHotspotSignals,
} from '../deep-analysis/types.js';

import type { RepositoryMetrics } from '../metrics/types.js';

import type { EntryPointCandidate } from './entry-point-detector.js';

import type { OnboardingSignal } from './types.js';

export interface OnboardingCandidate {
  filePath: string;

  score: number;

  signals: OnboardingSignal[];
}

export interface ScoreOnboardingCandidatesInput {
  metrics: RepositoryMetrics;

  deepAnalysis: DeepAnalysisResult;

  entryPoints: readonly EntryPointCandidate[];
}

const SIGNAL_WEIGHTS = {
  entryPoint: 50,

  highFanIn: 20,

  highFanOut: 12,

  largeBlastRadius: 18,

  hotspot: 25,

  dependencyCycle: 10,
} as const;

function findHotspot(
  hotspots: readonly FileHotspotSignals[],

  filePath: string,
): FileHotspotSignals | undefined {
  return hotspots.find((hotspot) => hotspot.filePath === filePath);
}

function hasFindingForFile(
  findings: readonly AnalysisFinding[],

  kind: AnalysisFinding['kind'],

  filePath: string,
): boolean {
  return findings.some((finding) => finding.kind === kind && finding.filePaths.includes(filePath));
}

function createCandidateSignals(
  filePath: string,

  entryPoints: readonly EntryPointCandidate[],

  deepAnalysis: DeepAnalysisResult,
): OnboardingSignal[] {
  const signals: OnboardingSignal[] = [];

  const entryPoint = entryPoints.find((candidate) => candidate.filePath === filePath);

  if (entryPoint !== undefined) {
    signals.push({
      kind: 'entry-point',

      weight: SIGNAL_WEIGHTS.entryPoint,

      description: entryPoint.reasons.includes('dependency-root')
        ? 'Likely repository entry point based on dependency-graph structure.'
        : 'Likely repository entry point based on a conventional startup filename.',
    });
  }

  if (hasFindingForFile(deepAnalysis.findings, 'high-fan-in', filePath)) {
    signals.push({
      kind: 'high-fan-in',

      weight: SIGNAL_WEIGHTS.highFanIn,

      description:
        'Many repository files directly depend on this file, making it useful for understanding shared behavior.',
    });
  }

  if (hasFindingForFile(deepAnalysis.findings, 'high-fan-out', filePath)) {
    signals.push({
      kind: 'high-fan-out',

      weight: SIGNAL_WEIGHTS.highFanOut,

      description:
        'This file directly depends on many other repository files and may reveal how major components are connected.',
    });
  }

  if (hasFindingForFile(deepAnalysis.findings, 'large-blast-radius', filePath)) {
    signals.push({
      kind: 'large-blast-radius',

      weight: SIGNAL_WEIGHTS.largeBlastRadius,

      description:
        'Changes to this file can affect many other files, making it important for understanding repository impact paths.',
    });
  }

  const hotspot = findHotspot(deepAnalysis.hotspots, filePath);

  if (hotspot !== undefined) {
    signals.push({
      kind: 'hotspot',

      weight: SIGNAL_WEIGHTS.hotspot,

      description: `This file combines ${hotspot.signalCount} important repository signals and is a strong architectural hotspot.`,
    });
  }

  if (hasFindingForFile(deepAnalysis.findings, 'dependency-cycle', filePath)) {
    signals.push({
      kind: 'dependency-cycle',

      weight: SIGNAL_WEIGHTS.dependencyCycle,

      description:
        'This file participates in a dependency cycle and helps explain tightly coupled parts of the repository.',
    });
  }

  return signals;
}

export function scoreOnboardingCandidates(
  input: ScoreOnboardingCandidatesInput,
): OnboardingCandidate[] {
  return input.metrics.files
    .map((file) => {
      const signals = createCandidateSignals(file.filePath, input.entryPoints, input.deepAnalysis);

      const signalScore = signals.reduce((total, signal) => total + signal.weight, 0);

      /*
       * Add a small graph-importance bonus.
       *
       * These bonuses are intentionally capped
       * so explainable B11 signals remain more
       * important than raw graph counts.
       */
      const fanInBonus = Math.min(file.dependencies.fanIn, 10);

      const fanOutBonus = Math.min(file.dependencies.fanOut, 5);

      const blastRadiusBonus = Math.min(file.blastRadius.affectedFileCount, 10);

      const score = signalScore + fanInBonus + fanOutBonus + blastRadiusBonus;

      return {
        filePath: file.filePath,

        score,

        signals,
      };
    })
    .sort((left, right) => {
      const scoreOrder = right.score - left.score;

      if (scoreOrder !== 0) {
        return scoreOrder;
      }

      return left.filePath.localeCompare(right.filePath);
    });
}
