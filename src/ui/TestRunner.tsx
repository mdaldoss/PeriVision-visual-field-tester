import { useCallback, useEffect, useRef, useState } from "react";
import { TestEngine } from "../core/engine";
import { blindSpotUsable } from "../core/grid";
import { Rng } from "../core/rng";
import { shouldWarnFalsePositives } from "../core/reliability";
import { buildEyeResult } from "../core/scoring";
import { createStrategy, PracticeStrategy, type Strategy } from "../core/strategies";
import type { EyeResult, GazeSample } from "../core/types";
import { formatDistance } from "../services/calibration";
import { InputService } from "../services/input";
import { audio, gaze } from "../services/instances";
import { StimulusRenderer } from "../services/renderer";
import { currentEye, geometryFor, luminanceFor, useApp } from "../state/store";
import { DebugPanel } from "./DebugPanel";
import { describeEvent, type LogLine } from "./debugFormat";
import { useFullscreen, useT, useWakeLock } from "./hooks";

/** How long a bad condition must persist before we interrupt the test. */
const FACE_LOST_MS = 1500;
const EYE_MISMATCH_MS = 2000;
const DISTANCE_DRIFT_MS = 3000;
const DISTANCE_TOLERANCE = 0.15;

export interface TestRunnerProps {
  mode: "practice" | "test";
  onPracticeDone: (seen: number, total: number) => void;
  onEyeDone: (result: EyeResult) => void;
  onAbort: () => void;
}

type Screen = "intro" | "countdown" | "running" | "finished";

export function TestRunner({ mode, onPracticeDone, onEyeDone, onAbort }: TestRunnerProps) {
  const t = useT();
  const device = useApp((s) => s.device)!;
  const config = useApp((s) => s.config);
  const eyeIndex = useApp((s) => s.eyeIndex);
  const cameraEnabled = useApp((s) => s.cameraEnabled);
  const { request: goFullscreen, exit: exitFullscreen } = useFullscreen();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TestEngine | null>(null);
  const strategyRef = useRef<Strategy | null>(null);
  const rendererRef = useRef<StimulusRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const logRef = useRef<LogLine[]>([]);
  const watermarkRef = useRef(0);
  const badSinceRef = useRef<Record<string, number | null>>({});
  const lastGazeRef = useRef<GazeSample | null>(null);
  const finishedRef = useRef(false);

  const [screen, setScreen] = useState<Screen>("intro");
  const [countdown, setCountdown] = useState(3);
  const [paused, setPaused] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [warnFp, setWarnFp] = useState(false);
  const [practiceSummary, setPracticeSummary] = useState({ seen: 0, total: 0 });
  const [showDebug, setShowDebug] = useState(config.debug);

  const eye = currentEye({ config, eyeIndex });
  useWakeLock(screen === "running");

  /* ---------- build the engine once per run ---------- */
  const buildEngine = useCallback(() => {
    const geom = geometryFor(device, config, eyeIndex);
    const lum = luminanceFor(device);
    const rng = new Rng(config.seed + eyeIndex * 7919 + (mode === "practice" ? 104729 : 0));
    const deps = { grid: geom.grid, lum, age: config.age, rng };
    const strategy =
      mode === "practice" ? new PracticeStrategy(deps, 8) : createStrategy(config.protocol, deps);
    const engine = new TestEngine({
      eye,
      grid: geom.grid,
      lum,
      strategy,
      rng,
      config,
      blindSpotEnabled: mode === "test" && blindSpotUsable(eye, device, config.distanceMm),
      isPractice: mode === "practice",
    });
    strategyRef.current = strategy;
    engineRef.current = engine;
    return { engine, geom, lum };
  }, [device, config, eyeIndex, eye, mode]);

  /* ---------- gaze plumbing ---------- */
  useEffect(() => {
    if (!cameraEnabled) return;
    return gaze.onSample((sample) => {
      lastGazeRef.current = sample;
      const engine = engineRef.current;
      if (!engine) return;
      engine.pushGaze(sample);

      if (engine.currentPhase !== "running") return;
      const now = sample.t;
      const check = (key: string, bad: boolean, limitMs: number, reason: string) => {
        const since = badSinceRef.current[key];
        if (!bad) {
          badSinceRef.current[key] = null;
          return;
        }
        if (since === null || since === undefined) {
          badSinceRef.current[key] = now;
          return;
        }
        if (now - since >= limitMs) {
          badSinceRef.current[key] = null;
          engine.pause(now, reason);
        }
      };

      check("face", !sample.faceFound, FACE_LOST_MS, "faceLost");
      // Only complain about the wrong eye when the camera is confident.
      check(
        "eye",
        sample.openEye !== null && sample.openEye !== eye,
        EYE_MISMATCH_MS,
        "eyeMismatch",
      );
      check(
        "distance",
        sample.distanceMm !== null &&
          Math.abs(sample.distanceMm / config.distanceMm - 1) > DISTANCE_TOLERANCE,
        DISTANCE_DRIFT_MS,
        "distance",
      );
    });
  }, [cameraEnabled, eye, config.distanceMm]);

  /* ---------- finish ---------- */
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const engine = engineRef.current;
    const strategy = strategyRef.current;
    if (!engine || !strategy) return;

    if (mode === "practice") {
      const seen = engine.trials.filter((x) => x.outcome === "seen").length;
      const total = engine.trials.filter((x) => x.outcome !== "invalidated").length;
      setPracticeSummary({ seen, total });
      setScreen("finished");
      void exitFullscreen();
      return;
    }

    const geom = geometryFor(device, config, eyeIndex);
    const lum = luminanceFor(device);
    const result = buildEyeResult(engine, strategy, geom.grid, lum, config);
    void exitFullscreen();
    onEyeDone(result);
  }, [mode, device, config, eyeIndex, onEyeDone, exitFullscreen]);

  // The run loop reaches finish() through a ref so that a re-render cannot
  // restart the run just because a callback identity changed.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  /* ---------- the frame loop ---------- */
  const startRun = useCallback(async () => {
    finishedRef.current = false;
    logRef.current = [];
    watermarkRef.current = 0;
    setLog([]);
    setWarnFp(false);
    setCountdown(3);
    // Fullscreen and audio both have to be unlocked from the click itself.
    await goFullscreen();
    await audio.unlock();
    // The canvas only exists once we leave the intro screen, so the engine is
    // wired up in the effect below - after React has committed it.
    setScreen("countdown");
  }, [goFullscreen]);

  useEffect(() => {
    if (screen !== "countdown") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const { engine, lum } = buildEngine();
    const renderer = new StimulusRenderer(canvas, lum, {
      pxPerMm: device.pxPerMm,
      distanceMm: config.distanceMm,
      stimulusSizeDeg: 0.43,
      color: config.stimulusColor,
      fixation: config.fixationStyle,
    });
    rendererRef.current = renderer;
    renderer.resize();
    // Paint the background straight away so the countdown happens on the same
    // gray the test will use, and the eye is already adapted when it starts.
    renderer.draw({ showFixation: true, stimulus: null, progress: 0 });

    const loop = (now: number) => {
      const state = engine.update(now);
      const g = lastGazeRef.current;
      const debugInfo = config.debug ? gaze.getDebug() : null;
      renderer.draw({
        showFixation: state.showFixation,
        stimulus: state.stimulus,
        progress: state.progress,
        debugGaze:
          debugInfo && g && g.faceFound
            ? {
                xDeg: debugInfo.gazeXDeg,
                yDeg: debugInfo.gazeYDeg,
                deviationDeg: g.deviationDeg,
              }
            : null,
      });

      drainEvents(engine, watermarkRef, logRef, config.debug);
      setPaused(state.phase === "paused" ? (state.pauseReason ?? "manual") : null);

      if (state.phase === "complete" || state.phase === "aborted") {
        finishRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    void (async () => {
      for (let i = 3; i > 0; i--) {
        if (cancelled) return;
        setCountdown(i);
        await delay(800);
      }
      if (cancelled) return;
      engine.start(performance.now());
      rafRef.current = requestAnimationFrame(loop);
      setScreen("running");
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, buildEngine, device.pxPerMm, config]);

  /* ---------- input ---------- */
  useEffect(() => {
    const input = new InputService({
      onPress: (now) => {
        const engine = engineRef.current;
        if (!engine) return;
        if (engine.currentPhase === "paused") {
          if (canResume(lastGazeRef.current, eye, config.distanceMm, cameraEnabled)) {
            Object.keys(badSinceRef.current).forEach((k) => (badSinceRef.current[k] = null));
            engine.resume(now);
          }
          return;
        }
        const cls = engine.press(now);
        if (cls && config.responseFeedback && (cls === "valid" || cls === "practice")) {
          audio.play("responseClick");
        }
      },
      onPause: () => {
        const engine = engineRef.current;
        if (!engine) return;
        if (engine.currentPhase === "running") engine.pause(performance.now(), "manual");
        else if (engine.currentPhase === "paused") engine.resume(performance.now());
      },
      onAbort: () => {
        const engine = engineRef.current;
        if (!engine || engine.currentPhase === "complete") return;
        if (window.confirm(t("test.abortConfirm"))) {
          engine.abort(performance.now());
          void exitFullscreen();
          onAbort();
        }
      },
      onToggleDebug: () => setShowDebug((v) => !v),
    });
    input.attach();
    return () => input.detach();
  }, [t, eye, config.distanceMm, config.responseFeedback, cameraEnabled, onAbort, exitFullscreen]);

  /* ---------- housekeeping ---------- */
  useEffect(() => {
    const onResize = () => rendererRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Mirror the rolling log into React a few times a second rather than every frame.
  useEffect(() => {
    if (screen !== "running") return;
    const id = window.setInterval(() => {
      setLog([...logRef.current]);
      const engine = engineRef.current;
      if (engine) setWarnFp(shouldWarnFalsePositives(engine.counts));
    }, 250);
    return () => window.clearInterval(id);
  }, [screen]);

  /* ---------- screens ---------- */
  if (screen === "intro") {
    return (
      <div className="wrap">
        <h1>{mode === "practice" ? t("practice.title") : t("test.getReady")}</h1>
        <div className="card">
          <p>{t("practice.instruction")}</p>
          {mode === "practice" && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              {t("practice.hint")}
            </p>
          )}
          {mode === "test" && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              {t("test.keysHint")}
            </p>
          )}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => void startRun()}>
            {mode === "practice" ? t("practice.start") : t("common.start")}
          </button>
          <button className="ghost" onClick={onAbort}>
            {t("common.back")}
          </button>
        </div>
      </div>
    );
  }

  if (screen === "finished" && mode === "practice") {
    return (
      <div className="wrap">
        <h1>{t("practice.title")}</h1>
        <div className="card good">
          <p style={{ marginBottom: 0 }}>
            {t("practice.done", { seen: practiceSummary.seen, total: practiceSummary.total })}
          </p>
        </div>
        <div className="actions">
          <button
            className="primary"
            onClick={() => onPracticeDone(practiceSummary.seen, practiceSummary.total)}
          >
            {t("practice.continue")}
          </button>
          <button
            onClick={() => {
              setScreen("intro");
              finishedRef.current = false;
            }}
          >
            {t("practice.repeat")}
          </button>
        </div>
      </div>
    );
  }

  const pauseMessage = () => {
    switch (paused) {
      case "faceLost":
        return t("test.pauseFaceLost");
      case "eyeMismatch":
        return t("test.pauseEyeMismatch");
      case "distance":
        return t("test.pauseDistance", {
          distance: formatDistance(config.distanceMm, config.locale),
        });
      default:
        return t("test.pauseManual");
    }
  };

  return (
    <>
      <div className="test-surface">
        <canvas ref={canvasRef} />
      </div>

      {screen === "countdown" && (
        <div className="overlay">
          <div className="panel">
            <h1>{t("test.countdown", { seconds: countdown })}</h1>
            <p className="muted">{t("test.instructionShort")}</p>
          </div>
        </div>
      )}

      {paused && (
        <div className="overlay">
          <div className="panel">
            <h1>{t("test.pausedTitle")}</h1>
            <p>{pauseMessage()}</p>
            <p className="muted small">{t("test.resume")}</p>
          </div>
        </div>
      )}

      {!paused && screen === "running" && warnFp && (
        <div className="hint-toast">{t("test.fpWarning")}</div>
      )}

      {showDebug && screen === "running" && (
        <DebugPanel
          log={log}
          engine={engineRef.current}
          seed={config.seed}
          onClear={() => {
            logRef.current = [];
            setLog([]);
          }}
          onSimulatePress={() => engineRef.current?.press(performance.now())}
          onSimulateGazeLoss={() => {
            const now = performance.now();
            for (let i = 0; i < 5; i++) {
              engineRef.current?.pushGaze({
                t: now + i,
                faceFound: true,
                deviationDeg: 25,
                blink: false,
                distanceMm: config.distanceMm,
                openEye: eye,
                qualityDeg: 1.5,
              });
            }
          }}
        />
      )}
    </>
  );
}

/** Pull new engine events into the log, and play their sounds in debug mode. */
function drainEvents(
  engine: TestEngine,
  watermark: React.MutableRefObject<number>,
  log: React.MutableRefObject<LogLine[]>,
  debug: boolean,
): void {
  for (; watermark.current < engine.events.length; watermark.current++) {
    const described = describeEvent(engine.events[watermark.current]);
    if (!described) continue;
    log.current.push(described.line);
    if (log.current.length > 400) log.current.shift();
    if (debug && described.sound) audio.play(described.sound);
  }
}

function canResume(
  sample: GazeSample | null,
  eye: string,
  targetMm: number,
  cameraEnabled: boolean,
): boolean {
  if (!cameraEnabled || !sample) return true;
  if (!sample.faceFound) return false;
  if (sample.openEye !== null && sample.openEye !== eye) return false;
  if (sample.distanceMm !== null && Math.abs(sample.distanceMm / targetMm - 1) > DISTANCE_TOLERANCE)
    return false;
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
