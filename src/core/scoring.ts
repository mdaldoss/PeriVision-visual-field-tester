import type { TestEngine } from "./engine";
import type { LuminanceModel } from "./luminance";
import { expectedSensitivityDb } from "./normative";
import { summarizeReliability } from "./reliability";
import type { Strategy } from "./strategies";
import type { DefectClass, EyeResult, GridPoint, ResolvedGrid, SessionConfig } from "./types";

export function buildEyeResult(
  engine: TestEngine,
  strategy: Strategy,
  grid: ResolvedGrid,
  lum: LuminanceModel,
  config: SessionConfig,
): EyeResult {
  return {
    eye: grid.eye,
    protocol: config.protocol,
    gridLabel: grid.spec.label,
    thresholds: strategy.thresholds(),
    classes: strategy.classes(),
    points: grid.points,
    reliability: summarizeReliability(engine.counts),
    trials: engine.trials,
    presses: engine.presses,
    events: engine.events,
    durationMs: engine.activeDurationMs,
    meanRtMs: Math.round(engine.meanRtMs()),
    medianRtMs: Math.round(engine.medianRtMs()),
    blindSpot: engine.blindSpotLocation,
    maxXDeg: grid.maxXDeg,
    maxYDeg: grid.maxYDeg,
    floorDb: lum.floorDb,
    debugRun: config.debug,
  };
}

/** Mean of all measured thresholds. Points with no measurement count as the floor. */
export function meanSensitivityDb(result: EyeResult): number {
  const vals = result.points.map((p) => {
    const v = result.thresholds[p.id];
    return v === null || v === undefined ? result.floorDb : v;
  });
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Difference between measured and age-expected sensitivity, averaged over the
 * grid. Analogous to a clinical Mean Deviation but based on our approximate
 * hill-of-vision rather than a normative database, so it is labelled as an
 * estimate everywhere it is shown.
 */
export function meanDeviationDb(result: EyeResult, age: number): number {
  let sum = 0;
  let n = 0;
  for (const p of result.points) {
    const v = result.thresholds[p.id];
    const measured = v === null || v === undefined ? result.floorDb : v;
    sum += measured - expectedSensitivityDb(p.eccDeg, p.yDeg, age);
    n++;
  }
  return n === 0 ? 0 : sum / n;
}

export interface FieldSample {
  xDeg: number;
  yDeg: number;
  /** Sensitivity in pseudo-dB; the floor is used where nothing was seen. */
  db: number;
  measured: boolean;
}

export function toFieldSamples(result: EyeResult): FieldSample[] {
  return result.points.map((p) => {
    const v = result.thresholds[p.id];
    const missing = v === null || v === undefined;
    return { xDeg: p.xDeg, yDeg: p.yDeg, db: missing ? result.floorDb : v, measured: !missing };
  });
}

/**
 * Inverse-distance-weighted interpolation, used to paint the grayscale map
 * between the tested points. Power 2 with a small neighbourhood keeps the map
 * from smearing a deep local defect across the whole quadrant.
 */
export function interpolateDb(
  samples: FieldSample[],
  xDeg: number,
  yDeg: number,
  neighbours = 4,
): number | null {
  if (samples.length === 0) return null;
  const scored = samples
    .map((s) => ({ s, d: Math.hypot(s.xDeg - xDeg, s.yDeg - yDeg) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, neighbours);
  if (scored[0].d < 1e-6) return scored[0].s.db;
  let num = 0;
  let den = 0;
  for (const { s, d } of scored) {
    const w = 1 / (d * d);
    num += w * s.db;
    den += w;
  }
  return den === 0 ? null : num / den;
}

/**
 * Map a sensitivity to a 0..1 lightness for the grayscale map, matching the
 * clinical convention: sensitive areas print light, defects print dark.
 */
export function dbToLightness(db: number, floorDb: number, ceilingDb: number): number {
  const span = Math.max(1, ceilingDb - floorDb);
  const t = (db - floorDb) / span;
  return Math.min(1, Math.max(0, t));
}

export function classifyAgainstExpected(
  point: GridPoint,
  db: number | null,
  age: number,
  floorDb: number,
): DefectClass {
  if (db === null) return "absolute";
  const expected = expectedSensitivityDb(point.eccDeg, point.yDeg, age);
  if (db <= floorDb + 0.5) return "relative";
  return db >= expected - 5 ? "normal" : "relative";
}
