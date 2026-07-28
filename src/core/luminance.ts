/**
 * Luminance model: converting a requested sensitivity in dB into a gray level.
 *
 * WHY "PSEUDO-dB":
 * A clinical perimeter presents stimuli inside a bowl held at 10 cd/m^2 and can
 * produce a maximum stimulus of 3183 cd/m^2 (defined as 0 dB); dimmer stimuli
 * are higher dB. A laptop panel peaks around 250-400 cd/m^2, so its brightest
 * possible increment over a 10 cd/m^2 background is roughly 25 dB DIMMER than a
 * perimeter's 0 dB stimulus. That means:
 *   - We cannot measure deep defects: everything below our floor reads "not
 *     seen at max", which on a real perimeter might still be 5 dB of vision.
 *   - Absolute values depend on the panel, so cross-device comparison is not
 *     meaningful without a photometer.
 * We therefore report values on the HFA dB scale but label them pseudo-dB, and
 * we always print the device floor next to them.
 */

/** Perimetric background luminance, cd/m^2 (31.5 apostilb). */
export const BACKGROUND_NITS = 10;

/** Luminance of a clinical 0 dB stimulus, cd/m^2 (10000 apostilb). */
export const HFA_MAX_NITS = 3183;

/**
 * Smallest increment we trust the panel to render, in gray levels, given
 * spatio-temporal dithering. 8-bit panels quantise hard; dithering buys us
 * roughly a quarter level of effective resolution on a small patch.
 */
const MIN_GRAY_STEP = 0.25;

export interface LuminanceModelOptions {
  maxNits: number;
  gamma: number;
  backgroundNits?: number;
}

export class LuminanceModel {
  readonly maxNits: number;
  readonly gamma: number;
  readonly backgroundNits: number;
  /** Gray level (0..255, fractional) that renders the background. */
  readonly backgroundGray: number;
  /** dB of the brightest increment this display can produce. */
  readonly floorDb: number;
  /** dB of the dimmest increment this display can still render distinctly. */
  readonly ceilingDb: number;

  constructor(opts: LuminanceModelOptions) {
    this.maxNits = Math.max(opts.maxNits, 30);
    this.gamma = Math.min(Math.max(opts.gamma, 1.2), 3.2);
    this.backgroundNits = opts.backgroundNits ?? BACKGROUND_NITS;
    if (this.backgroundNits >= this.maxNits * 0.5) {
      // Degenerate config (very dim panel): keep some headroom for stimuli.
      this.backgroundNits = this.maxNits * 0.04;
    }
    this.backgroundGray = this.nitsToGray(this.backgroundNits);

    const maxDelta = this.maxNits - this.backgroundNits;
    this.floorDb = round1(10 * Math.log10(HFA_MAX_NITS / maxDelta));

    // Walk up in dB until the stimulus is no longer distinguishable from the
    // background at the panel's effective gray resolution.
    let db = this.floorDb;
    while (db < this.floorDb + 60) {
      const next = db + 0.5;
      if (this.grayForDb(next) - this.backgroundGray < MIN_GRAY_STEP) break;
      db = next;
    }
    this.ceilingDb = round1(db);
  }

  /** Display transfer function: gray level -> luminance. */
  grayToNits(gray: number): number {
    const v = clamp(gray, 0, 255) / 255;
    return this.maxNits * Math.pow(v, this.gamma);
  }

  /** Inverse transfer function: luminance -> (fractional) gray level. */
  nitsToGray(nits: number): number {
    const v = clamp(nits, 0, this.maxNits) / this.maxNits;
    return 255 * Math.pow(v, 1 / this.gamma);
  }

  /** Stimulus increment over background for a dB value, cd/m^2. */
  dbToDeltaNits(db: number): number {
    return HFA_MAX_NITS / Math.pow(10, db / 10);
  }

  /** Absolute stimulus luminance for a dB value, cd/m^2. */
  dbToNits(db: number): number {
    return this.backgroundNits + this.dbToDeltaNits(db);
  }

  /** Fractional gray level for a dB value, clamped to the panel's range. */
  grayForDb(db: number): number {
    return clamp(this.nitsToGray(this.dbToNits(db)), this.backgroundGray, 255);
  }

  /** True when the requested dB lands inside this display's usable range. */
  isRenderable(db: number): boolean {
    return db >= this.floorDb - 1e-6 && db <= this.ceilingDb + 1e-6;
  }

  /** Clamp an arbitrary dB request into the renderable range. */
  clampDb(db: number): number {
    return clamp(db, this.floorDb, this.ceilingDb);
  }

  /**
   * Convert a clinical-scale dB into the equivalent for this display, i.e. the
   * value we would have to render. Values brighter than the floor saturate.
   */
  describe(): string {
    return `floor ${this.floorDb.toFixed(1)} dB, ceiling ${this.ceilingDb.toFixed(1)} dB @ ${Math.round(this.maxNits)} nits, gamma ${this.gamma.toFixed(2)}`;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
