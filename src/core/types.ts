/**
 * Shared domain types for PeriVision.
 *
 * Conventions used throughout the codebase:
 *  - Visual field coordinates are in DEGREES, with +x = right of fixation and
 *    +y = above fixation, as seen by the patient. Screen space maps directly
 *    (a light 10 deg to the right of fixation is drawn 10 deg to the right).
 *  - Sensitivities are in pseudo-dB on an HFA-like scale: HIGHER dB = DIMMER
 *    stimulus = BETTER sensitivity. See core/luminance.ts for why "pseudo".
 *  - All timestamps are milliseconds from an injected clock (performance.now()
 *    in the browser, a fake clock in tests).
 */

export type Eye = "OD" | "OS";

export type ProtocolId = "screening" | "threshold" | "central";

export type StimulusColor = "white" | "red";

export type FixationStyle = "dot" | "cross";

export type TrialKind =
  | "normal" // a real measurement trial
  | "fpCatch" // no stimulus at all: a press here is a false positive
  | "fnCatch" // very bright re-test of a seen location: a miss is a false negative
  | "blindSpot" // Heijl-Krakau fixation check
  | "practice"; // demo trial, not scored

export type TrialOutcome = "seen" | "notSeen" | "invalidated";

export type InvalidReason =
  | "gaze"
  | "blink"
  | "frameDrop"
  | "anticipatory"
  | "paused"
  | "aborted";

/** A location in the test grid. */
export interface GridPoint {
  /** Stable id, e.g. "x-3_y9" — used as the key in threshold maps. */
  id: string;
  xDeg: number;
  yDeg: number;
  /** Eccentricity from fixation, degrees. */
  eccDeg: number;
}

export interface GridSpec {
  id: string;
  /** Human label, e.g. "24-2". */
  label: string;
  /** Nominal points in field degrees, defined for a RIGHT eye (OD). */
  points: { xDeg: number; yDeg: number }[];
  /** Minimum fraction of nominal points that must fit for the grid to be usable. */
  minCoverage: number;
}

/** The grid actually deliverable on this screen at this distance. */
export interface ResolvedGrid {
  spec: GridSpec;
  eye: Eye;
  points: GridPoint[];
  /** points.length / spec.points.length */
  coverage: number;
  maxXDeg: number;
  maxYDeg: number;
  droppedCount: number;
}

export interface DeviceProfile {
  id: string;
  pxPerMm: number;
  screenWmm: number;
  screenHmm: number;
  screenWpx: number;
  screenHpx: number;
  /** Estimated display gamma from the calibration check. */
  gamma: number;
  /** Estimated peak luminance in cd/m^2. A guess unless the user knows better. */
  maxNits: number;
  userAgent: string;
  calibratedAt: string;
}

export interface SessionConfig {
  eyeOrder: Eye[];
  protocol: ProtocolId;
  gridSpecId: string;
  /** Locked-in viewing distance for the run. */
  distanceMm: number;
  stimulusColor: StimulusColor;
  fixationStyle: FixationStyle;
  gazeMonitoring: boolean;
  /** Age is used only for the (approximate) expected hill-of-vision. */
  age: number;
  seed: number;
  locale: string;
  debug: boolean;
  /** Audible click on each accepted response. Off by default: it leaks information. */
  responseFeedback: boolean;
}

export interface TrialResult {
  index: number;
  kind: TrialKind;
  locId: string;
  xDeg: number;
  yDeg: number;
  /** Requested level in pseudo-dB. null for fpCatch (nothing shown). */
  levelDb: number | null;
  /** When the engine intended to show it. */
  scheduledOnsetMs: number;
  /** When the renderer reported the first frame actually appeared. */
  measuredOnsetMs: number;
  outcome: TrialOutcome;
  rtMs?: number;
  invalidReason?: InvalidReason;
}

export type PressClass =
  | "valid"
  | "anticipatory"
  | "spontaneous"
  | "fpCatchHit"
  | "blindSpotHit"
  | "practice";

export interface PressRecord {
  tMs: number;
  class: PressClass;
  trialIndex: number | null;
  rtMs?: number;
}

export interface ReliabilityCounts {
  fpCatchTrials: number;
  fpCatchHits: number;
  fnCatchTrials: number;
  fnCatchMisses: number;
  blindSpotTrials: number;
  blindSpotHits: number;
  /** Fixation losses detected by the webcam (distinct from blind-spot hits). */
  gazeFixationLosses: number;
  /** Presses that fell outside any response window. */
  spontaneousPresses: number;
  /** Presses too fast after onset to be a real perception. */
  anticipatoryPresses: number;
  /** Trials thrown away and re-queued for any reason. */
  invalidatedTrials: number;
  /** Trials for which webcam gaze data was actually available to check. */
  gazeChecks: number;
  /** Total scored presentations (excludes practice and invalidated trials). */
  scoredTrials: number;
}

export interface ReliabilitySummary extends ReliabilityCounts {
  /** Combined blind-spot + gaze fixation loss rate, 0..1. */
  fixationLossRate: number;
  /** False positive rate, 0..1. */
  falsePositiveRate: number;
  /** False negative rate, 0..1. */
  falseNegativeRate: number;
  verdict: "reliable" | "low";
  reasons: string[];
}

export type DefectClass = "normal" | "relative" | "absolute";

export interface EyeResult {
  eye: Eye;
  protocol: ProtocolId;
  gridLabel: string;
  /** locId -> threshold in pseudo-dB. null means "not seen even at max". */
  thresholds: Record<string, number | null>;
  /** Screening protocol only. */
  classes?: Record<string, DefectClass>;
  points: GridPoint[];
  reliability: ReliabilitySummary;
  trials: TrialResult[];
  presses: PressRecord[];
  /** Full ordered event log. Replaying it reproduces the run exactly. */
  events: EngineEvent[];
  durationMs: number;
  meanRtMs: number;
  medianRtMs: number;
  blindSpot?: { xDeg: number; yDeg: number } | null;
  maxXDeg: number;
  maxYDeg: number;
  /** dB value corresponding to the brightest stimulus this display can show. */
  floorDb: number;
  /** Set when the run happened with debug tools active. */
  debugRun: boolean;
}

export interface Session {
  id: string;
  startedAt: string;
  finishedAt?: string;
  config: SessionConfig;
  device: DeviceProfile;
  results: EyeResult[];
  appVersion: string;
}

/** Everything the engine ever emits, in order. Replaying this reproduces a run. */
export type EngineEvent =
  | { t: number; type: "sessionStart"; eye: Eye }
  | { t: number; type: "phase"; phase: string }
  | { t: number; type: "trialScheduled"; index: number; kind: TrialKind; locId: string; levelDb: number | null }
  | { t: number; type: "stimulusOn"; index: number; xDeg: number; yDeg: number; levelDb: number | null }
  | { t: number; type: "stimulusOff"; index: number }
  | { t: number; type: "press"; class: PressClass; trialIndex: number | null; rtMs?: number }
  | { t: number; type: "trialResolved"; index: number; outcome: TrialOutcome; reason?: InvalidReason }
  | { t: number; type: "fixationLoss"; source: "gaze" | "blindSpot"; deviationDeg?: number }
  | { t: number; type: "trialInvalidated"; index: number; reason: InvalidReason }
  | { t: number; type: "pause"; reason: string }
  | { t: number; type: "resume" }
  | { t: number; type: "blindSpotFound"; xDeg: number; yDeg: number }
  | { t: number; type: "blindSpotNotFound" }
  | { t: number; type: "eyeComplete"; eye: Eye }
  | { t: number; type: "aborted" };

/** Live gaze sample handed to the engine. */
export interface GazeSample {
  t: number;
  faceFound: boolean;
  /** Angular deviation of gaze from the fixation target, degrees. */
  deviationDeg: number;
  blink: boolean;
  /** Estimated eye-to-screen distance, mm. */
  distanceMm: number | null;
  /** Which eye the camera believes is open. null = unknown/both/neither. */
  openEye: Eye | null;
  /** Calibration residual, degrees. Large values mean "trust this less". */
  qualityDeg: number;
}
