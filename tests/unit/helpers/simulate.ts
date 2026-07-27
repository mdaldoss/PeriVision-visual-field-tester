import { TestEngine } from "../../../src/core/engine";
import { Rng } from "../../../src/core/rng";
import type { EngineEvent, GazeSample, TrialKind } from "../../../src/core/types";

export interface SimObserver {
  /** True sensitivity of the simulated eye at a field location, pseudo-dB. */
  sensitivityDb(xDeg: number, yDeg: number): number;
  /** Probability of pressing during an empty (false-positive catch) window. */
  falsePressRate?: number;
  /** Probability of missing a stimulus that should have been seen. */
  lapseRate?: number;
  /** Reaction time, ms. */
  rtMs?: number;
  /** Set true to model a patient who is not fixating (sees the blind spot). */
  seesBlindSpot?: boolean;
  /** Steepness of the frequency-of-seeing curve, dB. */
  slopeDb?: number;
}

export interface SimOptions {
  frameMs?: number;
  maxSeconds?: number;
  /** Gaze deviation to report, in degrees, as a function of time. */
  gazeDeviationAt?: (t: number) => number;
  blinkAt?: (t: number) => boolean;
  gazeEnabled?: boolean;
  /** Fire an extra press at these absolute times (to model stray presses). */
  extraPressesAt?: number[];
  rngSeed?: number;
}

export interface SimResult {
  endedAt: number;
  frames: number;
  phase: string;
}

/**
 * Drive an engine with a simulated observer. Frames advance at a fixed rate
 * and the observer answers according to a frequency-of-seeing curve, which is
 * what lets us assert that a strategy recovers a known field.
 */
export function simulateRun(
  engine: TestEngine,
  observer: SimObserver,
  opts: SimOptions = {},
): SimResult {
  const frameMs = opts.frameMs ?? 16.7;
  const maxSeconds = opts.maxSeconds ?? 3600;
  const rng = new Rng(opts.rngSeed ?? 987654321);
  const lapse = observer.lapseRate ?? 0.02;
  const slope = observer.slopeDb ?? 1.0;
  const rt = observer.rtMs ?? 420;

  const kindByIndex = new Map<number, TrialKind>();
  const pendingPresses: number[] = [];
  const extras = [...(opts.extraPressesAt ?? [])].sort((a, b) => a - b);
  let watermark = 0;
  let t = 0;
  let frames = 0;

  engine.start(t);

  while (engine.currentPhase === "running" && t < maxSeconds * 1000) {
    t += frameMs;
    frames++;

    if (opts.gazeEnabled !== false) {
      const sample: GazeSample = {
        t,
        faceFound: true,
        deviationDeg: opts.gazeDeviationAt ? opts.gazeDeviationAt(t) : 0,
        blink: opts.blinkAt ? opts.blinkAt(t) : false,
        distanceMm: 330,
        openEye: null,
        qualityDeg: 1.5,
      };
      engine.pushGaze(sample);
    }

    while (extras.length > 0 && extras[0] <= t) {
      extras.shift();
      engine.press(t);
    }
    while (pendingPresses.length > 0 && pendingPresses[0] <= t) {
      pendingPresses.shift();
      engine.press(t);
    }

    engine.update(t);

    // React to whatever the engine just did.
    for (; watermark < engine.events.length; watermark++) {
      const e: EngineEvent = engine.events[watermark];
      if (e.type === "trialScheduled") {
        kindByIndex.set(e.index, e.kind);
        if (e.kind === "fpCatch" && rng.bool(observer.falsePressRate ?? 0)) {
          pendingPresses.push(t + rt);
        }
      } else if (e.type === "stimulusOn") {
        const kind = kindByIndex.get(e.index) ?? "normal";
        if (kind === "blindSpot" && !observer.seesBlindSpot) continue;
        const sens = observer.sensitivityDb(e.xDeg, e.yDeg);
        const p = 1 / (1 + Math.exp(-(sens - (e.levelDb ?? 0)) / slope));
        if (rng.next() < p * (1 - lapse)) {
          pendingPresses.push(t + rt + rng.range(-60, 60));
        }
      }
    }
    pendingPresses.sort((a, b) => a - b);
  }

  return { endedAt: t, frames, phase: engine.currentPhase };
}

/** A uniform field: the same sensitivity everywhere. */
export function flatField(db: number): SimObserver {
  return { sensitivityDb: () => db };
}

/** A field with a defect: everything normal except inside a given box. */
export function fieldWithDefect(
  normalDb: number,
  defectDb: number,
  inDefect: (x: number, y: number) => boolean,
): SimObserver {
  return { sensitivityDb: (x, y) => (inDefect(x, y) ? defectDb : normalDb) };
}
