import type { ReliabilityCounts, ReliabilitySummary } from "./types";

/**
 * Clinical convention: a field test is called unreliable above these rates.
 * We keep the same numbers so the verdict means roughly what a clinician
 * would expect it to mean.
 */
export const FP_LIMIT = 0.15;
export const FN_LIMIT = 0.33;
export const FIXATION_LOSS_LIMIT = 0.2;

export function summarizeReliability(counts: ReliabilityCounts): ReliabilitySummary {
  // False positives are measured two ways and we take the worse of the two:
  //  - the clinical way, from dedicated empty catch trials, and
  //  - stray presses (too early, or with no stimulus anywhere near), which are
  //    the same behaviour caught outside the catch trials.
  const catchFp = counts.fpCatchTrials > 0 ? counts.fpCatchHits / counts.fpCatchTrials : 0;
  const strayDenom = Math.max(1, counts.scoredTrials);
  const strayFp = (counts.spontaneousPresses + counts.anticipatoryPresses) / strayDenom;
  const falsePositiveRate = Math.max(catchFp, strayFp);

  const falseNegativeRate =
    counts.fnCatchTrials > 0 ? counts.fnCatchMisses / counts.fnCatchTrials : 0;

  // Both fixation checks are per-trial, so they share a denominator.
  const fixDenom = counts.blindSpotTrials + counts.gazeChecks;
  const fixationLossRate =
    fixDenom > 0 ? (counts.blindSpotHits + counts.gazeFixationLosses) / fixDenom : 0;

  const reasons: string[] = [];
  if (falsePositiveRate > FP_LIMIT) reasons.push("falsePositives");
  if (falseNegativeRate > FN_LIMIT) reasons.push("falseNegatives");
  if (fixationLossRate > FIXATION_LOSS_LIMIT) reasons.push("fixationLosses");

  return {
    ...counts,
    falsePositiveRate,
    falseNegativeRate,
    fixationLossRate,
    verdict: reasons.length > 0 ? "low" : "reliable",
    reasons,
  };
}

/** Live hint shown during the test when the user is pressing too freely. */
export function shouldWarnFalsePositives(counts: ReliabilityCounts): boolean {
  const stray = counts.spontaneousPresses + counts.anticipatoryPresses;
  return stray >= 4 && stray / Math.max(1, counts.scoredTrials) > FP_LIMIT;
}
