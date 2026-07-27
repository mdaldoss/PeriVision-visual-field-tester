import { useEffect, useRef, useState } from "react";
import type { TestEngine } from "../core/engine";
import { audio } from "../services/instances";
import { SOUND_EVENTS, type SoundEvent } from "../services/audio";
import { formatLogLine, type LogLine } from "./debugFormat";
import { useGazeDebug, useT } from "./hooks";

export interface DebugPanelProps {
  log: LogLine[];
  engine: TestEngine | null;
  seed: number;
  onClear: () => void;
  onSimulatePress: () => void;
  onSimulateGazeLoss: () => void;
}

export function DebugPanel({
  log,
  engine,
  seed,
  onClear,
  onSimulatePress,
  onSimulateGazeLoss,
}: DebugPanelProps) {
  const t = useT();
  const gazeInfo = useGazeDebug(150);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const logEnd = useRef<HTMLDivElement>(null);

  // The counters live on the engine and change without React knowing.
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  const startedAt = log[0]?.t ?? 0;
  const counts = engine?.counts;

  const copy = async () => {
    const text = log.map((l) => formatLogLine(l, startedAt)).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; nothing useful to do */
    }
  };

  return (
    <div className="debug-panel">
      <header>
        <span>{t("debug.title")}</span>
        <button className="small ghost" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "+" : "-"}
        </button>
      </header>
      {!collapsed && (
        <div className="body">
          <dl className="kv">
            <dt>{t("debug.phase")}</dt>
            <dd>{engine?.currentPhase ?? t("debug.none")}</dd>
            <dt>{t("debug.trial")}</dt>
            <dd>{engine?.trials.length ?? 0}</dd>
            <dt>{t("debug.fps")}</dt>
            <dd>{gazeInfo.fps}</dd>
            <dt>{t("debug.deviation")}</dt>
            <dd className={gazeInfo.deviationDeg > 4 ? "log-bad" : ""}>
              {gazeInfo.faceFound ? `${gazeInfo.deviationDeg.toFixed(1)}°` : "no face"}
            </dd>
            <dt>{t("debug.distance")}</dt>
            <dd>
              {gazeInfo.rawDistanceMm ? `${(gazeInfo.rawDistanceMm / 10).toFixed(0)} cm` : "-"}
            </dd>
            <dt>{t("debug.openEye")}</dt>
            <dd>{gazeInfo.openEye ?? "-"}</dd>
            <dt>{t("debug.quality")}</dt>
            <dd>
              {gazeInfo.calibrated ? `${gazeInfo.qualityDeg.toFixed(1)}°` : "uncalibrated"}
            </dd>
            <dt>{t("debug.seed")}</dt>
            <dd>{seed}</dd>
          </dl>

          {counts && (
            <dl className="kv" style={{ marginTop: 8 }}>
              <dt>FP catch</dt>
              <dd>
                {counts.fpCatchHits}/{counts.fpCatchTrials}
              </dd>
              <dt>FN catch</dt>
              <dd>
                {counts.fnCatchMisses}/{counts.fnCatchTrials}
              </dd>
              <dt>Blind spot</dt>
              <dd>
                {counts.blindSpotHits}/{counts.blindSpotTrials}
              </dd>
              <dt>Gaze losses</dt>
              <dd>
                {counts.gazeFixationLosses}/{counts.gazeChecks}
              </dd>
              <dt>Stray presses</dt>
              <dd>{counts.spontaneousPresses + counts.anticipatoryPresses}</dd>
              <dt>Discarded</dt>
              <dd>{counts.invalidatedTrials}</dd>
            </dl>
          )}

          <h3 style={{ marginTop: 12 }}>{t("debug.events")}</h3>
          <div className="debug-log">
            {log.map((line, i) => (
              <div key={i} className={`log-${line.level}`}>
                {formatLogLine(line, startedAt)}
              </div>
            ))}
            <div ref={logEnd} />
          </div>

          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <button className="small ghost" onClick={onClear}>
              {t("debug.clear")}
            </button>
            <button className="small ghost" onClick={() => void copy()}>
              {copied ? t("debug.copied") : t("debug.copy")}
            </button>
            <button className="small ghost" onClick={onSimulatePress}>
              {t("debug.simulatePress")}
            </button>
            <button className="small ghost" onClick={onSimulateGazeLoss}>
              {t("debug.simulateGazeLoss")}
            </button>
          </div>

          <h3 style={{ marginTop: 12 }}>{t("debug.sounds")}</h3>
          <div className="sound-grid">
            {SOUND_EVENTS.map((event: SoundEvent) => (
              <label key={event}>
                <input
                  type="checkbox"
                  defaultChecked={!audio.isMuted(event)}
                  onChange={(e) => audio.setMuted(event, !e.target.checked)}
                />
                <span onClick={() => audio.play(event)} style={{ cursor: "pointer" }}>
                  {event}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
