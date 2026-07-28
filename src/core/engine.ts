import { blindSpotCandidates } from "./grid";
import type { LuminanceModel } from "./luminance";
import type { Rng } from "./rng";
import type { Strategy, StimulusPlan } from "./strategies";
import type {
  EngineEvent,
  Eye,
  GazeSample,
  InvalidReason,
  PressClass,
  PressRecord,
  ReliabilityCounts,
  ResolvedGrid,
  SessionConfig,
  TrialKind,
  TrialOutcome,
  TrialResult,
} from "./types";

/** How long a stimulus stays on screen. Clinical perimeters use 200 ms. */
export const STIMULUS_MS = 200;
/**
 * Presses faster than this after onset cannot be a genuine perception -
 * human reaction time to a threshold stimulus is ~250-600 ms - so they are
 * treated as anticipatory false triggers.
 */
export const RESPONSE_MIN_MS = 180;
/** Presses later than this are no longer attributed to the stimulus. */
export const RESPONSE_MAX_MS = 1500;
/** Window around onset over which fixation must hold for the trial to count. */
export const GAZE_WINDOW_START_MS = -50;
export const GAZE_WINDOW_END_MS = 250;
/** A gap between frames longer than this during a presentation is a dropped frame. */
const FRAME_GAP_LIMIT_MS = 34;
/** Baseline gaze deviation that counts as looking away, degrees. */
const GAZE_DEVIATION_DEG = 4;

const P_FP_CATCH = 0.06;
const P_FN_CATCH = 0.05;
const P_BLIND_SPOT = 0.04;
/** Catch trials only start once the user has settled into the test. */
const CATCH_TRIAL_WARMUP = 8;
/**
 * Minimum number of each kind of catch trial we try to fit into a run. A rate
 * computed from two or three catch trials is noise: it can only come out 0%,
 * 33%, 50%... so a short screening run needs proportionally more of them than
 * a long threshold run to produce a reliability index worth printing.
 */
const TARGET_FP_CATCH = 8;
const TARGET_FN_CATCH = 6;
const TARGET_BLIND_SPOT = 6;
/** Never spend more than this fraction of trials on any single catch type. */
const MAX_CATCH_P = 0.2;

export type EnginePhase = "idle" | "running" | "paused" | "complete" | "aborted";

/**
 * An engine event without its timestamp. `Omit` on its own would collapse the
 * union into just its shared keys, so this distributes over each member.
 */
type EngineEventPayload = EngineEvent extends infer E
  ? E extends { t: number }
    ? Omit<E, "t">
    : never
  : never;

export interface RenderState {
  phase: EnginePhase;
  showFixation: boolean;
  stimulus: { xDeg: number; yDeg: number; levelDb: number } | null;
  progress: number;
  pauseReason?: string;
  trialIndex: number;
}

export interface EngineOptions {
  eye: Eye;
  grid: ResolvedGrid;
  lum: LuminanceModel;
  strategy: Strategy;
  rng: Rng;
  config: SessionConfig;
  /** Whether the blind spot is on screen and usable for fixation checks. */
  blindSpotEnabled: boolean;
  /** Practice runs skip catch trials, scoring and blind-spot work. */
  isPractice?: boolean;
}

interface ActiveTrial {
  index: number;
  kind: TrialKind;
  plan: StimulusPlan;
  /** null for false-positive catch trials, where nothing is shown. */
  levelDb: number | null;
  scheduledOnsetMs: number;
  onsetAt: number;
  pending: { outcome: TrialOutcome; rtMs?: number; reason?: InvalidReason } | null;
  frameDropped: boolean;
}

interface RetryItem {
  plan: StimulusPlan;
  kind: TrialKind;
  dueIndex: number;
}

/**
 * The test engine. It is deterministic and device-free: it only ever sees an
 * injected clock (via update()), a seeded RNG, key presses and gaze samples.
 * Replaying the same inputs reproduces the same run, which is what makes the
 * debug replay and the unit tests possible.
 */
export class TestEngine {
  readonly events: EngineEvent[] = [];
  readonly trials: TrialResult[] = [];
  readonly presses: PressRecord[] = [];
  readonly counts: ReliabilityCounts = {
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
    scoredTrials: 0,
  };

  private phase: EnginePhase = "idle";
  private pauseReason?: string;
  private current: ActiveTrial | null = null;
  private nextTrialAt = 0;
  private trialCounter = 0;
  private retries: RetryItem[] = [];
  private gazeBuffer: GazeSample[] = [];
  private seenLocations: StimulusPlan[] = [];
  private lastUpdateAt = 0;
  private started = false;
  private startedAt = 0;
  private pausedAt = 0;
  private totalPausedMs = 0;
  private rtSamples: number[] = [];

  private blindSpotQueue: { xDeg: number; yDeg: number }[] = [];
  private blindSpot: { xDeg: number; yDeg: number } | null = null;
  private blindSpotSearchDone = false;

  constructor(private readonly opts: EngineOptions) {
    if (opts.blindSpotEnabled && !opts.isPractice) {
      this.blindSpotQueue = blindSpotCandidates(opts.eye);
    } else {
      this.blindSpotSearchDone = true;
    }
  }

  get currentPhase(): EnginePhase {
    return this.phase;
  }

  get blindSpotLocation(): { xDeg: number; yDeg: number } | null {
    return this.blindSpot;
  }

  /** Wall-clock duration of the run with paused time removed. */
  get activeDurationMs(): number {
    if (!this.started) return 0;
    const end = this.phase === "paused" ? this.pausedAt : this.lastUpdateAt;
    return Math.max(0, end - this.startedAt - this.totalPausedMs);
  }

  start(now: number): void {
    if (this.phase !== "idle") return;
    this.phase = "running";
    this.started = true;
    this.startedAt = now;
    this.lastUpdateAt = now;
    this.nextTrialAt = now + 900;
    this.emit(now, { type: "sessionStart", eye: this.opts.eye });
    this.emit(now, { type: "phase", phase: "running" });
  }

  /** Drive the engine. Call once per animation frame with the frame timestamp. */
  update(now: number): RenderState {
    if (this.phase !== "running") {
      this.lastUpdateAt = now;
      return this.renderState(now);
    }

    const gap = now - this.lastUpdateAt;
    this.lastUpdateAt = now;

    const t = this.current;
    if (t) {
      // A long frame gap while the stimulus was supposed to be on screen means
      // we cannot trust that it was shown for the right duration.
      if (gap > FRAME_GAP_LIMIT_MS && now <= t.onsetAt + STIMULUS_MS + gap) {
        t.frameDropped = true;
      }
      if (t.pending === null && now >= t.onsetAt + RESPONSE_MAX_MS) {
        t.pending = { outcome: "notSeen" };
      }
      if (t.pending !== null && now >= t.onsetAt + GAZE_WINDOW_END_MS) {
        this.finalize(now, t);
      }
    } else if (now >= this.nextTrialAt) {
      this.beginTrial(now);
    }

    return this.renderState(now);
  }

  /** Spacebar. */
  press(now: number): PressClass | null {
    if (this.phase !== "running") return null;
    const t = this.current;

    if (!t) {
      // Nothing is being presented and the last response window has closed.
      this.counts.spontaneousPresses++;
      this.record(now, "spontaneous", null);
      return "spontaneous";
    }

    const dt = now - t.onsetAt;

    if (t.kind === "fpCatch") {
      // Nothing was shown, so any press inside the window is a false positive.
      if (dt >= 0 && dt <= RESPONSE_MAX_MS) {
        this.counts.fpCatchHits++;
        this.record(now, "fpCatchHit", t.index, dt);
        if (!t.pending) t.pending = { outcome: "seen", rtMs: dt };
        return "fpCatchHit";
      }
      this.counts.spontaneousPresses++;
      this.record(now, "spontaneous", null);
      return "spontaneous";
    }

    if (dt >= 0 && dt < RESPONSE_MIN_MS) {
      this.counts.anticipatoryPresses++;
      this.record(now, "anticipatory", t.index, dt);
      if (!t.pending) t.pending = { outcome: "invalidated", reason: "anticipatory" };
      return "anticipatory";
    }

    if (dt >= RESPONSE_MIN_MS && dt <= RESPONSE_MAX_MS) {
      if (t.pending) return null; // already resolved by an earlier press
      if (t.kind === "blindSpot") {
        // Seeing a stimulus inside the blind spot means the eye was not on the
        // fixation target (Heijl-Krakau).
        this.counts.blindSpotHits++;
        this.record(now, "blindSpotHit", t.index, dt);
        this.emit(now, { type: "fixationLoss", source: "blindSpot" });
        t.pending = { outcome: "seen", rtMs: dt };
        return "blindSpotHit";
      }
      const cls: PressClass = t.kind === "practice" ? "practice" : "valid";
      this.record(now, cls, t.index, dt);
      this.rtSamples.push(dt);
      t.pending = { outcome: "seen", rtMs: dt };
      return cls;
    }

    this.counts.spontaneousPresses++;
    this.record(now, "spontaneous", null);
    return "spontaneous";
  }

  /** Feed a webcam gaze sample. Safe to call at any rate. */
  pushGaze(sample: GazeSample): void {
    this.gazeBuffer.push(sample);
    const cutoff = sample.t - 4000;
    while (this.gazeBuffer.length > 0 && this.gazeBuffer[0].t < cutoff) this.gazeBuffer.shift();
  }

  pause(now: number, reason: string): void {
    if (this.phase !== "running") return;
    this.phase = "paused";
    this.pauseReason = reason;
    this.pausedAt = now;
    if (this.current) this.invalidate(now, this.current, "paused");
    this.emit(now, { type: "pause", reason });
  }

  resume(now: number): void {
    if (this.phase !== "paused") return;
    this.totalPausedMs += now - this.pausedAt;
    this.phase = "running";
    this.pauseReason = undefined;
    this.lastUpdateAt = now;
    this.nextTrialAt = now + 1200;
    this.emit(now, { type: "resume" });
  }

  abort(now: number): void {
    if (this.phase === "complete" || this.phase === "aborted") return;
    if (this.current) this.invalidate(now, this.current, "aborted");
    this.phase = "aborted";
    this.emit(now, { type: "aborted" });
  }

  /** Median response time over accepted responses, ms. */
  medianRtMs(): number {
    if (this.rtSamples.length === 0) return 0;
    const s = [...this.rtSamples].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  meanRtMs(): number {
    if (this.rtSamples.length === 0) return 0;
    return this.rtSamples.reduce((a, b) => a + b, 0) / this.rtSamples.length;
  }

  /* ---------------------------------------------------------------- */

  private renderState(now: number): RenderState {
    const t = this.current;
    const showStimulus =
      t !== null &&
      t.levelDb !== null &&
      t.pending?.outcome !== "invalidated" &&
      now >= t.onsetAt &&
      now < t.onsetAt + STIMULUS_MS;
    return {
      phase: this.phase,
      showFixation: this.phase === "running" || this.phase === "paused",
      stimulus: showStimulus
        ? { xDeg: t!.plan.xDeg, yDeg: t!.plan.yDeg, levelDb: t!.levelDb! }
        : null,
      progress: this.opts.strategy.progress(),
      pauseReason: this.pauseReason,
      trialIndex: this.trialCounter,
    };
  }

  private beginTrial(now: number): void {
    const picked = this.pickNext();
    if (!picked) {
      this.complete(now);
      return;
    }
    const index = this.trialCounter++;
    const levelDb = picked.kind === "fpCatch" ? null : picked.plan.levelDb;
    this.current = {
      index,
      kind: picked.kind,
      plan: picked.plan,
      levelDb,
      scheduledOnsetMs: this.nextTrialAt,
      onsetAt: now,
      pending: null,
      frameDropped: false,
    };
    this.emit(now, {
      type: "trialScheduled",
      index,
      kind: picked.kind,
      locId: picked.plan.locId,
      levelDb,
    });
    if (levelDb !== null) {
      this.emit(now, {
        type: "stimulusOn",
        index,
        xDeg: picked.plan.xDeg,
        yDeg: picked.plan.yDeg,
        levelDb,
      });
    }
    if (picked.kind === "fpCatch") this.counts.fpCatchTrials++;
    if (picked.kind === "fnCatch") this.counts.fnCatchTrials++;
    if (picked.kind === "blindSpot" && this.blindSpotSearchDone) this.counts.blindSpotTrials++;
  }

  private pickNext(): { plan: StimulusPlan; kind: TrialKind } | null {
    const strategy = this.opts.strategy;

    // 1. Trials thrown away earlier get repeated once enough others have gone by.
    const dueIdx = this.retries.findIndex((r) => r.dueIndex <= this.trialCounter);
    if (dueIdx >= 0) {
      const [item] = this.retries.splice(dueIdx, 1);
      return { plan: item.plan, kind: item.kind };
    }

    if (this.opts.isPractice) {
      const plan = strategy.next();
      return plan ? { plan, kind: "practice" } : this.forcedRetry();
    }

    // 2. Locate the blind spot before anything else so Heijl-Krakau checks work.
    if (!this.blindSpotSearchDone) {
      const candidate = this.blindSpotQueue.shift();
      if (candidate) {
        return {
          kind: "blindSpot",
          plan: {
            locId: "blindspot",
            xDeg: candidate.xDeg,
            yDeg: candidate.yDeg,
            levelDb: this.opts.lum.floorDb,
          },
        };
      }
      this.blindSpotSearchDone = true;
      this.emit(this.lastUpdateAt, { type: "blindSpotNotFound" });
    }

    // 3. Sprinkle in catch trials.
    if (this.trialCounter >= CATCH_TRIAL_WARMUP) {
      const roll = this.opts.rng.next();
      const pFp = this.catchProbability(P_FP_CATCH, this.counts.fpCatchTrials, TARGET_FP_CATCH);
      const pFn = this.catchProbability(P_FN_CATCH, this.counts.fnCatchTrials, TARGET_FN_CATCH);
      const pBs = this.catchProbability(
        P_BLIND_SPOT,
        this.counts.blindSpotTrials,
        TARGET_BLIND_SPOT,
      );
      if (roll < pFp) {
        return {
          kind: "fpCatch",
          plan: { locId: "fpcatch", xDeg: 0, yDeg: 0, levelDb: this.opts.lum.floorDb },
        };
      }
      if (roll < pFp + pFn && this.seenLocations.length >= 5) {
        const target = this.opts.rng.pick(this.seenLocations);
        return {
          kind: "fnCatch",
          plan: { ...target, levelDb: this.opts.lum.floorDb },
        };
      }
      if (roll < pFp + pFn + pBs && this.blindSpot) {
        return {
          kind: "blindSpot",
          plan: {
            locId: "blindspot",
            xDeg: this.blindSpot.xDeg,
            yDeg: this.blindSpot.yDeg,
            levelDb: this.opts.lum.floorDb,
          },
        };
      }
    }

    // 4. A real measurement.
    const plan = strategy.next();
    if (plan) return { plan, kind: "normal" };
    return this.forcedRetry();
  }

  /**
   * How likely the next trial should be a catch trial of a given kind. The
   * rate rises when we are behind the target with few trials left, so short
   * runs still collect enough catch trials to compute a rate from, and long
   * runs are not peppered with them.
   */
  private catchProbability(base: number, done: number, target: number): number {
    if (done >= target) return base * 0.3;
    const remaining = Math.max(1, this.estimatedTotalTrials() - this.trialCounter);
    const needed = (target - done) / remaining;
    return Math.min(MAX_CATCH_P, Math.max(base, needed));
  }

  /** Rough guess at the length of the whole run, from the strategy's progress. */
  private estimatedTotalTrials(): number {
    const p = this.opts.strategy.progress();
    if (p < 0.02) return Math.max(60, this.trialCounter + 40);
    return Math.max(this.trialCounter + 5, Math.round(this.trialCounter / p));
  }

  /** When the strategy is done but re-tests are still owed, run them now. */
  private forcedRetry(): { plan: StimulusPlan; kind: TrialKind } | null {
    const item = this.retries.shift();
    return item ? { plan: item.plan, kind: item.kind } : null;
  }

  private finalize(now: number, t: ActiveTrial): void {
    const pending = t.pending!;
    let outcome = pending.outcome;
    let reason = pending.reason;

    if (t.frameDropped && outcome !== "invalidated") {
      outcome = "invalidated";
      reason = "frameDrop";
    }

    // Fixation and blink veto: a stimulus the eye was not steady for tells us
    // nothing, whether or not the user pressed.
    if (outcome !== "invalidated" && t.kind !== "fpCatch") {
      const verdict = this.checkGaze(t);
      if (verdict.available) this.counts.gazeChecks++;
      if (verdict.problem) {
        outcome = "invalidated";
        reason = verdict.problem;
        if (verdict.problem === "gaze") {
          this.counts.gazeFixationLosses++;
          this.emit(now, {
            type: "fixationLoss",
            source: "gaze",
            deviationDeg: verdict.deviationDeg,
          });
        }
      }
    }

    if (t.levelDb !== null) this.emit(now, { type: "stimulusOff", index: t.index });

    if (outcome === "invalidated") {
      this.invalidate(now, t, reason ?? "gaze");
      return;
    }

    const seen = outcome === "seen";
    this.trials.push({
      index: t.index,
      kind: t.kind,
      locId: t.plan.locId,
      xDeg: t.plan.xDeg,
      yDeg: t.plan.yDeg,
      levelDb: t.levelDb,
      scheduledOnsetMs: t.scheduledOnsetMs,
      measuredOnsetMs: t.onsetAt,
      outcome,
      rtMs: pending.rtMs,
    });
    this.emit(now, { type: "trialResolved", index: t.index, outcome });

    switch (t.kind) {
      case "normal":
        this.counts.scoredTrials++;
        this.opts.strategy.record(t.plan, seen);
        if (seen) this.rememberSeen(t.plan);
        break;
      case "fnCatch":
        if (!seen) this.counts.fnCatchMisses++;
        break;
      case "blindSpot":
        if (!this.blindSpotSearchDone) {
          if (!seen) {
            // Nothing perceived here while fixating: this is the blind spot.
            this.blindSpot = { xDeg: t.plan.xDeg, yDeg: t.plan.yDeg };
            this.blindSpotSearchDone = true;
            this.emit(now, {
              type: "blindSpotFound",
              xDeg: t.plan.xDeg,
              yDeg: t.plan.yDeg,
            });
          } else if (this.blindSpotQueue.length === 0) {
            this.blindSpotSearchDone = true;
            this.emit(now, { type: "blindSpotNotFound" });
          }
        }
        break;
      case "fpCatch":
      case "practice":
        break;
    }

    this.current = null;
    this.nextTrialAt = now + this.nextIsi();
    if (this.opts.strategy.isComplete() && this.retries.length === 0) this.complete(now);
  }

  private rememberSeen(plan: StimulusPlan): void {
    if (this.seenLocations.some((p) => p.locId === plan.locId)) return;
    this.seenLocations.push(plan);
    if (this.seenLocations.length > 40) this.seenLocations.shift();
  }

  private invalidate(now: number, t: ActiveTrial, reason: InvalidReason): void {
    this.counts.invalidatedTrials++;
    this.trials.push({
      index: t.index,
      kind: t.kind,
      locId: t.plan.locId,
      xDeg: t.plan.xDeg,
      yDeg: t.plan.yDeg,
      levelDb: t.levelDb,
      scheduledOnsetMs: t.scheduledOnsetMs,
      measuredOnsetMs: t.onsetAt,
      outcome: "invalidated",
      invalidReason: reason,
    });
    this.emit(now, { type: "trialInvalidated", index: t.index, reason });
    this.emit(now, { type: "trialResolved", index: t.index, outcome: "invalidated", reason });

    // Repeat it later. Catch trials are not repeated: their whole point is to
    // arrive unpredictably, and re-running one would bias the counts.
    if (reason !== "aborted" && (t.kind === "normal" || t.kind === "practice")) {
      this.retries.push({
        plan: t.plan,
        kind: t.kind,
        dueIndex: this.trialCounter + this.opts.rng.int(1, 4),
      });
    }
    this.current = null;
    this.nextTrialAt = now + this.nextIsi();
  }

  /** Was fixation held across this trial's critical window? */
  private checkGaze(t: ActiveTrial): {
    available: boolean;
    problem: InvalidReason | null;
    deviationDeg?: number;
  } {
    if (!this.opts.config.gazeMonitoring) return { available: false, problem: null };
    const from = t.onsetAt + GAZE_WINDOW_START_MS;
    const to = t.onsetAt + GAZE_WINDOW_END_MS;
    const window = this.gazeBuffer.filter((s) => s.t >= from && s.t <= to);
    if (window.length === 0) return { available: false, problem: null };

    for (const s of window) {
      if (s.blink || !s.faceFound) return { available: true, problem: "blink" };
    }
    // Two consecutive deviating samples (~60-70 ms at 30 fps) count as a break;
    // a single noisy sample does not.
    let run = 0;
    let worst = 0;
    for (const s of window) {
      const limit = Math.max(GAZE_DEVIATION_DEG, s.qualityDeg * 1.5);
      if (s.deviationDeg > limit) {
        run++;
        worst = Math.max(worst, s.deviationDeg);
        if (run >= 2) return { available: true, problem: "gaze", deviationDeg: worst };
      } else {
        run = 0;
      }
    }
    return { available: true, problem: null };
  }

  /**
   * Randomised inter-stimulus interval, re-centred on how fast this user
   * actually responds. Randomising is the main defence against a user falling
   * into a rhythm and pressing on the beat rather than on the light.
   */
  private nextIsi(): number {
    const med = this.rtSamples.length >= 5 ? this.medianRtMs() : 500;
    const min = Math.min(Math.max(900 + med * 0.6, 1000), 2200);
    return this.opts.rng.range(min, min + 1600);
  }

  private complete(now: number): void {
    if (this.phase === "complete") return;
    this.phase = "complete";
    this.current = null;
    this.emit(now, { type: "eyeComplete", eye: this.opts.eye });
  }

  private record(t: number, cls: PressClass, trialIndex: number | null, rtMs?: number): void {
    this.presses.push({ tMs: t, class: cls, trialIndex, rtMs });
    this.emit(t, { type: "press", class: cls, trialIndex, rtMs });
  }

  private emit(t: number, e: EngineEventPayload): void {
    this.events.push({ ...(e as object), t } as EngineEvent);
  }
}
