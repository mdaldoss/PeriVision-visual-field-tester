import { useEffect } from "react";
import { LOCALES } from "./i18n";
import { gaze } from "./services/instances";
import { loadLastDeviceProfile } from "./services/storage";
import { currentEye, useApp, type Step } from "./state/store";
import { History } from "./ui/History";
import { Results } from "./ui/Results";
import { TestRunner } from "./ui/TestRunner";
import { useT } from "./ui/hooks";
import { CameraSetup } from "./ui/steps/CameraSetup";
import { DistanceStep } from "./ui/steps/DistanceStep";
import { Environment } from "./ui/steps/Environment";
import { EyeCover } from "./ui/steps/EyeCover";
import { GazeCalibration } from "./ui/steps/GazeCalibration";
import { ScreenCalibration } from "./ui/steps/ScreenCalibration";
import { TestSetup } from "./ui/steps/TestSetup";
import { Welcome } from "./ui/steps/Welcome";

const WIZARD_STEPS: Step[] = [
  "welcome",
  "environment",
  "screenCal",
  "camera",
  "setup",
  "eyeCover",
  "distance",
  "gazeCal",
  "practice",
  "test",
];

export function App() {
  const t = useT();
  const step = useApp((s) => s.step);
  const locale = useApp((s) => s.locale);
  const setLocale = useApp((s) => s.setLocale);
  const setDevice = useApp((s) => s.setDevice);
  const device = useApp((s) => s.device);

  // Debug mode can be switched on with ?debug=1 before anything else happens.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") useApp.getState().patchConfig({ debug: true });
    void loadLastDeviceProfile().then((profile) => {
      if (profile && !useApp.getState().device) setDevice(profile);
    });
    return () => gaze.stop();
  }, [setDevice]);

  const showChrome = step !== "test" && step !== "practice" && step !== "gazeCal";
  const stepIndex = WIZARD_STEPS.indexOf(step);

  return (
    <div className="app">
      {showChrome && (
        <div className="topbar">
          <div className="brand">
            {t("app.name")}
            <small>{t("app.notMedicalShort")}</small>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {stepIndex > 0 && (
              <div className="steps" aria-hidden>
                {WIZARD_STEPS.slice(1).map((s, i) => (
                  <i key={s} className={i < stepIndex ? "on" : ""} />
                ))}
              </div>
            )}
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
              aria-label="Language"
            >
              {LOCALES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <StepView step={step} hasDevice={Boolean(device)} />
    </div>
  );
}

function StepView({ step, hasDevice }: { step: Step; hasDevice: boolean }) {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const config = useApp((s) => s.config);
  const eyeIndex = useApp((s) => s.eyeIndex);
  const practiceDone = useApp((s) => s.practiceDone);
  const setPracticeDone = useApp((s) => s.setPracticeDone);
  const completeEye = useApp((s) => s.completeEye);
  const finishSession = useApp((s) => s.finishSession);
  const cameraEnabled = useApp((s) => s.cameraEnabled);

  switch (step) {
    case "welcome":
      return <Welcome />;
    case "environment":
      return <Environment />;
    case "screenCal":
      return <ScreenCalibration />;
    case "camera":
      return <CameraSetup />;
    case "setup":
      return <TestSetup />;
    case "eyeCover":
      return <EyeCover />;
    case "distance":
      return <DistanceStep />;
    case "gazeCal":
      return <GazeCalibration />;
    case "history":
      return <History />;
    case "results":
      return <Results />;

    case "practice":
      // Practice only happens before the first eye; after that the user knows
      // the drill and repeating it just adds fatigue.
      if (practiceDone || eyeIndex > 0) {
        setStep("test");
        return null;
      }
      return (
        <TestRunner
          mode="practice"
          onPracticeDone={() => {
            setPracticeDone(true);
            setStep("test");
          }}
          onEyeDone={() => undefined}
          onAbort={() => setStep("setup")}
        />
      );

    case "test":
      if (!hasDevice) {
        return (
          <div className="wrap">
            <div className="card danger">{t("error.noDevice")}</div>
          </div>
        );
      }
      return (
        <TestRunner
          key={`eye-${eyeIndex}`}
          mode="test"
          onPracticeDone={() => undefined}
          onEyeDone={(result) => {
            completeEye(result);
            const isLast = eyeIndex + 1 >= config.eyeOrder.length;
            if (isLast) {
              finishSession();
              setStep("results");
            } else {
              setStep("betweenEyes");
            }
          }}
          onAbort={() => setStep("setup")}
        />
      );

    case "betweenEyes": {
      const nextEye = currentEye({ config, eyeIndex });
      const eyeName = nextEye === "OD" ? t("common.eyeOD") : t("common.eyeOS");
      return (
        <div className="wrap">
          <h1>{t("between.title")}</h1>
          <div className="card">
            <p style={{ marginBottom: 0 }}>{t("between.body")}</p>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => setStep("eyeCover")}>
              {t("between.continue", { eye: eyeName })}
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
  }
}
