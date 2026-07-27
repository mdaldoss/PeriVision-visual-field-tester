import { useEffect, useState } from "react";
import type { Session } from "../core/types";
import { downloadBlob } from "../services/exporters";
import { deleteAllData, deleteSession, exportAll, listSessions } from "../services/storage";
import { useApp } from "../state/store";
import { useT } from "./hooks";

export function History() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const loadSession = useApp((s) => s.loadSession);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const refresh = () => void listSessions().then(setSessions);
  useEffect(refresh, []);

  const protocolName = (s: Session) =>
    s.config.protocol === "screening"
      ? t("setup.protocolScreening")
      : s.config.protocol === "central"
        ? t("setup.protocolCentral")
        : t("setup.protocolThreshold");

  return (
    <div className="wrap">
      <h1>{t("history.title")}</h1>

      {sessions === null && <span className="spinner" />}
      {sessions?.length === 0 && <div className="card">{t("history.empty")}</div>}

      {sessions && sessions.length > 0 && (
        <div className="card">
          {sessions.map((s) => (
            <div className="history-row" key={s.id}>
              <span className="small">
                {t("history.row", {
                  date: new Date(s.startedAt).toLocaleString(),
                  protocol: protocolName(s),
                  eyes: s.results.length,
                })}
                {s.results.some((r) => r.reliability.verdict === "low") && (
                  <span className="badge warn" style={{ marginLeft: 8 }}>
                    low
                  </span>
                )}
              </span>
              <span className="row" style={{ gap: 6 }}>
                <button className="small" onClick={() => loadSession(s)}>
                  {t("history.open")}
                </button>
                <button
                  className="small danger"
                  onClick={() => void deleteSession(s.id).then(refresh)}
                >
                  {t("history.delete")}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="actions">
        <button className="ghost" onClick={() => setStep("welcome")}>
          {t("results.home")}
        </button>
        <button
          onClick={() =>
            void exportAll().then((data) =>
              downloadBlob(
                new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
                "perivision-all-data.json",
              ),
            )
          }
        >
          {t("history.exportAll")}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (window.confirm(t("history.deleteAllConfirm"))) {
              void deleteAllData().then(refresh);
            }
          }}
        >
          {t("history.deleteAll")}
        </button>
      </div>
    </div>
  );
}
