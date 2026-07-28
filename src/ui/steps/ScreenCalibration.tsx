import { useEffect, useMemo, useState } from "react";
import {
  buildDeviceProfile,
  CREDIT_CARD_HEIGHT_MM,
  CREDIT_CARD_WIDTH_MM,
  currentScreenGeometry,
  DEFAULT_GAMMA,
  DEFAULT_MAX_NITS,
  diagonalInches,
  isPlausiblePxPerMm,
  pxPerMmFromCardWidth,
  pxPerMmFromDiagonal,
} from "../../services/calibration";
import { saveDeviceProfile } from "../../services/storage";
import { useApp } from "../../state/store";
import { useT } from "../hooks";

type Method = "card" | "diagonal";

export function ScreenCalibration() {
  const t = useT();
  const setStep = useApp((s) => s.setStep);
  const setDevice = useApp((s) => s.setDevice);
  const existing = useApp((s) => s.device);

  const [method, setMethod] = useState<Method>("card");
  const [cardWidthPx, setCardWidthPx] = useState(() =>
    existing ? Math.round(existing.pxPerMm * CREDIT_CARD_WIDTH_MM) : 380,
  );
  const [diagonal, setDiagonal] = useState(15.6);
  const [maxNits, setMaxNits] = useState(existing?.maxNits ?? DEFAULT_MAX_NITS);
  const [gamma, setGamma] = useState(existing?.gamma ?? DEFAULT_GAMMA);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const geometry = useMemo(() => currentScreenGeometry(), []);

  const pxPerMm =
    method === "card"
      ? pxPerMmFromCardWidth(cardWidthPx)
      : pxPerMmFromDiagonal(diagonal, geometry.widthPx, geometry.heightPx);

  const profile = useMemo(
    () =>
      buildDeviceProfile(pxPerMm, {
        gamma,
        maxNits,
        geometry,
        id: existing?.id,
      }),
    [pxPerMm, gamma, maxNits, geometry, existing?.id],
  );

  const plausible = isPlausiblePxPerMm(pxPerMm);

  // Keep the store in step with the sliders so the next screen can use it.
  useEffect(() => {
    if (plausible) setDevice(profile);
  }, [profile, plausible, setDevice]);

  const cardHeightPx = (cardWidthPx * CREDIT_CARD_HEIGHT_MM) / CREDIT_CARD_WIDTH_MM;

  return (
    <div className="wrap">
      <h1>{t("cal.title")}</h1>
      <p className="lede">{t("cal.intro")}</p>

      <div className="row" style={{ marginBottom: 16 }}>
        <button
          className={method === "card" ? "primary" : ""}
          onClick={() => setMethod("card")}
        >
          {t("cal.cardMethod")}
        </button>
        <button
          className={method === "diagonal" ? "primary" : ""}
          onClick={() => setMethod("diagonal")}
        >
          {t("cal.diagonalMethod")}
        </button>
      </div>

      {method === "card" ? (
        <div className="card">
          <p className="small">{t("cal.cardHelp")}</p>
          <div
            className="card-outline"
            style={{ width: cardWidthPx, height: cardHeightPx, marginBottom: 34 }}
          >
            <span>85.60 x 53.98 mm</span>
          </div>
          <input
            type="range"
            min={180}
            max={900}
            step={1}
            value={cardWidthPx}
            onChange={(e) => setCardWidthPx(Number(e.target.value))}
            aria-label={t("cal.cardMethod")}
          />
        </div>
      ) : (
        <div className="card">
          <p className="small">{t("cal.diagonalHelp")}</p>
          <div className="field">
            <label htmlFor="diag">{t("cal.diagonalLabel")}</label>
            <input
              id="diag"
              type="number"
              min={9}
              max={40}
              step={0.1}
              value={diagonal}
              onChange={(e) => setDiagonal(Number(e.target.value))}
            />
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {geometry.widthPx} x {geometry.heightPx} px
          </p>
        </div>
      )}

      <div className={`card ${plausible ? "" : "alert"}`}>
        <h3>{t("cal.resultTitle")}</h3>
        <p className="small" style={{ marginBottom: plausible ? 0 : 10 }}>
          {t("cal.resultLine", {
            diagonal: diagonalInches(profile).toFixed(1),
            width: profile.screenWmm.toFixed(0),
            height: profile.screenHmm.toFixed(0),
            ppmm: pxPerMm.toFixed(2),
          })}
        </p>
        {!plausible && <p className="small">{t("cal.implausible")}</p>}
      </div>

      <button className="ghost small" onClick={() => setShowAdvanced((v) => !v)}>
        {t("cal.advanced")}
      </button>

      {showAdvanced && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="nits">{t("cal.nitsLabel")}</label>
              <input
                id="nits"
                type="number"
                min={60}
                max={1600}
                step={10}
                value={maxNits}
                onChange={(e) => setMaxNits(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="gamma">{t("cal.gammaLabel")}</label>
              <input
                id="gamma"
                type="number"
                min={1.4}
                max={3}
                step={0.05}
                value={gamma}
                onChange={(e) => setGamma(Number(e.target.value))}
              />
            </div>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            {t("cal.nitsHelp")}
          </p>
        </div>
      )}

      <div className="actions">
        <button
          className="primary"
          disabled={!plausible}
          onClick={() => {
            setDevice(profile);
            void saveDeviceProfile(profile);
            setStep("camera");
          }}
        >
          {t("common.continue")}
        </button>
        <button className="ghost" onClick={() => setStep("environment")}>
          {t("common.back")}
        </button>
      </div>
    </div>
  );
}
