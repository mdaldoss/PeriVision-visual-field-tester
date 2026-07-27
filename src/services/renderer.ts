import { degToPx } from "../core/grid";
import type { LuminanceModel } from "../core/luminance";
import type { FixationStyle, StimulusColor } from "../core/types";

/**
 * 4x4 ordered (Bayer) dither matrix. An 8-bit panel can only step luminance in
 * whole gray levels, which near threshold is a coarse 1-2 dB. Dithering a small
 * patch between two adjacent levels lets us land between them: the eye
 * integrates the pattern at normal viewing distance, so a stimulus at gray
 * 61.4 really does look dimmer than one at 62.
 */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export interface RendererGeometry {
  /** CSS pixels per millimetre on this display. */
  pxPerMm: number;
  /** Locked-in viewing distance, mm. */
  distanceMm: number;
  /** Stimulus diameter in degrees (Goldmann III is 0.43). */
  stimulusSizeDeg: number;
  color: StimulusColor;
  fixation: FixationStyle;
}

export interface DrawState {
  showFixation: boolean;
  stimulus: { xDeg: number; yDeg: number; levelDb: number } | null;
  /** 0..1, drawn as a faint ring around fixation. */
  progress: number;
  /** Debug-only overlay markers, in field degrees. */
  debugMarkers?: { xDeg: number; yDeg: number; color: string; label?: string }[];
  /** Debug-only gaze crosshair, in field degrees. */
  debugGaze?: { xDeg: number; yDeg: number; deviationDeg: number } | null;
}

/** Smallest stimulus we will draw. Below this, dithering and shape break down. */
const MIN_STIMULUS_PX = 6;

export class StimulusRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private patchCache = new Map<string, ImageData>();
  /** True when the requested stimulus size had to be enlarged to stay visible. */
  sizeCompensated = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private lum: LuminanceModel,
    private geom: RendererGeometry,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  updateGeometry(geom: Partial<RendererGeometry>): void {
    this.geom = { ...this.geom, ...geom };
    this.patchCache.clear();
  }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.patchCache.clear();
  }

  /** Field degrees to CSS pixel position on the canvas. */
  degToCanvas(xDeg: number, yDeg: number): { x: number; y: number } {
    const { pxPerMm, distanceMm } = this.geom;
    return {
      x: this.cssW / 2 + degToPx(xDeg, distanceMm, pxPerMm),
      // Screen y grows downwards; the field's +y is up.
      y: this.cssH / 2 - degToPx(yDeg, distanceMm, pxPerMm),
    };
  }

  /** Diameter of a stimulus in CSS pixels, before any minimum is applied. */
  stimulusDiameterPx(): number {
    const { pxPerMm, distanceMm, stimulusSizeDeg } = this.geom;
    return 2 * degToPx(stimulusSizeDeg / 2, distanceMm, pxPerMm);
  }

  draw(state: DrawState): void {
    const ctx = this.ctx;
    const bg = Math.round(this.lum.backgroundGray);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgb(${bg},${bg},${bg})`;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    if (state.showFixation) {
      this.drawFixation(ctx);
      if (state.progress > 0) this.drawProgress(ctx, state.progress);
    }

    for (const m of state.debugMarkers ?? []) {
      const { x, y } = this.degToCanvas(m.xDeg, m.yDeg);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = m.color;
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(m.label, x + 8, y - 8);
      }
    }

    if (state.debugGaze) {
      this.drawDebugGaze(ctx, state.debugGaze);
    }

    if (state.stimulus) {
      this.drawStimulus(state.stimulus.xDeg, state.stimulus.yDeg, state.stimulus.levelDb);
    }
  }

  private drawFixation(ctx: CanvasRenderingContext2D): void {
    // The fixation target is deliberately dim: a bright one would light-adapt
    // the fovea and cast glare over the central field.
    const g = Math.round(Math.min(255, this.lum.backgroundGray * 2.4 + 24));
    ctx.strokeStyle = ctx.fillStyle = `rgb(${g},${g},${g})`;
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    const rPx = degToPx(0.15, this.geom.distanceMm, this.geom.pxPerMm);

    if (this.geom.fixation === "cross") {
      const arm = Math.max(6, rPx * 4);
      ctx.lineWidth = Math.max(1.5, rPx * 0.7);
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy + arm);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(3, rPx), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Progress ring around fixation. Deliberately a ring and not a number or a
   * bar somewhere else on screen: anything the user has to read pulls their
   * eye off the fixation target, which is exactly what we are trying to
   * prevent.
   */
  private drawProgress(ctx: CanvasRenderingContext2D, progress: number): void {
    const cx = this.cssW / 2;
    const cy = this.cssH / 2;
    const r = Math.max(14, degToPx(0.9, this.geom.distanceMm, this.geom.pxPerMm));
    const g = Math.round(Math.min(255, this.lum.backgroundGray * 1.5));
    ctx.strokeStyle = `rgb(${g},${g},${g})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress));
    ctx.stroke();
  }

  private drawDebugGaze(
    ctx: CanvasRenderingContext2D,
    gaze: { xDeg: number; yDeg: number; deviationDeg: number },
  ): void {
    const { x, y } = this.degToCanvas(gaze.xDeg, gaze.yDeg);
    const bad = gaze.deviationDeg > 4;
    ctx.strokeStyle = bad ? "#ff5c5c" : "#39d98a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 14, y);
    ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Draw a stimulus. The disc is anti-aliased by pixel coverage and dithered
   * to a fractional gray level, then written straight to the backing store at
   * device-pixel resolution so the dither pattern is not resampled.
   */
  private drawStimulus(xDeg: number, yDeg: number, levelDb: number): void {
    const gray = this.lum.grayForDb(levelDb);
    const diameterCss = this.stimulusDiameterPx();
    let diameterDev = diameterCss * this.dpr;
    this.sizeCompensated = diameterDev < MIN_STIMULUS_PX;
    if (this.sizeCompensated) diameterDev = MIN_STIMULUS_PX;

    const patch = this.getPatch(diameterDev / 2, gray);
    const { x, y } = this.degToCanvas(xDeg, yDeg);
    const devX = Math.round(x * this.dpr - patch.width / 2);
    const devY = Math.round(y * this.dpr - patch.height / 2);
    // putImageData ignores the transform, which is what we want here.
    this.ctx.putImageData(patch, devX, devY);
  }

  private getPatch(radiusDev: number, gray: number): ImageData {
    const key = `${radiusDev.toFixed(2)}|${gray.toFixed(3)}|${this.geom.color}`;
    const cached = this.patchCache.get(key);
    if (cached) return cached;

    const bg = this.lum.backgroundGray;
    const size = Math.ceil(radiusDev * 2) + 4;
    const img = this.ctx.createImageData(size, size);
    const c = size / 2;

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const dx = px - c + 0.5;
        const dy = py - c + 0.5;
        const d = Math.hypot(dx, dy);
        const coverage = clamp(radiusDev + 0.5 - d, 0, 1);
        const value = bg + coverage * (gray - bg);
        const v = dither(value, px, py);
        const bgi = Math.round(bg);
        const i = (py * size + px) * 4;
        if (this.geom.color === "red") {
          // Keep the increment in the red channel only, over the neutral
          // background, so the stimulus is chromatic rather than just brighter.
          img.data[i] = v;
          img.data[i + 1] = bgi;
          img.data[i + 2] = bgi;
        } else {
          img.data[i] = v;
          img.data[i + 1] = v;
          img.data[i + 2] = v;
        }
        img.data[i + 3] = 255;
      }
    }
    if (this.patchCache.size > 200) this.patchCache.clear();
    this.patchCache.set(key, img);
    return img;
  }
}

/** Round a fractional gray level to an integer using an ordered dither. */
export function dither(value: number, x: number, y: number): number {
  const base = Math.floor(value);
  const frac = value - base;
  const threshold = (BAYER_4[y & 3][x & 3] + 0.5) / 16;
  const v = frac > threshold ? base + 1 : base;
  return clamp(Math.round(v), 0, 255);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
