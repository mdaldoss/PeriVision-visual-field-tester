import { create } from "zustand";
import { getGridSpec, recommendedDistanceMm, resolveGrid } from "../core/grid";
import { LuminanceModel } from "../core/luminance";
import { randomSeed } from "../core/rng";
import type { DeviceProfile, EyeResult, ResolvedGrid, Session, SessionConfig } from "../core/types";
import { detectLocale, type Locale } from "../i18n";

export const APP_VERSION = "0.1.0";

export type Step =
  | "welcome"
  | "environment"
  | "screenCal"
  | "camera"
  | "setup"
  | "eyeCover"
  | "distance"
  | "gazeCal"
  | "practice"
  | "test"
  | "betweenEyes"
  | "results"
  | "history";

function defaultConfig(locale: Locale): SessionConfig {
  return {
    eyeOrder: ["OD", "OS"],
    protocol: "screening",
    gridSpecId: "24-2",
    distanceMm: 330,
    stimulusColor: "white",
    fixationStyle: "dot",
    gazeMonitoring: false,
    age: 45,
    seed: randomSeed(),
    locale,
    debug: false,
    responseFeedback: false,
  };
}

interface AppState {
  step: Step;
  locale: Locale;
  device: DeviceProfile | null;
  config: SessionConfig;
  /** Index into config.eyeOrder for the eye currently being set up or tested. */
  eyeIndex: number;
  results: EyeResult[];
  session: Session | null;
  cameraEnabled: boolean;
  gazeCalibrated: boolean;
  practiceDone: boolean;
  error: string | null;

  setStep: (step: Step) => void;
  setLocale: (locale: Locale) => void;
  setDevice: (device: DeviceProfile) => void;
  patchConfig: (patch: Partial<SessionConfig>) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setGazeCalibrated: (ok: boolean) => void;
  setPracticeDone: (done: boolean) => void;
  setError: (message: string | null) => void;

  beginSession: () => void;
  completeEye: (result: EyeResult) => void;
  finishSession: () => Session | null;
  loadSession: (session: Session) => void;
  reset: () => void;
}

export const useApp = create<AppState>((set, get) => {
  const locale = detectLocale();
  return {
    step: "welcome",
    locale,
    device: null,
    config: defaultConfig(locale),
    eyeIndex: 0,
    results: [],
    session: null,
    cameraEnabled: false,
    gazeCalibrated: false,
    practiceDone: false,
    error: null,

    setStep: (step) => set({ step }),
    setLocale: (nextLocale) =>
      set((s) => ({
        locale: nextLocale,
        config: { ...s.config, locale: nextLocale },
      })),
    setDevice: (device) => set({ device }),
    patchConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
    setCameraEnabled: (cameraEnabled) =>
      set((s) => ({
        cameraEnabled,
        config: { ...s.config, gazeMonitoring: cameraEnabled },
        gazeCalibrated: cameraEnabled ? s.gazeCalibrated : false,
      })),
    setGazeCalibrated: (gazeCalibrated) => set({ gazeCalibrated }),
    setPracticeDone: (practiceDone) => set({ practiceDone }),
    setError: (error) => set({ error }),

    beginSession: () =>
      set((s) => ({
        eyeIndex: 0,
        results: [],
        session: null,
        practiceDone: false,
        // A fresh seed per session keeps runs independent but still replayable.
        config: { ...s.config, seed: randomSeed() },
      })),

    completeEye: (result) =>
      set((s) => ({
        results: [...s.results, result],
        eyeIndex: s.eyeIndex + 1,
      })),

    finishSession: () => {
      const { device, config, results } = get();
      if (!device || results.length === 0) return null;
      const session: Session = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        config,
        device,
        results,
        appVersion: APP_VERSION,
      };
      set({ session });
      return session;
    },

    loadSession: (session) =>
      set({
        session,
        results: session.results,
        config: session.config,
        device: session.device,
        step: "results",
      }),

    reset: () =>
      set((s) => ({
        step: "welcome",
        eyeIndex: 0,
        results: [],
        session: null,
        practiceDone: false,
        config: { ...defaultConfig(s.locale), age: s.config.age },
      })),
  };
});

/** The eye currently being set up or tested. */
export function currentEye(state: { config: SessionConfig; eyeIndex: number }) {
  return state.config.eyeOrder[Math.min(state.eyeIndex, state.config.eyeOrder.length - 1)];
}

export function luminanceFor(device: DeviceProfile): LuminanceModel {
  return new LuminanceModel({ maxNits: device.maxNits, gamma: device.gamma });
}

export interface Geometry {
  grid: ResolvedGrid;
  recommendedMm: number;
  coverageOk: boolean;
}

/** Resolve the grid for the current eye, screen and distance. */
export function geometryFor(
  device: DeviceProfile,
  config: SessionConfig,
  eyeIndex: number,
): Geometry {
  const spec = getGridSpec(config.gridSpecId);
  const eye = config.eyeOrder[Math.min(eyeIndex, config.eyeOrder.length - 1)];
  const recommendedMm = recommendedDistanceMm(spec, device);
  const grid = resolveGrid(spec, eye, device, config.distanceMm || recommendedMm);
  return { grid, recommendedMm, coverageOk: grid.coverage >= spec.minCoverage };
}

/** Rough duration estimate shown on the setup screen, minutes per eye. */
export function estimateMinutes(protocol: SessionConfig["protocol"], points: number): number {
  const perPoint = protocol === "screening" ? 1.25 : 4.2;
  const secondsPerTrial = 3.0;
  return Math.round(((points * perPoint * secondsPerTrial) / 60) * 10) / 10;
}
