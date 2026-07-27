import { useApp } from "../../state/store";
import { useT } from "../hooks";

export function Welcome() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const beginSession = useApp((s) => s.beginSession);

  return (
    <div className="wrap">
      <h1>{t("welcome.title")}</h1>
      <p className="lede">{t("welcome.intro")}</p>

      <div className="card alert">
        <h3>{t("welcome.disclaimerTitle")}</h3>
        <p className="small" style={{ marginBottom: 0 }}>
          {t("welcome.disclaimer")}
        </p>
      </div>

      <div className="card">
        <h3>{t("welcome.needTitle")}</h3>
        <ul className="list small">
          <li>{t("welcome.need1")}</li>
          <li>{t("welcome.need2")}</li>
          <li>{t("welcome.need3")}</li>
          <li>{t("welcome.need4")}</li>
        </ul>
      </div>

      <div className="actions">
        <button
          className="primary"
          onClick={() => {
            beginSession();
            setStep("environment");
          }}
        >
          {t("welcome.begin")}
        </button>
        <button className="ghost" onClick={() => setStep("history")}>
          {t("welcome.history")}
        </button>
      </div>
    </div>
  );
}
