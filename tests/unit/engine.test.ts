import { beforeEach, describe, expect, it } from "vitest";
import {
  GAZE_WINDOW_END_MS,
  RESPONSE_MAX_MS,
  RESPONSE_MIN_MS,
  TestEngine,
} from "../../src/core/engine";
import { LuminanceModel } from "../../src/core/luminance";
import { Rng } from "../../src/core/rng";
import type { Strategy, StimulusPlan } from "../../src/core/strategies";
import type { GazeSample, GridPoint, ResolvedGrid } from "../../src/core/types";
import { makeConfig, makeLum } from "./helpers/fixtures";

/** A strategy that hands out a fixed script of presentations. */
class StubStrategy implements Strategy {
  readonly id = "threshold";
  results: { plan: StimulusPlan; seen: boolean }[] = [];
  private i = 0;
  constructor(private plans: StimulusPlan[]) {}
  next(): StimulusPlan | null {
    return this.i < this.plans.length ? this.plans[this.i++] : null;
  }
  record(plan: StimulusPlan, seen: boolean): void {
    this.results.push({ plan, seen });
  }
  isComplete(): boolean {
    return this.i >= this.plans.length;
  }
  progress(): number {
    return this.i / Math.max(1, this.plans.length);
  }
  thresholds(): Record<string, number | null> {
    return {};
  }
  classes(): undefined {
    return undefined;
  }
}

function makeGrid(points: { xDeg: number; yDeg: number }[]): ResolvedGrid {
  const gp: GridPoint[] = points.map((p) => ({
    id: `x${p.xDeg}_y${p.yDeg}`,
    xDeg: p.xDeg,
    yDeg: p.yDeg,
    eccDeg: Math.hypot(p.xDeg, p.yDeg),
  }));
  return {
    spec: { id: "stub", label: "stub", points, minCoverage: 0 },
    eye: "OD",
    points: gp,
    coverage: 1,
    maxXDeg: Math.max(...gp.map((p) => Math.abs(p.xDeg))),
    maxYDeg: Math.max(...gp.map((p) => Math.abs(p.yDeg))),
    droppedCount: 0,
  };
}

/** Frame-by-frame driver with exact control over press timestamps. */
class Stepper {
  t = 0;
  gaze: ((t: number) => Partial<GazeSample>) | null = null;
  private watermark = 0;

  constructor(
    readonly engine: TestEngine,
    readonly frameMs = 16.7,
  ) {}

  start(): void {
    this.engine.start(this.t);
  }

  frame(dt = this.frameMs): void {
    this.t += dt;
    if (this.gaze) {
      const partial = this.gaze(this.t);
      this.engine.pushGaze({
        t: this.t,
        faceFound: true,
        deviationDeg: 0,
        blink: false,
        distanceMm: 330,
        openEye: null,
        qualityDeg: 1.5,
        ...partial,
      });
    }
    this.engine.update(this.t);
  }

  advance(ms: number): void {
    const end = this.t + ms;
    while (this.t < end) this.frame();
  }

  /** Run frames until the engine starts a trial; returns its onset time. */
  nextTrialOnset(limitMs = 20000): { onset: number; index: number } {
    const deadline = this.t + limitMs;
    while (this.t < deadline) {
      this.frame();
      for (; this.watermark < this.engine.events.length; this.watermark++) {
        const e = this.engine.events[this.watermark];
        if (e.type === "trialScheduled") {
          this.watermark++;
          return { onset: this.t, index: e.index };
        }
      }
    }
    throw new Error("no trial started in time");
  }
}

const PLAN_A: StimulusPlan = { locId: "a", xDeg: 9, yDeg: 9, levelDb: 24 };
const PLAN_B: StimulusPlan = { locId: "b", xDeg: -9, yDeg: 9, levelDb: 24 };

function makeEngine(
  plans: StimulusPlan[],
  overrides: Partial<ConstructorParameters<typeof TestEngine>[0]> = {},
): { engine: TestEngine; strategy: StubStrategy } {
  const strategy = new StubStrategy(plans);
  const engine = new TestEngine({
    eye: "OD",
    grid: makeGrid([
      { xDeg: 9, yDeg: 9 },
      { xDeg: -9, yDeg: 9 },
    ]),
    lum: makeLum(),
    strategy,
    rng: new Rng(42),
    config: makeConfig(),
    blindSpotEnabled: false,
    ...overrides,
  });
  return { engine, strategy };
}

describe("response classification", () => {
  it("accepts a press inside the response window as seen", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: true }]);
    expect(engine.trials[0].outcome).toBe("seen");
    expect(engine.trials[0].rtMs).toBeCloseTo(400, 5);
    expect(engine.counts.anticipatoryPresses).toBe(0);
    expect(engine.counts.spontaneousPresses).toBe(0);
  });

  it("treats a press faster than human reaction time as a false trigger", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + RESPONSE_MIN_MS - 30);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(engine.counts.anticipatoryPresses).toBe(1);
    expect(engine.counts.invalidatedTrials).toBe(1);
    expect(engine.trials[0].outcome).toBe("invalidated");
    expect(engine.trials[0].invalidReason).toBe("anticipatory");
    // The measurement is thrown away, not scored either way.
    expect(strategy.results).toHaveLength(0);
  });

  it("re-queues an invalidated trial so the location still gets measured", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const first = s.nextTrialOnset();
    engine.press(first.onset + 50); // anticipatory
    s.advance(GAZE_WINDOW_END_MS + 100);

    const second = s.nextTrialOnset();
    engine.press(second.onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: true }]);
  });

  it("counts a press with no stimulus anywhere near it as a false trigger", () => {
    const { engine } = makeEngine([PLAN_A, PLAN_B]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    s.advance(RESPONSE_MAX_MS + 200);
    engine.press(onset + RESPONSE_MAX_MS + 150);
    s.advance(50);

    expect(engine.counts.spontaneousPresses).toBe(1);
    expect(engine.presses.some((p) => p.class === "spontaneous")).toBe(true);
  });

  it("records no response as not seen", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    s.nextTrialOnset();
    s.advance(RESPONSE_MAX_MS + 100);

    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: false }]);
    expect(engine.trials[0].outcome).toBe("notSeen");
  });
});

describe("fixation monitoring", () => {
  it("throws away a trial the user looked away during, and counts a fixation loss", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.gaze = () => ({ deviationDeg: 9 });
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(engine.counts.gazeFixationLosses).toBe(1);
    expect(engine.counts.gazeChecks).toBe(1);
    expect(engine.trials[0].outcome).toBe("invalidated");
    expect(engine.trials[0].invalidReason).toBe("gaze");
    // Crucially: a "seen" press while the eye wandered onto the stimulus is
    // not allowed to count as a real response.
    expect(strategy.results).toHaveLength(0);
    expect(engine.events.some((e) => e.type === "fixationLoss")).toBe(true);
  });

  it("ignores a single noisy gaze sample", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    let frames = 0;
    s.gaze = () => ({ deviationDeg: ++frames % 40 === 0 ? 12 : 0.5 });
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: true }]);
  });

  it("invalidates a blink but does not call it a fixation loss", () => {
    const { engine } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.gaze = () => ({ blink: true });
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(engine.trials[0].invalidReason).toBe("blink");
    expect(engine.counts.gazeFixationLosses).toBe(0);
  });

  it("does not veto anything when gaze monitoring is off", () => {
    const { engine, strategy } = makeEngine([PLAN_A], {
      config: makeConfig({ gazeMonitoring: false }),
    });
    const s = new Stepper(engine);
    s.gaze = () => ({ deviationDeg: 20 });
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: true }]);
    expect(engine.counts.gazeChecks).toBe(0);
  });

  it("finds the blind spot when the user cannot see a stimulus there", () => {
    const { engine } = makeEngine([PLAN_A], { blindSpotEnabled: true });
    const s = new Stepper(engine);
    s.start();
    s.nextTrialOnset(); // blind-spot search probe
    s.advance(RESPONSE_MAX_MS + 100);

    expect(engine.blindSpotLocation).not.toBeNull();
    expect(engine.blindSpotLocation!.xDeg).toBeCloseTo(15.5, 1);
    expect(engine.events.some((e) => e.type === "blindSpotFound")).toBe(true);
  });

  it("treats seeing a blind-spot stimulus as a fixation loss", () => {
    const { engine } = makeEngine([PLAN_A], { blindSpotEnabled: true });
    const s = new Stepper(engine);
    s.start();
    // Respond to every probe: the eye must be pointing somewhere else.
    for (let i = 0; i < 5; i++) {
      const { onset } = s.nextTrialOnset();
      engine.press(onset + 400);
      s.advance(GAZE_WINDOW_END_MS + 100);
    }
    expect(engine.counts.blindSpotHits).toBeGreaterThan(0);
    expect(engine.events.some((e) => e.type === "fixationLoss")).toBe(true);
  });
});

describe("timing integrity", () => {
  it("discards a trial whose presentation frame was dropped", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    s.frame(120); // a 120 ms stall while the stimulus should have been showing
    engine.press(onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);

    expect(engine.trials[0].outcome).toBe("invalidated");
    expect(engine.trials[0].invalidReason).toBe("frameDrop");
    expect(strategy.results).toHaveLength(0);
  });

  it("shows the stimulus for about 200 ms", () => {
    const { engine } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    let visibleFrames = 0;
    let lastVisibleT = 0;
    for (let i = 0; i < 40; i++) {
      s.frame();
      const rs = engine.update(s.t);
      if (rs.stimulus) {
        visibleFrames++;
        lastVisibleT = s.t;
      }
    }
    expect(visibleFrames).toBeGreaterThan(0);
    expect(lastVisibleT - onset).toBeLessThanOrEqual(200 + 17);
  });

  it("randomises the gap between stimuli", () => {
    const plans = Array.from({ length: 12 }, (_, i) => ({
      ...PLAN_A,
      locId: `p${i}`,
    }));
    const { engine } = makeEngine(plans);
    const s = new Stepper(engine);
    s.start();
    const onsets: number[] = [];
    for (let i = 0; i < 8; i++) {
      const { onset } = s.nextTrialOnset();
      onsets.push(onset);
      s.advance(RESPONSE_MAX_MS + 50);
    }
    const gaps = onsets.slice(1).map((v, i) => v - onsets[i]);
    const unique = new Set(gaps.map((g) => Math.round(g / 50)));
    expect(unique.size).toBeGreaterThan(2);
  });
});

describe("pause and abort", () => {
  it("invalidates the trial in flight when paused, and resumes cleanly", () => {
    const { engine, strategy } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    const { onset } = s.nextTrialOnset();
    engine.pause(onset + 50, "faceLost");
    expect(engine.currentPhase).toBe("paused");
    expect(engine.trials[0].invalidReason).toBe("paused");

    s.advance(2000);
    engine.resume(s.t);
    expect(engine.currentPhase).toBe("running");

    const second = s.nextTrialOnset();
    engine.press(second.onset + 400);
    s.advance(GAZE_WINDOW_END_MS + 100);
    expect(strategy.results).toEqual([{ plan: PLAN_A, seen: true }]);
  });

  it("ignores presses while paused", () => {
    const { engine } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    s.nextTrialOnset();
    engine.pause(s.t, "test");
    engine.press(s.t + 10);
    expect(engine.counts.spontaneousPresses).toBe(0);
  });

  it("excludes paused time from the run duration", () => {
    const { engine } = makeEngine([PLAN_A, PLAN_B]);
    const s = new Stepper(engine);
    s.start();
    s.advance(1000);
    engine.pause(s.t, "test");
    s.advance(5000);
    engine.resume(s.t);
    s.advance(1000);
    expect(engine.activeDurationMs).toBeLessThan(3000);
  });

  it("stops for good on abort", () => {
    const { engine } = makeEngine([PLAN_A]);
    const s = new Stepper(engine);
    s.start();
    s.nextTrialOnset();
    engine.abort(s.t);
    expect(engine.currentPhase).toBe("aborted");
    s.advance(5000);
    expect(engine.currentPhase).toBe("aborted");
  });
});

describe("determinism", () => {
  let a: TestEngine;
  let b: TestEngine;

  beforeEach(() => {
    const plans = Array.from({ length: 20 }, (_, i) => ({
      locId: `p${i}`,
      xDeg: (i % 5) * 3,
      yDeg: Math.floor(i / 5) * 3,
      levelDb: 24,
    }));
    a = makeEngine(plans, { blindSpotEnabled: true }).engine;
    b = makeEngine(plans, { blindSpotEnabled: true }).engine;
  });

  it("replays identically from the same seed and the same inputs", () => {
    for (const engine of [a, b]) {
      const s = new Stepper(engine);
      s.start();
      for (let i = 0; i < 15 && engine.currentPhase === "running"; i++) {
        const { onset } = s.nextTrialOnset();
        if (i % 3 !== 0) engine.press(onset + 380);
        s.advance(RESPONSE_MAX_MS + 100);
      }
    }
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.trials)).toBe(JSON.stringify(b.trials));
    expect(a.counts).toEqual(b.counts);
  });

  it("diverges when the seed changes", () => {
    const other = new TestEngine({
      eye: "OD",
      grid: makeGrid([{ xDeg: 9, yDeg: 9 }]),
      lum: new LuminanceModel({ maxNits: 250, gamma: 2.2 }),
      strategy: new StubStrategy(
        Array.from({ length: 20 }, (_, i) => ({
          locId: `p${i}`,
          xDeg: 0,
          yDeg: 0,
          levelDb: 24,
        })),
      ),
      rng: new Rng(999),
      config: makeConfig(),
      blindSpotEnabled: false,
    });
    const sa = new Stepper(a);
    const so = new Stepper(other);
    sa.start();
    so.start();
    sa.advance(20000);
    so.advance(20000);
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(other.events));
  });
});
