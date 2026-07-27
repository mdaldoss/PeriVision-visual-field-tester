import { LuminanceModel } from "../core/luminance";
import {
  dbToLightness,
  interpolateDb,
  meanDeviationDb,
  meanSensitivityDb,
  toFieldSamples,
} from "../core/scoring";
import type { DeviceProfile, EyeResult, SessionConfig } from "../core/types";
import { formatDistance } from "./calibration";

export const REPORT_W = 1000;
export const REPORT_H = 880;

const MARGIN = 50;
const PLOT_W = 420;
const PLOT_H = 340;
const PLOT_Y = 196;
const HEADER_RULE_Y = 164;

/**
 * Top of the grayscale ramp. A healthy eye tops out around 30-32 dB, while the
 * display's theoretical ceiling can be 45 dB. Scaling the map to the latter
 * would print a perfectly normal field as mid-gray; clamping here keeps normal
 * areas near-white and defects clearly dark, the way a clinical printout reads.
 */
const MAP_CEILING_DB = 34;
const PLOT_X_LEFT = MARGIN;
const PLOT_X_RIGHT = REPORT_W - MARGIN - PLOT_W;

export interface ReportOptions {
  result: EyeResult;
  config: SessionConfig;
  device: DeviceProfile;
  appVersion: string;
  dateISO: string;
}

/**
 * Draw a per-eye report laid out like a clinical perimetry printout: the
 * numeric sensitivities, the interpolated grayscale map, and - just as
 * important - the reliability indices and the caveats that say how far this
 * result can be trusted.
 */
export function drawEyeReport(ctx: CanvasRenderingContext2D, opts: ReportOptions): void {
  const { result, config, device } = opts;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, REPORT_W, REPORT_H);
  ctx.textBaseline = "alphabetic";

  drawHeader(ctx, opts);

  const lum = new LuminanceModel({ maxNits: device.maxNits, gamma: device.gamma });
  const ceiling = Math.max(result.floorDb + 10, Math.min(lum.ceilingDb, MAP_CEILING_DB));

  label(ctx, "Sensitivity (pseudo-dB)", PLOT_X_LEFT, PLOT_Y - 12);
  drawNumericPlot(ctx, result, PLOT_X_LEFT, PLOT_Y, PLOT_W, PLOT_H);

  label(ctx, "Grayscale map", PLOT_X_RIGHT, PLOT_Y - 12);
  drawGrayscalePlot(ctx, result, PLOT_X_RIGHT, PLOT_Y, PLOT_W, PLOT_H, ceiling);
  drawGrayRamp(ctx, PLOT_X_RIGHT, PLOT_Y + PLOT_H + 14, PLOT_W, result.floorDb, ceiling);

  drawReliability(ctx, result, MARGIN, PLOT_Y + PLOT_H + 70);
  drawSummary(ctx, result, config, MARGIN + 480, PLOT_Y + PLOT_H + 70);
  drawFooter(ctx, opts);

  if (result.debugRun) drawWatermark(ctx, "DEBUG RUN - NOT VALID");
  if (result.reliability.verdict === "low") {
    drawBanner(ctx, "LOW RELIABILITY - interpret with caution", "#b45309");
  }
}

function drawHeader(ctx: CanvasRenderingContext2D, opts: ReportOptions): void {
  const { result, config, device, dateISO, appVersion } = opts;
  ctx.fillStyle = "#111827";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillText("PeriVision", MARGIN, 56);

  ctx.font = "600 26px system-ui, sans-serif";
  const eyeLabel = result.eye === "OD" ? "OD (right eye)" : "OS (left eye)";
  const w = ctx.measureText(eyeLabel).width;
  ctx.fillText(eyeLabel, REPORT_W - MARGIN - w, 56);

  ctx.font = "13px system-ui, sans-serif";
  ctx.fillStyle = "#4b5563";
  const date = new Date(dateISO);
  const protocolLabel =
    result.protocol === "screening"
      ? "Suprathreshold screening"
      : result.protocol === "central"
        ? "Central threshold"
        : "Full threshold (4-2)";

  const lines = [
    `${protocolLabel} - grid ${result.gridLabel} - ${result.points.length} points`,
    `Tested field: ${result.maxXDeg.toFixed(0)}° horizontal x ${result.maxYDeg.toFixed(0)}° vertical from fixation`,
    `Viewing distance ${formatDistance(config.distanceMm, config.locale)} - stimulus ${config.stimulusColor}, 0.43° (Goldmann III equivalent)`,
    `${date.toLocaleString()} - duration ${(result.durationMs / 60000).toFixed(1)} min - PeriVision ${appVersion}`,
    `Display floor ${result.floorDb.toFixed(1)} dB - ${Math.round(device.maxNits)} nits assumed, gamma ${device.gamma.toFixed(2)}`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, MARGIN, 84 + i * 17));

  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  line(ctx, MARGIN, HEADER_RULE_Y, REPORT_W - MARGIN, HEADER_RULE_Y);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.fillStyle = "#111827";
  ctx.font = "600 15px system-ui, sans-serif";
  ctx.fillText(text, x, y);
}

interface PlotMap {
  toX: (xDeg: number) => number;
  toY: (yDeg: number) => number;
  scale: number;
  cx: number;
  cy: number;
}

function plotMap(
  result: EyeResult,
  x: number,
  y: number,
  w: number,
  h: number,
  padDeg = 3,
): PlotMap {
  const maxX = Math.max(6, result.maxXDeg + padDeg);
  const maxY = Math.max(6, result.maxYDeg + padDeg);
  const scale = Math.min(w / (2 * maxX), h / (2 * maxY));
  const cx = x + w / 2;
  const cy = y + h / 2;
  return {
    scale,
    cx,
    cy,
    toX: (xDeg: number) => cx + xDeg * scale,
    toY: (yDeg: number) => cy - yDeg * scale,
  };
}

function drawAxes(
  ctx: CanvasRenderingContext2D,
  map: PlotMap,
  result: EyeResult,
  box: { x: number; y: number; w: number; h: number },
): void {
  const maxX = result.maxXDeg + 3;
  const maxY = result.maxYDeg + 3;
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1;
  line(ctx, map.toX(-maxX), map.cy, map.toX(maxX), map.cy);
  line(ctx, map.cx, map.toY(-maxY), map.cx, map.toY(maxY));

  ctx.fillStyle = "#6b7280";
  ctx.font = "10px system-ui, sans-serif";
  ctx.textAlign = "center";
  // Degree labels go along the bottom edge, not on the meridian, where they
  // would sit on top of a row of sensitivity values.
  for (let d = 10; d <= maxX; d += 10) {
    for (const s of [-1, 1]) {
      const px = map.toX(d * s);
      line(ctx, px, map.cy - 4, px, map.cy + 4);
      ctx.fillText(`${d * s}°`, px, box.y + box.h - 5);
    }
  }
  ctx.textAlign = "left";
  for (let d = 10; d <= maxY; d += 10) {
    for (const s of [-1, 1]) {
      const py = map.toY(d * s);
      line(ctx, map.cx - 4, py, map.cx + 4, py);
      ctx.fillText(`${d * s}°`, box.x + 4, py + 3);
    }
  }
}

function drawNumericPlot(
  ctx: CanvasRenderingContext2D,
  result: EyeResult,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(x, y, w, h);
  const map = plotMap(result, x, y, w, h);
  drawAxes(ctx, map, result, { x, y, w, h });

  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const p of result.points) {
    const px = map.toX(p.xDeg);
    const py = map.toY(p.yDeg);
    const v = result.thresholds[p.id];
    const cls = result.classes?.[p.id];

    if (result.protocol === "screening" && cls) {
      // Screening classifies rather than measures, so it prints symbols.
      drawScreeningSymbol(ctx, px, py, cls);
      continue;
    }
    if (v === null || v === undefined) {
      // Not seen even at the display's maximum: a filled square, as clinical
      // printouts use for an absolute defect.
      ctx.fillStyle = "#111827";
      ctx.fillRect(px - 6, py - 6, 12, 12);
    } else {
      ctx.fillStyle = v < result.floorDb + 4 ? "#b91c1c" : "#111827";
      ctx.fillText(v.toFixed(0), px, py + 4);
    }
  }

  if (result.blindSpot) {
    ctx.fillStyle = "#374151";
    ctx.beginPath();
    ctx.arc(map.toX(result.blindSpot.xDeg), map.toY(result.blindSpot.yDeg), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "left";
  ctx.restore();
}

function drawScreeningSymbol(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cls: string,
): void {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#111827";
  if (cls === "normal") {
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.stroke();
  } else if (cls === "relative") {
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.beginPath();
    ctx.arc(px, py, 5.5, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#111827";
    ctx.beginPath();
    ctx.arc(px, py, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGrayscalePlot(
  ctx: CanvasRenderingContext2D,
  result: EyeResult,
  x: number,
  y: number,
  w: number,
  h: number,
  ceilingDb: number,
): void {
  const samples = toFieldSamples(result);
  const map = plotMap(result, x, y, w, h);
  const maxX = result.maxXDeg + 2;
  const maxY = result.maxYDeg + 2;

  // The map is built in its own canvas and then drawn in. putImageData ignores
  // the context transform, so writing it straight to a scaled report canvas
  // would land it at the wrong place and the wrong size.
  const off = document.createElement("canvas");
  off.width = Math.round(w);
  off.height = Math.round(h);
  const octx = off.getContext("2d");
  if (!octx) return;
  const img = octx.createImageData(off.width, off.height);

  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      const xDeg = (x + px - map.cx) / map.scale;
      const yDeg = (map.cy - (y + py)) / map.scale;
      const i = (py * img.width + px) * 4;
      let v = 255;
      if (Math.abs(xDeg) <= maxX && Math.abs(yDeg) <= maxY) {
        const db = interpolateDb(samples, xDeg, yDeg);
        if (db !== null) {
          // Clinical convention: sensitive areas print light, defects dark.
          const l = dbToLightness(db, result.floorDb, ceilingDb);
          v = Math.round(30 + l * 225);
        }
      }
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.drawImage(off, x, y, w, h);
  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(x, y, w, h);

  drawAxes(ctx, map, result, { x, y, w, h });
  ctx.fillStyle = "rgba(37,99,235,0.9)";
  for (const p of result.points) {
    ctx.fillRect(map.toX(p.xDeg) - 1, map.toY(p.yDeg) - 1, 2, 2);
  }
  if (result.blindSpot) {
    ctx.strokeStyle = "#1d4ed8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(map.toX(result.blindSpot.xDeg), map.toY(result.blindSpot.yDeg), 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGrayRamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  floorDb: number,
  ceilingDb: number,
): void {
  const steps = 10;
  const cell = w / steps;
  ctx.font = "10px system-ui, sans-serif";
  for (let i = 0; i < steps; i++) {
    const l = i / (steps - 1);
    const v = Math.round(30 + l * 225);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x + i * cell, y, cell, 12);
  }
  ctx.strokeStyle = "#d1d5db";
  ctx.strokeRect(x, y, w, 12);
  ctx.fillStyle = "#6b7280";
  ctx.fillText(`${floorDb.toFixed(0)} dB (defect)`, x, y + 26);
  const right = `${ceilingDb.toFixed(0)} dB (sensitive)`;
  ctx.fillText(right, x + w - ctx.measureText(right).width, y + 26);
}

function drawReliability(
  ctx: CanvasRenderingContext2D,
  result: EyeResult,
  x: number,
  y: number,
): void {
  const r = result.reliability;
  label(ctx, "Reliability", x, y);
  const rows: [string, string, boolean][] = [
    [
      "Fixation losses",
      `${pct(r.fixationLossRate)} (${r.blindSpotHits + r.gazeFixationLosses}/${r.blindSpotTrials + r.gazeChecks})`,
      r.reasons.includes("fixationLosses"),
    ],
    [
      "False positives",
      `${pct(r.falsePositiveRate)} (${r.fpCatchHits}/${r.fpCatchTrials} catch, ${r.spontaneousPresses + r.anticipatoryPresses} stray)`,
      r.reasons.includes("falsePositives"),
    ],
    [
      "False negatives",
      `${pct(r.falseNegativeRate)} (${r.fnCatchMisses}/${r.fnCatchTrials})`,
      r.reasons.includes("falseNegatives"),
    ],
    ["Trials discarded and repeated", `${r.invalidatedTrials}`, false],
    ["Mean reaction time", `${result.meanRtMs} ms`, false],
  ];

  ctx.font = "13px system-ui, sans-serif";
  rows.forEach(([k, v, bad], i) => {
    const ry = y + 26 + i * 21;
    ctx.fillStyle = "#4b5563";
    ctx.fillText(k, x, ry);
    ctx.fillStyle = bad ? "#b91c1c" : "#111827";
    ctx.fillText(v, x + 250, ry);
  });

  const verdict = r.verdict === "reliable" ? "RELIABLE" : "LOW RELIABILITY";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillStyle = r.verdict === "reliable" ? "#047857" : "#b45309";
  ctx.fillText(verdict, x, y + 26 + rows.length * 21 + 8);
}

function drawSummary(
  ctx: CanvasRenderingContext2D,
  result: EyeResult,
  config: SessionConfig,
  x: number,
  y: number,
): void {
  label(ctx, "Summary (estimates)", x, y);
  const mean = meanSensitivityDb(result);
  const md = meanDeviationDb(result, config.age);
  const measured = result.points.filter((p) => {
    const v = result.thresholds[p.id];
    return v !== null && v !== undefined;
  }).length;

  const rows: [string, string][] = [
    ["Mean sensitivity", `${mean.toFixed(1)} pseudo-dB`],
    ["Deviation vs age-expected", `${md >= 0 ? "+" : ""}${md.toFixed(1)} dB`],
    ["Points measured", `${measured} / ${result.points.length}`],
    ["Gaze checks performed", `${result.reliability.gazeChecks}`],
  ];
  ctx.font = "13px system-ui, sans-serif";
  rows.forEach(([k, v], i) => {
    const ry = y + 26 + i * 21;
    ctx.fillStyle = "#4b5563";
    ctx.fillText(k, x, ry);
    ctx.fillStyle = "#111827";
    ctx.fillText(v, x + 210, ry);
  });

  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui, sans-serif";
  wrap(
    ctx,
    "Deviation compares against an approximate age model, not a validated normative database.",
    x,
    y + 26 + rows.length * 21 + 6,
    360,
    14,
  );
}

function drawFooter(ctx: CanvasRenderingContext2D, opts: ReportOptions): void {
  const y = REPORT_H - 76;
  ctx.strokeStyle = "#d1d5db";
  line(ctx, MARGIN, y - 14, REPORT_W - MARGIN, y - 14);
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui, sans-serif";
  wrap(
    ctx,
    "Values are pseudo-dB on a device-relative scale: a laptop screen cannot be photometrically calibrated, " +
      "so absolute levels are not comparable between devices and deep defects saturate at the display floor. " +
      "PeriVision is a screening and self-monitoring tool, not a medical device, and does not diagnose any condition. " +
      "Discuss any concern - and any result that looks abnormal - with an eye-care professional.",
    MARGIN,
    y,
    REPORT_W - 2 * MARGIN,
    15,
  );
  ctx.fillText(`Device ${opts.device.id}`, MARGIN, REPORT_H - 14);
}

function drawBanner(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = "600 14px system-ui, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillText(text, REPORT_W - MARGIN - w, 150);
  ctx.restore();
}

function drawWatermark(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.save();
  ctx.translate(REPORT_W / 2, REPORT_H / 2);
  ctx.rotate(-Math.PI / 8);
  ctx.fillStyle = "rgba(185,28,28,0.13)";
  ctx.font = "700 76px system-ui, sans-serif";
  const w = ctx.measureText(text).width;
  ctx.fillText(text, -w / 2, 0);
  ctx.restore();
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(" ");
  let cur = "";
  let ly = y;
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && cur) {
      ctx.fillText(cur, x, ly);
      cur = word;
      ly += lineHeight;
    } else {
      cur = test;
    }
  }
  if (cur) ctx.fillText(cur, x, ly);
}

/** Render a report to a fresh canvas, ready to display or export. */
export function renderReportCanvas(opts: ReportOptions, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = REPORT_W * scale;
  canvas.height = REPORT_H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.scale(scale, scale);
  drawEyeReport(ctx, opts);
  return canvas;
}
