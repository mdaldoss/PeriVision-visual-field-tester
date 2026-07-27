import { useMemo } from "react";
import { getGridSpec } from "../../core/grid";
import type { ProtocolId } from "../../core/types";
import { formatDistance } from "../../services/calibration";
import { estimateMinutes, geometryFor, useApp } from "../../state/store";
import { useT } from "../hooks";

const PROTOCOLS: { id: ProtocolId; gridSpecId: string }[] = [
  { id: "screening", gridSpecId: "24-2" },
  { id: "threshold", gridSpecId: "24-2" },
  { id: "central", gridSpecId: "10-2-style" },
];

export function TestSetup() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const device = useApp((s) => s.device);
  const config = useApp((s) => s.config);
  const patchConfig = useApp((s) => s.patchConfig);
  const cameraEnabled = useApp((s) => s.cameraEnabled);

  const geom = useMemo(
    () => (device ? geometryFor(device, config, 0) : null),
    [device, config],
  );

  // Keep the locked distance in step with whichever grid is selected.
  const applyProtocol = (protocol: ProtocolId, gridSpecId: string) => {
    if (!device) return;
    const next = { ...config, protocol, gridSpecId };
    const g = geometryFor(device, { ...next, distanceMm: 0 }, 0);
    patchConfig({ protocol, gridSpecId, distanceMm: g.recommendedMm });
  };

  if (!device || !geom) {
    return (
      <div className="wrap">
        <div className="card danger">{t("error.noDevice")}</div>
        <button onClick={() => setStep("screenCal")}>{t("common.back")}</button>
      </div>
    );
  }

  const spec = getGridSpec(config.gridSpecId);
  const minutes = estimateMinutes(config.protocol, geom.grid.points.length);
  const coveragePct = Math.round(geom.grid.coverage * 100);

  return (
    <div className="wrap">
      <h1>{t("setup.title")}</h1>

      <h2>{t("setup.protocol")}</h2>
      <div className="grid2">
        {PROTOCOLS.map((p) => {
          const selected = config.protocol === p.id;
          const nameKey =
            p.id === "screening"
              ? "setup.protocolScreening"
              : p.id === "threshold"
                ? "setup.protocolThreshold"
                : "setup.protocolCentral";
          const descKey =
            p.id === "screening"
              ? "setup.protocolScreeningDesc"
              : p.id === "threshold"
                ? "setup.protocolThresholdDesc"
                : "setup.protocolCentralDesc";
          return (
            <button
              key={p.id}
              className={`option ${selected ? "selected" : ""}`}
              onClick={() => applyProtocol(p.id, p.gridSpecId)}
            >
              <strong>{t(nameKey)}</strong>
              <span className="small muted">{t(descKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>{t("setup.geometryTitle")}</h3>
        <p className="small">
          {t("setup.geometryLine", {
            distance: formatDistance(config.distanceMm || geom.recommendedMm, config.locale),
            x: geom.grid.maxXDeg.toFixed(0),
            y: geom.grid.maxYDeg.toFixed(0),
            points: geom.grid.points.length,
          })}
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {t("setup.estimate", { minutes })}
        </p>
      </div>

      {!geom.coverageOk && (
        <div className="card danger">
          <p className="small" style={{ marginBottom: 0 }}>
            {t("setup.coverageFail")}
          </p>
        </div>
      )}
      {geom.coverageOk && coveragePct < 100 && (
        <div className="card alert">
          <p className="small" style={{ marginBottom: 0 }}>
            {t("setup.coverageWarn", { coverage: coveragePct, grid: spec.label })}
          </p>
        </div>
      )}

      <h2>{t("setup.eyeOrder")}</h2>
      <div className="row">
        <button
          className={config.eyeOrder[0] === "OD" ? "primary" : ""}
          onClick={() => patchConfig({ eyeOrder: ["OD", "OS"] })}
        >
          {t("setup.eyeOrderODFirst")}
        </button>
        <button
          className={config.eyeOrder[0] === "OS" ? "primary" : ""}
          onClick={() => patchConfig({ eyeOrder: ["OS", "OD"] })}
        >
          {t("setup.eyeOrderOSFirst")}
        </button>
      </div>

      <h2>{t("setup.age")}</h2>
      <div className="field">
        <input
          type="number"
          min={10}
          max={95}
          value={config.age}
          onChange={(e) => patchConfig({ age: Number(e.target.value) })}
          aria-label={t("setup.age")}
        />
        <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
          {t("setup.ageHelp")}
        </p>
      </div>

      <div className="grid2">
        <div>
          <h3>{t("setup.stimulus")}</h3>
          <div className="row">
            <button
              className={config.stimulusColor === "white" ? "primary small" : "small"}
              onClick={() => patchConfig({ stimulusColor: "white" })}
            >
              {t("setup.stimulusWhite")}
            </button>
            <button
              className={config.stimulusColor === "red" ? "primary small" : "small"}
              onClick={() => patchConfig({ stimulusColor: "red" })}
            >
              {t("setup.stimulusRed")}
            </button>
          </div>
        </div>
        <div>
          <h3>{t("setup.fixation")}</h3>
          <div className="row">
            <button
              className={config.fixationStyle === "dot" ? "primary small" : "small"}
              onClick={() => patchConfig({ fixationStyle: "dot" })}
            >
              {t("setup.fixationDot")}
            </button>
            <button
              className={config.fixationStyle === "cross" ? "primary small" : "small"}
              onClick={() => patchConfig({ fixationStyle: "cross" })}
            >
              {t("setup.fixationCross")}
            </button>
          </div>
        </div>
      </div>

      <h2>{t("debug.title")}</h2>
      <div className="toggle">
        <input
          id="debug"
          type="checkbox"
          checked={config.debug}
          onChange={(e) => patchConfig({ debug: e.target.checked })}
        />
        <div>
          <label htmlFor="debug">{t("setup.debugToggle")}</label>
          <p className="small muted" style={{ margin: 0 }}>
            {t("setup.debugHelp")}
          </p>
        </div>
      </div>
      <div className="toggle">
        <input
          id="feedback"
          type="checkbox"
          checked={config.responseFeedback}
          onChange={(e) => patchConfig({ responseFeedback: e.target.checked })}
        />
        <div>
          <label htmlFor="feedback">{t("setup.feedbackToggle")}</label>
          <p className="small muted" style={{ margin: 0 }}>
            {t("setup.feedbackHelp")}
          </p>
        </div>
      </div>

      <div className="actions">
        <button
          className="primary"
          disabled={!geom.coverageOk}
          onClick={() => {
            if (!config.distanceMm) patchConfig({ distanceMm: geom.recommendedMm });
            setStep("eyeCover");
          }}
        >
          {t("setup.startTest")}
        </button>
        <button className="ghost" onClick={() => setStep("camera")}>
          {t("common.back")}
        </button>
      </div>

      {!cameraEnabled && (
        <p className="small muted" style={{ marginTop: 14 }}>
          {t("camera.fallbackNote")}
        </p>
      )}
    </div>
  );
}
