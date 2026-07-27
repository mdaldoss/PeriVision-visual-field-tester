import { useState } from "react";
import { gaze } from "../../services/instances";
import { useApp } from "../../state/store";
import { useGazeDebug, useT } from "../hooks";

export function CameraSetup() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const setCameraEnabled = useApp((s) => s.setCameraEnabled);
  const cameraEnabled = useApp((s) => s.cameraEnabled);
  const [busy, setBusy] = useState(false);
  const info = useGazeDebug(300);

  const enable = async () => {
    setBusy(true);
    const ok = await gaze.start();
    setBusy(false);
    setCameraEnabled(ok);
  };

  const status = () => {
    if (busy && info.status === "requesting") return t("camera.requesting");
    if (busy || info.status === "loading") return t("camera.loading");
    if (info.status === "ready") return t("camera.ready", { delegate: info.delegate ?? "CPU" });
    if (info.status === "unavailable")
      return t("camera.failed", { error: info.error ?? "unknown" });
    return null;
  };

  const statusText = status();

  return (
    <div className="wrap">
      <h1>{t("camera.title")}</h1>
      <p className="lede">{t("camera.intro")}</p>

      <div className="card good">
        <h3>{t("camera.privacyTitle")}</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          {t("camera.privacy")}
        </p>
      </div>

      {statusText && (
        <div className={`card ${info.status === "unavailable" ? "alert" : ""}`}>
          <p className="small" style={{ marginBottom: 0 }}>
            {busy && <span className="spinner" style={{ marginRight: 8 }} />}
            {statusText}
          </p>
          {info.status === "ready" && (
            <p className="small muted" style={{ marginTop: 8, marginBottom: 0 }}>
              {info.faceFound ? "Face detected" : "Looking for your face..."} - {info.fps} fps
            </p>
          )}
        </div>
      )}

      <div className="actions">
        {info.status !== "ready" && (
          <button className="primary" onClick={() => void enable()} disabled={busy}>
            {t("camera.enable")}
          </button>
        )}
        {info.status === "ready" && (
          <button className="primary" onClick={() => setStep("setup")}>
            {t("common.continue")}
          </button>
        )}
        <button
          className="ghost"
          onClick={() => {
            setCameraEnabled(false);
            gaze.stop();
            setStep("setup");
          }}
        >
          {t("camera.without")}
        </button>
        <button className="ghost" onClick={() => setStep("screenCal")}>
          {t("common.back")}
        </button>
      </div>

      {!cameraEnabled && (
        <p className="small muted" style={{ marginTop: 16 }}>
          {t("camera.fallbackNote")}
        </p>
      )}
    </div>
  );
}
