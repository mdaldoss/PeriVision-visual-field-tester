import type { LuminanceModel } from "./luminance";
import { expectedSensitivityDb, SCREENING_OFFSET_DB } from "./normative";
import type { Rng } from "./rng";
import type { DefectClass, GridPoint, ProtocolId, ResolvedGrid } from "./types";

export interface StimulusPlan {
  locId: string;
  xDeg: number;
  yDeg: number;
  levelDb: number;
}

export interface Strategy {
  readonly id: ProtocolId | "practice";
  /** The next measurement to present, or null when the strategy is finished. */
  next(): StimulusPlan | null;
  /** Feed back the outcome of a presentation this strategy handed out. */
  record(plan: StimulusPlan, seen: boolean): void;
  isComplete(): boolean;
  /** 0..1, for the progress ring. */
  progress(): number;
  /** locId -> pseudo-dB. null means "not seen even at maximum brightness". */
  thresholds(): Record<string, number | null>;
  /** Screening only. */
  classes(): Record<string, DefectClass> | undefined;
}

export interface StrategyDeps {
  grid: ResolvedGrid;
  lum: LuminanceModel;
  age: number;
  rng: Rng;
}

/* ------------------------------------------------------------------ */
/* Suprathreshold screening                                            */
/* ------------------------------------------------------------------ */

type ScreeningState = "todo" | "retest" | "done";

interface ScreeningEntry {
  point: GridPoint;
  state: ScreeningState;
  levelDb: number;
  cls: DefectClass;
}

/**
 * Two-level suprathreshold screening. Each point is shown once at a level
 * comfortably brighter than its expected threshold; misses are retested at the
 * display's maximum. Fast (one or two presentations per point) but it
 * classifies rather than measures.
 */
export class ScreeningStrategy implements Strategy {
  readonly id = "screening";
  private entries = new Map<string, ScreeningEntry>();
  private queue: string[] = [];
  private inFlight = new Set<string>();

  constructor(private deps: StrategyDeps) {
    for (const point of deps.grid.points) {
      const expected = expectedSensitivityDb(point.eccDeg, point.yDeg, deps.age);
      const level = deps.lum.clampDb(expected - SCREENING_OFFSET_DB);
      this.entries.set(point.id, { point, state: "todo", levelDb: level, cls: "normal" });
    }
    this.queue = deps.rng.shuffle([...this.entries.keys()]);
  }

  next(): StimulusPlan | null {
    const locId = this.queue.shift();
    if (!locId) return null;
    const entry = this.entries.get(locId);
    if (!entry || entry.state === "done") return this.next();
    this.inFlight.add(locId);
    const levelDb = entry.state === "retest" ? this.deps.lum.floorDb : entry.levelDb;
    return { locId, xDeg: entry.point.xDeg, yDeg: entry.point.yDeg, levelDb };
  }

  record(plan: StimulusPlan, seen: boolean): void {
    const entry = this.entries.get(plan.locId);
    if (!entry) return;
    this.inFlight.delete(plan.locId);
    if (entry.state === "todo") {
      if (seen) {
        entry.cls = "normal";
        entry.state = "done";
      } else {
        entry.state = "retest";
        // Re-queue a few trials later so the retest is not obviously paired
        // with the miss the user just had.
        const at = Math.min(this.queue.length, this.deps.rng.int(2, 6));
        this.queue.splice(at, 0, plan.locId);
      }
    } else if (entry.state === "retest") {
      entry.cls = seen ? "relative" : "absolute";
      entry.state = "done";
    }
  }

  isComplete(): boolean {
    return this.queue.length === 0 && this.inFlight.size === 0;
  }

  progress(): number {
    let done = 0;
    for (const e of this.entries.values()) if (e.state === "done") done++;
    return done / Math.max(1, this.entries.size);
  }

  thresholds(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const [id, e] of this.entries) {
      // Screening gives a bound, not a threshold: a seen point is "at least
      // this sensitive", a relative defect is at the display floor, and an
      // absolute defect is below anything we can show.
      out[id] = e.cls === "normal" ? e.levelDb : e.cls === "relative" ? this.deps.lum.floorDb : null;
    }
    return out;
  }

  classes(): Record<string, DefectClass> {
    const out: Record<string, DefectClass> = {};
    for (const [id, e] of this.entries) out[id] = e.cls;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Full threshold, 4-2 staircase                                       */
/* ------------------------------------------------------------------ */

interface StairState {
  point: GridPoint;
  level: number;
  step: number;
  reversals: number;
  lastDir: 0 | 1 | -1;
  lastSeen: number | null;
  done: boolean;
  threshold: number | null;
  presentations: number;
}

/** How many locations are measured concurrently, so consecutive trials differ. */
const MAX_ACTIVE = 4;
/** Safety valve: no location gets more presentations than this. */
const MAX_PRESENTATIONS = 12;
/** How far a neighbour's result is allowed to pull a starting level, dB. */
const SEED_SPREAD_DB = 6;

/**
 * Classic 4-2 bracketing: step 4 dB until the first reversal, then 2 dB until
 * the second; the threshold is the dimmest stimulus actually seen. Locations
 * are interleaved so the user cannot anticipate where the next dot appears,
 * and each new location starts from a neighbour's result to save time.
 */
export class StaircaseStrategy implements Strategy {
  readonly id = "threshold";
  private states = new Map<string, StairState>();
  private unstarted: GridPoint[] = [];
  private active: string[] = [];
  private cursor = 0;

  constructor(private deps: StrategyDeps) {
    const pts = [...deps.grid.points];
    const primaries = pickPrimaries(pts);
    for (const p of primaries) this.activate(p, this.seedFor(p));
    this.unstarted = pts.filter((p) => !this.states.has(p.id));
  }

  private seedFor(point: GridPoint): number {
    // Seed from the nearest already-measured neighbour when there is one:
    // neighbouring sensitivities are strongly correlated, so this cuts the
    // number of presentations needed.
    let best: { d: number; db: number } | null = null;
    for (const s of this.states.values()) {
      if (!s.done || s.threshold === null) continue;
      const d = Math.hypot(s.point.xDeg - point.xDeg, s.point.yDeg - point.yDeg);
      if (d <= 12 && (!best || d < best.d)) best = { d, db: s.threshold };
    }
    const expected = expectedSensitivityDb(point.eccDeg, point.yDeg, this.deps.age);
    // Keep the neighbour's influence bounded. Without this, one deep defect
    // seeds its healthy neighbours far too low, and a staircase that starts
    // well below the true threshold can terminate early on the wrong value -
    // the defect would appear to smear outwards across the map.
    const seed = best
      ? Math.min(Math.max(best.db, expected - SEED_SPREAD_DB), expected + SEED_SPREAD_DB)
      : expected;
    return this.deps.lum.clampDb(seed);
  }

  private activate(point: GridPoint, level: number): void {
    this.states.set(point.id, {
      point,
      level,
      step: 4,
      reversals: 0,
      lastDir: 0,
      lastSeen: null,
      done: false,
      threshold: null,
      presentations: 0,
    });
    this.active.push(point.id);
  }

  private fillActive(): void {
    while (this.active.length < MAX_ACTIVE && this.unstarted.length > 0) {
      const point = this.unstarted.shift()!;
      this.activate(point, this.seedFor(point));
    }
  }

  next(): StimulusPlan | null {
    this.fillActive();
    if (this.active.length === 0) return null;
    // Round-robin across the active locations.
    this.cursor = this.cursor % this.active.length;
    const locId = this.active[this.cursor];
    this.cursor++;
    const s = this.states.get(locId)!;
    return { locId, xDeg: s.point.xDeg, yDeg: s.point.yDeg, levelDb: s.level };
  }

  record(plan: StimulusPlan, seen: boolean): void {
    const s = this.states.get(plan.locId);
    if (!s || s.done) return;
    s.presentations++;
    if (seen) s.lastSeen = plan.levelDb;

    const dir: 1 | -1 = seen ? 1 : -1; // +1 = go dimmer, -1 = go brighter
    if (s.lastDir !== 0 && dir !== s.lastDir) {
      s.reversals++;
      if (s.reversals === 1) s.step = 2;
    }
    s.lastDir = dir;

    const { floorDb, ceilingDb } = this.deps.lum;
    const nextLevel = plan.levelDb + dir * s.step;

    if (s.reversals >= 2) return this.finish(s, s.lastSeen);
    if (s.presentations >= MAX_PRESENTATIONS) return this.finish(s, s.lastSeen);
    if (!seen && nextLevel < floorDb - 1e-6) {
      // Already at the brightest the display can do and still not seen.
      return this.finish(s, plan.levelDb <= floorDb + 1e-6 ? null : s.lastSeen);
    }
    if (seen && nextLevel > ceilingDb + 1e-6) {
      // Sees the dimmest stimulus we can render: sensitivity is at or beyond
      // the display's ceiling.
      return this.finish(s, ceilingDb);
    }
    s.level = this.deps.lum.clampDb(nextLevel);
  }

  private finish(s: StairState, threshold: number | null): void {
    s.done = true;
    s.threshold = threshold === null ? null : Math.round(threshold * 10) / 10;
    const i = this.active.indexOf(s.point.id);
    if (i >= 0) {
      this.active.splice(i, 1);
      if (this.cursor > i) this.cursor--;
    }
    this.fillActive();
  }

  isComplete(): boolean {
    return this.active.length === 0 && this.unstarted.length === 0;
  }

  progress(): number {
    let done = 0;
    for (const s of this.states.values()) if (s.done) done++;
    return done / Math.max(1, this.deps.grid.points.length);
  }

  thresholds(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const p of this.deps.grid.points) {
      const s = this.states.get(p.id);
      out[p.id] = s && s.done ? s.threshold : (s?.lastSeen ?? null);
    }
    return out;
  }

  classes(): undefined {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Practice                                                            */
/* ------------------------------------------------------------------ */

/** A handful of obvious stimuli to teach the rhythm. Never scored. */
export class PracticeStrategy implements Strategy {
  readonly id = "practice";
  private remaining: StimulusPlan[];
  private total: number;

  constructor(deps: StrategyDeps, count = 8) {
    const pts = deps.rng.shuffle([...deps.grid.points]).slice(0, count);
    const bright = deps.lum.clampDb(deps.lum.floorDb + 4);
    this.remaining = pts.map((p) => ({
      locId: p.id,
      xDeg: p.xDeg,
      yDeg: p.yDeg,
      levelDb: bright,
    }));
    this.total = this.remaining.length;
  }

  next(): StimulusPlan | null {
    return this.remaining.shift() ?? null;
  }
  record(): void {}
  isComplete(): boolean {
    return this.remaining.length === 0;
  }
  progress(): number {
    return (this.total - this.remaining.length) / Math.max(1, this.total);
  }
  thresholds(): Record<string, number | null> {
    return {};
  }
  classes(): undefined {
    return undefined;
  }
}

/** The four paracentral seed points, one per quadrant, nearest to (+/-9, +/-9). */
function pickPrimaries(points: GridPoint[]): GridPoint[] {
  const targets = [
    { x: 9, y: 9 },
    { x: -9, y: 9 },
    { x: -9, y: -9 },
    { x: 9, y: -9 },
  ];
  const chosen: GridPoint[] = [];
  for (const t of targets) {
    let best: GridPoint | null = null;
    let bestD = Infinity;
    for (const p of points) {
      if (chosen.includes(p)) continue;
      const d = Math.hypot(p.xDeg - t.x, p.yDeg - t.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) chosen.push(best);
  }
  return chosen;
}

export function createStrategy(protocol: ProtocolId, deps: StrategyDeps): Strategy {
  switch (protocol) {
    case "screening":
      return new ScreeningStrategy(deps);
    case "threshold":
    case "central":
      return new StaircaseStrategy(deps);
  }
}
