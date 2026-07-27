# PeriVision — visual field tester

PeriVision is a web app that runs a **visual field test (perimetry)** on an ordinary laptop — no dedicated hardware. You fixate a central dot with one eye (the other covered), press the **spacebar** whenever you glimpse brief stimuli flashed across the screen, and get a per-eye field map similar in layout to a clinical perimeter printout.

What makes it more than a toy:

- **Guided setup** — screen-size calibration and an exact, computed **viewing-distance instruction**, held in place with live webcam feedback.
- **Reliability engine** — randomized stimulus timing, detection of **false triggers** (presses with wrong timing / no stimulus), false-negative catch trials, and blind-spot fixation checks.
- **Webcam gaze monitoring** — trials shown while your gaze drifted off the fixation target are invalidated and re-queued; it also verifies the *correct* eye is the open one.
- **Per-eye report** — numeric sensitivities, interpolated grayscale map, and reliability indices, exportable as PNG/PDF/JSON. Everything runs and stays **on your device**.
- **Debug mode** — live gaze/event overlay with distinct sounds for events like *gaze lost* and *false trigger*.

> ⚠️ **Not a medical device.** PeriVision is a screening / self-monitoring / educational tool. A consumer screen cannot be photometrically calibrated like a certified perimeter; results are indicative and must not be used for diagnosis. See an eye-care professional for any concern.

## Status

📐 **Planning.** The full blueprint — feasibility analysis, architecture, module specs, protocols, and a milestone roadmap — lives in **[docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)**. No application code yet; M0 (scaffold + CI) is the next step.

## Planned stack

TypeScript · React · Vite · Canvas 2D · MediaPipe Face Landmarker (in-browser gaze) · Web Audio · IndexedDB · Vitest/Playwright · GitHub Actions → GitHub Pages.
