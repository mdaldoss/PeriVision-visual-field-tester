import { expect, test } from "@playwright/test";

/**
 * The report is drawn with the Canvas API, so it can only really be exercised
 * in a browser. This drives the same code the app uses and checks that a real
 * map comes out - not a blank rectangle.
 */
test("a synthetic result renders a report with a visible grayscale map", async ({ page }) => {
  await page.goto("/");

  const probe = await page.evaluate(async () => {
    // Vite resolves these at runtime; the path is built dynamically so
    // TypeScript does not try to resolve a browser URL at compile time.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [grid_, report_, reliability_] = await Promise.all([
      load("/src/core/grid.ts"),
      load("/src/services/report.ts"),
      load("/src/core/reliability.ts"),
    ]);
    const { resolveGrid, SPEC_24_2 } = grid_;
    const { drawEyeReport, REPORT_W, REPORT_H } = report_;
    const { summarizeReliability } = reliability_;

    const device = {
      id: "probe",
      pxPerMm: 5.57,
      screenWmm: 344.7,
      screenHmm: 193.9,
      screenWpx: 1920,
      screenHpx: 1080,
      gamma: 2.2,
      maxNits: 250,
      userAgent: "probe",
      calibratedAt: new Date().toISOString(),
    };
    const grid = resolveGrid(SPEC_24_2, "OD", device, 300);

    // Normal field with a dense inferior defect, so the map must show a dark
    // region in the lower half and a light region above it.
    const thresholds: Record<string, number | null> = {};
    for (const p of grid.points) {
      thresholds[p.id] = p.yDeg < -4 ? 12 : 29;
    }

    const counts = {
      fpCatchTrials: 8,
      fpCatchHits: 0,
      fnCatchTrials: 6,
      fnCatchMisses: 0,
      blindSpotTrials: 6,
      blindSpotHits: 0,
      gazeFixationLosses: 2,
      spontaneousPresses: 1,
      anticipatoryPresses: 0,
      invalidatedTrials: 5,
      gazeChecks: 180,
      scoredTrials: 200,
    };

    const result = {
      eye: "OD" as const,
      protocol: "threshold" as const,
      gridLabel: "24-2",
      thresholds,
      points: grid.points,
      reliability: summarizeReliability(counts),
      trials: [],
      presses: [],
      events: [],
      durationMs: 7 * 60 * 1000,
      meanRtMs: 430,
      medianRtMs: 410,
      blindSpot: { xDeg: 15.5, yDeg: -1.5 },
      maxXDeg: grid.maxXDeg,
      maxYDeg: grid.maxYDeg,
      floorDb: 11.2,
      debugRun: false,
    };

    const canvas = document.createElement("canvas");
    canvas.width = REPORT_W;
    canvas.height = REPORT_H;
    const ctx = canvas.getContext("2d")!;
    drawEyeReport(ctx, {
      result,
      config: {
        eyeOrder: ["OD"],
        protocol: "threshold",
        gridSpecId: "24-2",
        distanceMm: 300,
        stimulusColor: "white",
        fixationStyle: "dot",
        gazeMonitoring: true,
        age: 45,
        seed: 1,
        locale: "en",
        debug: false,
        responseFeedback: false,
      },
      device,
      appVersion: "test",
      dateISO: new Date().toISOString(),
    });

    // Sample the grayscale map: upper half should be light, lower half dark.
    const mapX = REPORT_W - 50 - 420;
    const mapY = 196;
    const sample = (dx: number, dy: number) =>
      ctx.getImageData(Math.round(mapX + dx), Math.round(mapY + dy), 1, 1).data[0];

    return {
      upper: sample(210, 110),
      lower: sample(210, 250),
      verdict: result.reliability.verdict,
    };
  });

  expect(probe.verdict).toBe("reliable");
  // The defective half must print visibly darker than the healthy half.
  expect(probe.upper).toBeGreaterThan(probe.lower + 40);
  expect(probe.upper).toBeGreaterThan(150);
  expect(probe.lower).toBeLessThan(120);
});
