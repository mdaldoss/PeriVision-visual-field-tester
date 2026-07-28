import { useCallback, useEffect, useRef, useState } from "react";
import { mmToDeg } from "../../core/grid";
import { gaze } from "../../services/instances";
import { useApp } from "../../state/store";
import { useFullscreen, useT } from "../hooks";

/** Fractions of the half-screen each calibration dot sits at. */
const TARGETS: { fx: number; fy: number }[] = [
  { fx: 0, fy: 0 },
  { fx: -0.75, fy: -0.7 },
  { fx: 0.75, fy: -0.7 },
  { fx: 0.75, fy: 0.7 },
  { fx: -0.75, fy: 0.7 },
];

const SETTLE_MS = 700;
const CAPTURE_MS = 1300;

export function GazeCalibration() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const setGazeCalibrated = useApp((s) => s.setGazeCalibrated);
  const device = useApp((s) => s.device);
  const config = useApp((s) => s.config);
  const { request: goFullscreen, exit: exitFullscreen } = useFullscreen();

  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; rmsDeg: number } | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    if (!device) return;
    cancelled.current = false;
    setResult(null);
    setRunning(true);
    await goFullscreen();
    gaze.beginCalibration();

    // Positions are computed from the real viewport so the angles we train on
    // are the angles the user is actually looking at.
    const halfWmm = window.innerWidth / 2 / device.pxPerMm;
    const halfHmm = window.innerHeight / 2 / device.pxPerMm;

    for (let i = 0; i < TARGETS.length; i++) {
      if (cancelled.current) break;
      setIndex(i);
      setCapturing(false);
      await delay(SETTLE_MS);
      if (cancelled.current) break;
      setCapturing(true);
      const target = TARGETS[i];
      const xDeg = mmToDeg(target.fx * halfWmm, config.distanceMm);
      const yDeg = mmToDeg(-target.fy * halfHmm, config.distanceMm);
      await gaze.captureCalibrationPoint(xDeg, yDeg, CAPTURE_MS);
    }

    setCapturing(false);
    setRunning(false);
    if (cancelled.current) return;

    const fit = gaze.finishCalibration();
    setResult({ ok: fit.ok, rmsDeg: fit.rmsDeg });
    setGazeCalibrated(fit.ok);
    await exitFullscreen();
  }, [device, config.distanceMm, goFullscreen, exitFullscreen, setGazeCalibrated]);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  if (running) {
    const target = TARGETS[index];
    return (
      <div
        className="test-surface"
        style={{ background: "#0b1220", display: "grid", placeItems: "center" }}
      >
        <div
          style={{
            position: "absolute",
            left: `${50 + target.fx * 50}%`,
            top: `${50 + target.fy * 50}%`,
            transform: "translate(-50%, -50%)",
            width: capturing ? 22 : 14,
            height: capturing ? 22 : 14,
            borderRadius: "50%",
            background: capturing ? "#4f8cff" : "#8fb4ff",
            boxShadow: capturing ? "0 0 0 8px rgba(79,140,255,0.18)" : "none",
            transition: "all 0.15s ease",
          }}
        />
        <div style={{ position: "absolute", bottom: 40, textAlign: "center", width: "100%" }}>
          <p style={{ margin: 0 }}>{t("gazeCal.lookAt")}</p>
          <p className="small muted" style={{ margin: 0 }}>
            {t("gazeCal.progress", { current: index + 1, total: TARGETS.length })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <h1>{t("gazeCal.title")}</h1>
      <p className="lede">{t("gazeCal.intro")}</p>

      {result && (
        <div className={`card ${result.ok ? "good" : "alert"}`}>
          <p className="small" style={{ marginBottom: 0 }}>
            {result.ok
              ? t("gazeCal.good", { rms: result.rmsDeg.toFixed(1) })
              : t("gazeCal.poor", { rms: result.rmsDeg.toFixed(1) })}
          </p>
        </div>
      )}

      <div className="actions">
        {!result && (
          <button className="primary" onClick={() => void run()}>
            {t("gazeCal.start")}
          </button>
        )}
        {result && (
          <>
            <button className="primary" onClick={() => setStep("practice")}>
              {t("common.continue")}
            </button>
            <button onClick={() => void run()}>{t("common.retry")}</button>
          </>
        )}
        <button
          className="ghost"
          onClick={() => {
            setGazeCalibrated(false);
            setStep("practice");
          }}
        >
          {t("gazeCal.skip")}
        </button>
      </div>
    </div>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
