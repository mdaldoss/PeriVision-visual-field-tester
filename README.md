# PeriVision — visual field tester

PeriVision runs a **visual field test (perimetry)** on an ordinary laptop — no dedicated hardware. You fixate a central dot with one eye (the other covered), press the **spacebar** whenever you glimpse brief stimuli flashed across the screen, and get a per-eye field map laid out like a clinical perimeter printout.

> ⚠️ **Not a medical device.** PeriVision is a screening / self-monitoring / educational tool. A consumer screen cannot be photometrically calibrated like a certified perimeter, so results are indicative and must not be used for diagnosis. See an eye-care professional for any concern.

## What it does

- **Guided setup** — bank-card screen calibration, then a *computed* viewing distance for your screen and grid (e.g. 30 cm on a 15.6″ panel), held in place with a live webcam distance gauge.
- **Two protocols** — fast suprathreshold **screening** (~2–4 min/eye) and a **4-2 staircase full threshold** (~6–9 min/eye), plus a central macular grid. Grids adapt to what your screen can actually cover, and the report prints the true tested extent.
- **Reliability engine** — randomised stimulus timing, **false-trigger detection** (anticipatory presses, presses with no stimulus, empty catch trials), false-negative catch trials, and Heijl–Krakau blind-spot fixation checks, summarised with clinical-style limits.
- **Webcam gaze monitoring** — trials shown while your gaze drifted off fixation (or during a blink) are invalidated and re-queued rather than scored; it also verifies the *correct* eye is the open one and pauses if you move.
- **Per-eye report** — numeric sensitivities, interpolated grayscale map, blind spot, reliability indices, exportable as **PNG / PDF / JSON**. Everything runs and stays **on your device**.
- **Debug mode** — live gaze/state overlay, timestamped event console, and distinct **sounds** for *false trigger*, *gaze lost*, *trial discarded* and *wrong eye*.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Then: read the disclaimer → prepare the room → calibrate the screen against a bank card → allow the camera (optional) → choose a test → cover one eye → sit at the stated distance → gaze calibration → practice → test.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests (engine, strategies, grids, reliability) |
| `npm run e2e` | Playwright browser tests |
| `npm run lint` / `npm run typecheck` | Static checks |

The camera path needs HTTPS (or `localhost`). The face model and its WASM runtime are fetched once from a CDN — override with `VITE_MP_WASM` / `VITE_MP_MODEL` to self-host. **Camera frames are never uploaded**; inference happens in a Web Worker on your machine and frames are discarded immediately.

If your environment ships its own Chromium, point Playwright at it:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chromium npm run e2e
```

## How it works

```
src/core/      deterministic, device-free test logic
               engine (state machine + scheduler) · strategies (screening, 4-2 staircase)
               grid geometry (deg <-> px) · luminance model · reliability · scoring
src/services/  canvas renderer (dithered stimuli) · input · audio cues
               MediaPipe gaze worker · calibration · IndexedDB · report + exporters
src/ui/        setup wizard · fullscreen test runner · results · debug panel
```

The core takes an injected clock, a seeded RNG, key presses and gaze samples, and emits an event log — so a run is fully reproducible, unit-testable against simulated observers, and replayable from its JSON export.

### Things worth knowing before trusting a number

- **Pseudo-dB.** A perimeter's brightest stimulus is 3183 cd/m²; a laptop manages ~250. Values use the HFA dB scale but start at a device-dependent floor (~11 dB), printed on every report. Deep defects saturate there. Absolute values are **not** comparable between devices — comparing your own maps over time on the same laptop is.
- **Field coverage.** A 16:9 laptop cannot fit the full 24-2 pattern vertically at a comfortable distance. Rows that don't fit are dropped and the report states the extent actually tested.
- **Gaze accuracy.** Webcam gaze is good to a few degrees, so it is used as a veto and a counter — never as a measurement. Blind-spot catch trials run regardless, and are the only fixation check when the camera is declined.

Full design rationale, feasibility maths and roadmap: [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md).

## Stack

TypeScript · React · Vite · Canvas 2D · MediaPipe Face Landmarker · Web Audio · Dexie/IndexedDB · Vitest · Playwright · GitHub Actions → GitHub Pages.
