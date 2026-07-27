import { describe, expect, it } from "vitest";
import { TestEngine } from "../../src/core/engine";
import { resolveGrid, SPEC_24_2 } from "../../src/core/grid";
import { Rng } from "../../src/core/rng";
import { buildEyeResult } from "../../src/core/scoring";
import { PracticeStrategy, ScreeningStrategy, StaircaseStrategy } from "../../src/core/strategies";
import type { ResolvedGrid } from "../../src/core/types";
import { makeConfig, makeDevice, makeLum } from "./helpers/fixtures";
import { fieldWithDefect, flatField, simulateRun, type SimObserver } from "./helpers/simulate";

const device = makeDevice();
const lum = makeLum(device);
const grid: ResolvedGrid = resolveGrid(SPEC_24_2, "OD", device, 300);

function run(
  strategyKind: "threshold" | "screening",
  observer: SimObserver,
  opts: { seed?: number; gaze?: boolean } = {},
) {
  const rng = new Rng(opts.seed ?? 24680);
  const deps = { grid, lum, age: 45, rng };
  const strategy =
    strategyKind === "threshold" ? new StaircaseStrategy(deps) : new ScreeningStrategy(deps);
  const config = makeConfig({
    protocol: strategyKind,
    gazeMonitoring: opts.gaze ?? false,
  });
  const engine = new TestEngine({
    eye: "OD",
    grid,
    lum,
    strategy,
    rng,
    config,
    blindSpotEnabled: true,
  });
  const sim = simulateRun(engine, observer, {
    gazeEnabled: opts.gaze ?? false,
    rngSeed: 13579,
  });
  return { engine, strategy, sim, result: buildEyeResult(engine, strategy, grid, lum, config) };
}

function errors(thresholds: Record<string, number | null>, truth: (x: number, y: number) => number) {
  const errs: number[] = [];
  for (const p of grid.points) {
    const v = thresholds[p.id];
    if (v === null || v === undefined) continue;
    errs.push(Math.abs(v - truth(p.xDeg, p.yDeg)));
  }
  errs.sort((a, b) => a - b);
  return {
    median: errs[Math.floor(errs.length / 2)],
    p90: errs[Math.floor(errs.length * 0.9)],
    max: errs[errs.length - 1],
    n: errs.length,
  };
}

describe("4-2 staircase against a simulated observer", () => {
  it("recovers a uniform field within a couple of dB", () => {
    const { strategy, sim } = run("threshold", { ...flatField(28), slopeDb: 1.0 });
    expect(sim.phase).toBe("complete");
    const e = errors(strategy.thresholds(), () => 28);
    expect(e.n).toBe(grid.points.length);
    expect(e.median).toBeLessThanOrEqual(2);
    expect(e.p90).toBeLessThanOrEqual(4);
  });

  it("measures every point in the grid", () => {
    const { strategy } = run("threshold", flatField(28));
    const t = strategy.thresholds();
    for (const p of grid.points) expect(t).toHaveProperty(p.id);
  });

  it("finds a superior arcuate defect and leaves the rest alone", () => {
    const inDefect = (x: number, y: number) => y > 6 && x > -12;
    const observer = fieldWithDefect(28, 15, inDefect);
    const { strategy } = run("threshold", { ...observer, slopeDb: 1.0 });
    const t = strategy.thresholds();

    const defect: number[] = [];
    const normal: number[] = [];
    for (const p of grid.points) {
      const v = t[p.id];
      if (v === null || v === undefined) continue;
      (inDefect(p.xDeg, p.yDeg) ? defect : normal).push(v);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

    expect(defect.length).toBeGreaterThanOrEqual(8);
    expect(mean(defect)).toBeLessThan(19);
    expect(mean(normal)).toBeGreaterThan(25);
    // A 4-2 staircase is genuinely noisy - a single lapse near the start can
    // cost several dB - so we require the defect to stand out clearly rather
    // than demanding every individual point be perfect.
    expect(mean(normal) - mean(defect)).toBeGreaterThan(8);
    const spilled = normal.filter((v) => v < 22).length;
    expect(spilled / normal.length).toBeLessThan(0.12);
  });

  it("reports a point as unmeasurable when even the brightest stimulus is invisible", () => {
    const inDefect = (x: number, _y: number) => x < -12;
    const { strategy } = run("threshold", fieldWithDefect(28, -5, inDefect));
    const t = strategy.thresholds();
    const dead = grid.points.filter((p) => inDefect(p.xDeg, p.yDeg));
    expect(dead.length).toBeGreaterThan(0);
    for (const p of dead) expect(t[p.id]).toBeNull();
  });

  it("does not present the same location twice in a row", () => {
    const { engine } = run("threshold", flatField(28));
    const normals = engine.trials.filter((t) => t.kind === "normal");
    let repeats = 0;
    for (let i = 1; i < normals.length; i++) {
      if (normals[i].locId === normals[i - 1].locId) repeats++;
    }
    // Interleaving four locations should make consecutive repeats rare.
    expect(repeats / normals.length).toBeLessThan(0.05);
  });

  it("finishes in a clinically plausible time", () => {
    const { engine } = run("threshold", flatField(28));
    const minutes = engine.activeDurationMs / 60000;
    expect(minutes).toBeGreaterThan(3);
    expect(minutes).toBeLessThan(15);
  });

  it("uses a sane number of presentations per location", () => {
    const { engine } = run("threshold", flatField(28));
    const normals = engine.trials.filter((t) => t.kind === "normal" && t.outcome !== "invalidated");
    const perPoint = normals.length / grid.points.length;
    expect(perPoint).toBeGreaterThan(2);
    expect(perPoint).toBeLessThan(7);
  });
});

describe("suprathreshold screening", () => {
  it("passes a normal field", () => {
    const { strategy, sim } = run("screening", flatField(29));
    expect(sim.phase).toBe("complete");
    const classes = strategy.classes()!;
    const abnormal = Object.values(classes).filter((c) => c !== "normal");
    expect(abnormal.length).toBeLessThanOrEqual(2); // allow the odd lapse
  });

  it("separates relative from absolute defects", () => {
    const inRelative = (x: number, y: number) => y > 6 && x > 0;
    const inAbsolute = (x: number, y: number) => y < -6 && x < 0;
    const observer: SimObserver = {
      sensitivityDb: (x, y) => (inAbsolute(x, y) ? -10 : inRelative(x, y) ? 14 : 29),
      slopeDb: 0.8,
    };
    const { strategy } = run("screening", observer);
    const classes = strategy.classes()!;
    for (const p of grid.points) {
      if (inAbsolute(p.xDeg, p.yDeg)) {
        expect(classes[p.id], `absolute ${p.id}`).toBe("absolute");
      } else if (inRelative(p.xDeg, p.yDeg)) {
        expect(classes[p.id], `relative ${p.id}`).toBe("relative");
      }
    }
  });

  it("is much faster than the full threshold test", () => {
    const screening = run("screening", flatField(29));
    const threshold = run("threshold", flatField(29));
    expect(screening.engine.activeDurationMs).toBeLessThan(threshold.engine.activeDurationMs * 0.6);
    expect(screening.engine.activeDurationMs / 60000).toBeLessThan(6);
  });

  it("records a lower bound rather than a threshold for points that pass", () => {
    const { strategy } = run("screening", flatField(29));
    const t = strategy.thresholds();
    const classes = strategy.classes()!;
    for (const p of grid.points) {
      if (classes[p.id] === "normal") expect(typeof t[p.id]).toBe("number");
      if (classes[p.id] === "absolute") expect(t[p.id]).toBeNull();
    }
  });
});

describe("practice", () => {
  it("runs a fixed number of easy trials and stops", () => {
    const rng = new Rng(5);
    const strategy = new PracticeStrategy({ grid, lum, age: 45, rng }, 6);
    const engine = new TestEngine({
      eye: "OD",
      grid,
      lum,
      strategy,
      rng,
      config: makeConfig(),
      blindSpotEnabled: false,
      isPractice: true,
    });
    const sim = simulateRun(engine, flatField(30), { gazeEnabled: false });
    expect(sim.phase).toBe("complete");
    expect(engine.trials.filter((t) => t.kind === "practice")).toHaveLength(6);
    // Practice must never feed the reliability statistics.
    expect(engine.counts.scoredTrials).toBe(0);
    expect(engine.counts.fpCatchTrials).toBe(0);
  });
});
