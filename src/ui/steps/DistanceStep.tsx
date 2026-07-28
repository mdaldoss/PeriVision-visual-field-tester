import { useState } from "react";
import { formatDistance } from "../../services/calibration";
import { gaze } from "../../services/instances";
import { useApp } from "../../state/store";
import { useGazeDebug, useT } from "../hooks";

/** Acceptable band around the target distance, as a fraction. */
const TOLERANCE = 0.1;

export function DistanceStep() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const config = useApp((s) => s.config);
  const cameraEnabled = useApp((s) => s.cameraEnabled);
  const gazeCalibrated = useApp((s) => s.gazeCalibrated);
  const info = useGazeDebug(150);
  const [actualCm, setActualCm] = useState("");

  const target = config.distanceMm;
  const live = info.rawDistanceMm;
  const cameraUsable = cameraEnabled && info.status === "ready" && live !== null;

  const ratio = cameraUsable ? live! / target : 1;
  const inBand = Math.abs(ratio - 1) <= TOLERANCE;
  const hint = !cameraUsable
    ? null
    : ratio > 1 + TOLERANCE
      ? t("distance.moveCloser")
      : ratio < 1 - TOLERANCE
        ? t("distance.moveBack")
        : t("distance.hold");

  // Map 60%..160% of the target onto the gauge.
  const pos = Math.min(1, Math.max(0, (ratio - 0.6) / 1.0));
  const bandLeft = ((1 - TOLERANCE - 0.6) / 1.0) * 100;
  const bandWidth = ((2 * TOLERANCE) / 1.0) * 100;

  const next = () => setStep(cameraEnabled ? "gazeCal" : "practice");

  return (
    <div className="wrap">
      <h1>{t("distance.title")}</h1>

      <div className="card">
        <div style={{ fontSize: 42, fontWeight: 700, marginBottom: 6 }}>
          {formatDistance(target, config.locale)}
        </div>
        <p style={{ marginBottom: 0 }}>
          {t("distance.instruction", { distance: formatDistance(target, config.locale) })}
        </p>
      </div>

      {cameraUsable ? (
        <div className={`card ${inBand ? "good" : ""}`}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="small">
              {t("distance.live", { distance: formatDistance(live!, config.locale) })}
            </span>
            <strong>{hint}</strong>
          </div>
          <div className="gauge">
            <div className="target" style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }} />
            <div className="needle" style={{ left: `${pos * 100}%` }} />
          </div>
          <p className="small muted" style={{ marginTop: 12, marginBottom: 6 }}>
            {t("distance.calibrateHint")}
          </p>
          <div className="row">
            <input
              type="number"
              min={15}
              max={90}
              step={0.5}
              value={actualCm}
              placeholder="33"
              onChange={(e) => setActualCm(e.target.value)}
              aria-label={t("distance.actualLabel")}
            />
            <button
              className="small"
              disabled={!actualCm}
              onClick={() => {
                const mm = Number(actualCm) * 10;
                if (mm > 100 && mm < 1200) gaze.calibrateDistance(mm);
                setActualCm("");
              }}
            >
              {t("distance.apply")}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="small" style={{ marginBottom: 0 }}>
            {t("distance.noCamera")}
          </p>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={next}>
          {t("distance.confirm")}
        </button>
        <button className="ghost" onClick={() => setStep("eyeCover")}>
          {t("common.back")}
        </button>
      </div>

      {cameraEnabled && gazeCalibrated && (
        <p className="small muted" style={{ marginTop: 14 }}>
          {t("distance.locked")}
        </p>
      )}
    </div>
  );
}
