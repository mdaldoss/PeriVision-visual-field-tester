import { useEffect, useRef, useState } from "react";
import type { Session } from "../core/types";
import { exportEyePng, exportSessionJson, exportSessionPdf, reportOptions } from "../services/exporters";
import { drawEyeReport, REPORT_H, REPORT_W } from "../services/report";
import { saveSession } from "../services/storage";
import { useApp } from "../state/store";
import { useT } from "./hooks";
import type { TranslationKey } from "../i18n";

export function Results() {
  const t = useT();
  const session = useApp((s) => s.session);
  const setStep = useApp((s) => s.setStep);
  const reset = useApp((s) => s.reset);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session || saved) return;
    void saveSession(session).then(() => setSaved(true));
  }, [session, saved]);

  if (!session) {
    return (
      <div className="wrap">
        <div className="card">{t("history.empty")}</div>
        <button onClick={() => setStep("welcome")}>{t("results.home")}</button>
      </div>
    );
  }

  const anyLow = session.results.some((r) => r.reliability.verdict === "low");
  const reasons = new Set(session.results.flatMap((r) => r.reliability.reasons));
  const protocolLabel =
    session.config.protocol === "screening"
      ? t("setup.protocolScreening")
      : session.config.protocol === "central"
        ? t("setup.protocolCentral")
        : t("setup.protocolThreshold");

  return (
    <div className="wrap">
      <h1>{t("results.title")}</h1>
      <p className="lede">
        {t("results.subtitle", {
          date: new Date(session.startedAt).toLocaleString(),
          protocol: protocolLabel,
        })}
      </p>

      <div className={`card ${anyLow ? "alert" : "good"}`}>
        <p style={{ marginBottom: reasons.size ? 8 : 0 }}>
          {anyLow ? t("results.verdictLow") : t("results.verdictReliable")}
        </p>
        {reasons.size > 0 && (
          <ul className="list small" style={{ marginBottom: 0 }}>
            {[...reasons].map((r) => (
              <li key={r}>{t(`results.reason${capitalize(r)}` as TranslationKey)}</li>
            ))}
          </ul>
        )}
      </div>

      {session.results.map((result, index) => (
        <div key={result.eye} style={{ marginBottom: 22 }}>
          <ReportView session={session} index={index} />
          <div className="actions" style={{ marginTop: 10 }}>
            <button
              className="small"
              onClick={() => {
                setBusy(true);
                void exportEyePng(session, index).finally(() => setBusy(false));
              }}
              disabled={busy}
            >
              {t("results.exportPng")} - {result.eye}
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <h3>{t("results.whatNextTitle")}</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          {t("results.whatNext")}
        </p>
      </div>

      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void exportSessionPdf(session).finally(() => setBusy(false));
          }}
        >
          {busy && <span className="spinner" style={{ marginRight: 8 }} />}
          {t("results.exportPdf")}
        </button>
        <button onClick={() => exportSessionJson(session)}>{t("results.exportJson")}</button>
        <button
          className="ghost"
          onClick={() => {
            reset();
            setStep("welcome");
          }}
        >
          {t("results.again")}
        </button>
        <button className="ghost" onClick={() => setStep("history")}>
          {t("history.title")}
        </button>
      </div>

      {saved && (
        <p className="small muted" style={{ marginTop: 12 }}>
          {t("results.saved")}
        </p>
      )}
    </div>
  );
}

/** Draw a report onto a canvas sized for the page. */
export function ReportView({ session, index }: { session: Session; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const scale = 2;
    canvas.width = REPORT_W * scale;
    canvas.height = REPORT_H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.scale(scale, scale);
    drawEyeReport(ctx, reportOptions(session, index));
    ctx.restore();
  }, [session, index]);

  return <canvas ref={ref} className="report-canvas" />;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
