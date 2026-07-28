import { useApp } from "../../state/store";
import { useT } from "../hooks";

export function Environment() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);

  const hasFullscreen = typeof document.documentElement.requestFullscreen === "function";
  const hasCamera = Boolean(navigator.mediaDevices?.getUserMedia);

  return (
    <div className="wrap">
      <h1>{t("env.title")}</h1>
      <p className="lede">{t("env.intro")}</p>

      <div className="card">
        <ul className="list">
          <li>{t("env.item1")}</li>
          <li>{t("env.item2")}</li>
          <li>{t("env.item3")}</li>
          <li>{t("env.item4")}</li>
          <li>{t("env.item5")}</li>
        </ul>
      </div>

      <div className="card">
        <h3>{t("env.checksTitle")}</h3>
        <div className="row">
          <span className={`badge ${hasFullscreen ? "good" : "bad"}`}>
            {t("env.checkFullscreen")}: {hasFullscreen ? t("env.checkOk") : t("env.checkMissing")}
          </span>
          <span className={`badge ${hasCamera ? "good" : "warn"}`}>
            {t("env.checkCamera")}: {hasCamera ? t("env.checkOk") : t("env.checkMissing")}
          </span>
        </div>
        {!hasCamera && (
          <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
            {t("env.cameraOptional")}
          </p>
        )}
      </div>

      <div className="actions">
        <button className="primary" onClick={() => setStep("screenCal")}>
          {t("common.continue")}
        </button>
        <button className="ghost" onClick={() => setStep("welcome")}>
          {t("common.back")}
        </button>
      </div>
    </div>
  );
}
