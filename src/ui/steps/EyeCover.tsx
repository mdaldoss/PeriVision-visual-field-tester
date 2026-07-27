import { useState } from "react";
import type { Eye } from "../../core/types";
import { audio } from "../../services/instances";
import { currentEye, useApp } from "../../state/store";
import { useGazeDebug, useT } from "../hooks";

export function EyeCover() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const config = useApp((s) => s.config);
  const eyeIndex = useApp((s) => s.eyeIndex);
  const cameraEnabled = useApp((s) => s.cameraEnabled);
  const [override, setOverride] = useState(false);
  const info = useGazeDebug(250);

  const testedEye: Eye = currentEye({ config, eyeIndex });
  const coveredEye: Eye = testedEye === "OD" ? "OS" : "OD";
  const name = (e: Eye) => (e === "OD" ? t("common.eyeOD") : t("common.eyeOS"));

  const detected = info.openEye;
  const matches = detected === testedEye;
  const cameraUsable = cameraEnabled && info.status === "ready";
  const canContinue = !cameraUsable || matches || override;

  let statusNode = null;
  if (cameraUsable) {
    if (!info.faceFound) {
      statusNode = <div className="card alert small">{t("cover.noFace")}</div>;
    } else if (matches) {
      statusNode = (
        <div className="card good small">{t("cover.ok", { openEye: name(testedEye) })}</div>
      );
    } else if (detected) {
      statusNode = (
        <div className="card danger small">
          {t("cover.mismatch", { detected: name(detected), eye: name(coveredEye) })}
        </div>
      );
    } else {
      statusNode = <div className="card small">{t("cover.checking")}</div>;
    }
  }

  return (
    <div className="wrap">
      <h1>{t("cover.title", { eye: name(coveredEye) })}</h1>
      <p className="lede">{t("cover.testing", { openEye: name(testedEye) })}</p>

      <div className="card">
        <p style={{ marginBottom: 0 }}>
          {t("cover.instruction", { eye: name(coveredEye), openEye: name(testedEye) })}
        </p>
      </div>

      {statusNode}

      <div className="actions">
        <button
          className="primary"
          disabled={!canContinue}
          onClick={() => {
            void audio.unlock();
            setStep("distance");
          }}
        >
          {t("cover.ready")}
        </button>
        {cameraUsable && !matches && !override && (
          <button className="ghost" onClick={() => setOverride(true)}>
            {t("cover.override")}
          </button>
        )}
        <button className="ghost" onClick={() => setStep("setup")}>
          {t("common.back")}
        </button>
      </div>
    </div>
  );
}
