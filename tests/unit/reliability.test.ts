import { describe, expect, it } from "vitest";
import { TestEngine } from "../../src/core/engine";
import { resolveGrid, SPEC_24_2 } from "../../src/core/grid";
import { FIXATION_LOSS_LIMIT, FP_LIMIT, summarizeReliability } from "../../src/core/reliability";
import { Rng } from "../../src/core/rng";
import { buildEyeResult } from "../../src/core/scoring";
import { ScreeningStrategy } from "../../src/core/strategies";
import type { ReliabilityCounts } from "../../src/core/types";
import { makeConfig, makeDevice, makeLum } from "./helpers/fixtures";
import { flatField, simulateRun, type SimObserver } from "./helpers/simulate";

const device = makeDevice();
const lum = makeLum(device);
const grid = resolveGrid(SPEC_24_2, "OD", device, 300);

function emptyCounts(over: Partial<ReliabilityCounts> = {}): ReliabilityCounts {
  return {
    fpCatchTrials: 0,
    fpCatchHits: 0,
    fnCatchTrials: 0,
    fnCatchMisses: 0,
    blindSpotTrials: 0,
    blindSpotHits: 0,
    gazeFixationLosses: 0,
    spontaneousPresses: 0,
    anticipatoryPresses: 0,
    invalidatedTrials: 0,
    gazeChecks: 0,
    scoredTrials: 100,
    ...over,
  };
}

describe("reliability summary", () => {
  it("calls a clean run reliable", () => {
    const s = summarizeReliability(
      emptyCounts({ fpCatchTrials: 10, fnCatchTrials: 8, blindSpotTrials: 8, gazeChecks: 100 }),
    );
    expect(s.verdict).toBe("reliable");
    expect(s.reasons).toEqual([]);
  });

  it("flags too many false positives from catch trials", () => {
    const s = summarizeReliability(emptyCounts({ fpCatchTrials: 10, fpCatchHits: 3 }));
    expect(s.falsePositiveRate).toBeCloseTo(0.3);
    expect(s.verdict).toBe("low");
    expect(s.reasons).toContain("falsePositives");
  });

  it("flags a trigger-happy user even when the catch trials happen to be clean", () => {
    // No catch-trial hits, but plenty of presses at times when nothing was
    // shown - the same behaviour, caught outside the catch trials.
    const s = summarizeReliability(
      emptyCounts({ fpCatchTrials: 6, spontaneousPresses: 18, anticipatoryPresses: 4 }),
    );
    expect(s.falsePositiveRate).toBeGreaterThan(FP_LIMIT);
    expect(s.verdict).toBe("low");
  });

  it("flags fixation losses from either source", () => {
    const fromBlindSpot = summarizeReliability(
      emptyCounts({ blindSpotTrials: 10, blindSpotHits: 4 }),
    );
    expect(fromBlindSpot.fixationLossRate).toBeCloseTo(0.4);
    expect(fromBlindSpot.reasons).toContain("fixationLosses");

    const fromGaze = summarizeReliability(emptyCounts({ gazeChecks: 100, gazeFixationLosses: 30 }));
    expect(fromGaze.fixationLossRate).toBeCloseTo(0.3);
    expect(fromGaze.reasons).toContain("fixationLosses");
  });

  it("pools both fixation checks into one rate", () => {
    const s = summarizeReliability(
      emptyCounts({
        blindSpotTrials: 10,
        blindSpotHits: 1,
        gazeChecks: 90,
        gazeFixationLosses: 9,
      }),
    );
    expect(s.fixationLossRate).toBeCloseTo(0.1);
    expect(s.verdict).toBe("reliable");
  });

  it("flags too many false negatives", () => {
    const s = summarizeReliability(emptyCounts({ fnCatchTrials: 9, fnCatchMisses: 5 }));
    expect(s.falseNegativeRate).toBeGreaterThan(0.5);
    expect(s.reasons).toContain("falseNegatives");
  });

  it("does not divide by zero when no catch trials ran", () => {
    const s = summarizeReliability(emptyCounts({ scoredTrials: 0 }));
    expect(s.falsePositiveRate).toBe(0);
    expect(s.falseNegativeRate).toBe(0);
    expect(s.fixationLossRate).toBe(0);
    expect(s.verdict).toBe("reliable");
  });

  it("uses the clinical limits", () => {
    expect(FP_LIMIT).toBeCloseTo(0.15);
    expect(FIXATION_LOSS_LIMIT).toBeCloseTo(0.2);
  });
});

/** End-to-end: does a whole run actually catch these behaviours? */
function runWith(observer: SimObserver, simOpts: Parameters<typeof simulateRun>[2] = {}) {
  const rng = new Rng(777);
  const strategy = new ScreeningStrategy({ grid, lum, age: 45, rng });
  const config = makeConfig({ protocol: "screening", gazeMonitoring: true });
  const engine = new TestEngine({
    eye: "OD",
    grid,
    lum,
    strategy,
    rng,
    config,
    blindSpotEnabled: true,
  });
  simulateRun(engine, observer, { gazeEnabled: true, ...simOpts });
  return buildEyeResult(engine, strategy, grid, lum, config);
}

describe("catching bad test-taking behaviour end to end", () => {
  it("passes an attentive, steadily fixating user", () => {
    const result = runWith(flatField(29));
    expect(result.reliability.verdict).toBe("reliable");
    expect(result.reliability.falsePositiveRate).toBeLessThan(FP_LIMIT);
  });

  it("catches a user who presses on almost every empty catch trial", () => {
    const result = runWith({ ...flatField(29), falsePressRate: 0.9 });
    expect(result.reliability.fpCatchTrials).toBeGreaterThan(3);
    expect(result.reliability.falsePositiveRate).toBeGreaterThan(FP_LIMIT);
    expect(result.reliability.verdict).toBe("low");
    expect(result.reliability.reasons).toContain("falsePositives");
  });

  it("catches a user who presses on a rhythm regardless of the stimuli", () => {
    // Press every 900 ms for the first three minutes, ignoring what is shown.
    const extraPressesAt = Array.from({ length: 200 }, (_, i) => 2000 + i * 900);
    const result = runWith(flatField(29), { extraPressesAt });
    expect(result.reliability.spontaneousPresses).toBeGreaterThan(10);
    expect(result.reliability.verdict).toBe("low");
  });

  it("catches an eye that keeps drifting off the fixation target", () => {
    // Gaze wanders far off target for a second out of every three.
    const result = runWith(flatField(29), {
      gazeDeviationAt: (t) => (t % 3000 < 1000 ? 11 : 0.4),
    });
    expect(result.reliability.gazeChecks).toBeGreaterThan(20);
    expect(result.reliability.gazeFixationLosses).toBeGreaterThan(0);
    expect(result.reliability.fixationLossRate).toBeGreaterThan(FIXATION_LOSS_LIMIT);
    expect(result.reliability.verdict).toBe("low");
  });

  it("catches a user who is not fixating by way of the blind spot", () => {
    const result = runWith({ ...flatField(29), seesBlindSpot: true });
    expect(result.reliability.blindSpotHits).toBeGreaterThan(0);
  });

  it("still measures the field despite discarded trials", () => {
    const result = runWith(flatField(29), {
      gazeDeviationAt: (t) => (t % 4000 < 800 ? 12 : 0.3),
    });
    expect(result.reliability.invalidatedTrials).toBeGreaterThan(0);
    // Every location still ends up with a classification: invalidated trials
    // are repeated, not silently dropped.
    for (const p of grid.points) expect(result.classes![p.id]).toBeDefined();
  });

  it("does not blame the user for blinks", () => {
    const result = runWith(flatField(29), { blinkAt: (t) => t % 5000 < 250 });
    expect(result.reliability.invalidatedTrials).toBeGreaterThan(0);
    expect(result.reliability.gazeFixationLosses).toBe(0);
    expect(result.reliability.verdict).toBe("reliable");
  });
});
