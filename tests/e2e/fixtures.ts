import type { Page } from "@playwright/test";

/**
 * Drives the results screen with a synthetic two-eye session. A real run takes
 * several minutes, so this loads a finished session straight into the store -
 * the same path the history screen uses - and checks the whole output pipeline:
 * report drawing, reliability wording, persistence and the PDF export.
 */
export async function loadSyntheticSession(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [grid_, store_, reliability_] = await Promise.all([
      load("/src/core/grid.ts"),
      load("/src/state/store.ts"),
      load("/src/core/reliability.ts"),
    ]);
    const { resolveGrid, SPEC_24_2 } = grid_;
    const { useApp } = store_;
    const { summarizeReliability } = reliability_;

    const device = {
      id: "synthetic",
      pxPerMm: 5.57,
      screenWmm: 344.7,
      screenHmm: 193.9,
      screenWpx: 1920,
      screenHpx: 1080,
      gamma: 2.2,
      maxNits: 250,
      userAgent: "synthetic",
      calibratedAt: new Date().toISOString(),
    };

    const counts = (bad: boolean) => ({
      fpCatchTrials: 8,
      fpCatchHits: bad ? 4 : 0,
      fnCatchTrials: 6,
      fnCatchMisses: 0,
      blindSpotTrials: 6,
      blindSpotHits: 0,
      gazeFixationLosses: 3,
      spontaneousPresses: bad ? 20 : 1,
      anticipatoryPresses: 0,
      invalidatedTrials: 6,
      gazeChecks: 180,
      scoredTrials: 200,
    });

    const makeEye = (eye: "OD" | "OS", bad: boolean) => {
      const grid = resolveGrid(SPEC_24_2, eye, device, 300);
      const thresholds: Record<string, number | null> = {};
      for (const p of grid.points) {
        thresholds[p.id] = p.yDeg > 6 && Math.abs(p.xDeg) > 8 ? 13 : 29;
      }
      return {
        eye,
        protocol: "threshold" as const,
        gridLabel: "24-2",
        thresholds,
        points: grid.points,
        reliability: summarizeReliability(counts(bad)),
        trials: [],
        presses: [],
        events: [],
        durationMs: 6.5 * 60 * 1000,
        meanRtMs: 445,
        medianRtMs: 420,
        blindSpot: { xDeg: eye === "OD" ? 15.5 : -15.5, yDeg: -1.5 },
        maxXDeg: grid.maxXDeg,
        maxYDeg: grid.maxYDeg,
        floorDb: 11.2,
        debugRun: false,
      };
    };

    const session = {
      id: `synthetic-${Date.now()}`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      config: {
        eyeOrder: ["OD", "OS"],
        protocol: "threshold",
        gridSpecId: "24-2",
        distanceMm: 300,
        stimulusColor: "white",
        fixationStyle: "dot",
        gazeMonitoring: true,
        age: 52,
        seed: 4242,
        locale: "en",
        debug: false,
        responseFeedback: false,
      },
      device,
      results: [makeEye("OD", false), makeEye("OS", true)],
      appVersion: "e2e",
    };

    useApp.getState().loadSession(session);
  });
}

