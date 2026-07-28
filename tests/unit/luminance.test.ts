import { describe, expect, it } from "vitest";
import { BACKGROUND_NITS, HFA_MAX_NITS, LuminanceModel } from "../../src/core/luminance";

describe("LuminanceModel", () => {
  const lum = new LuminanceModel({ maxNits: 250, gamma: 2.2 });

  it("puts the floor where the panel's brightest increment lands on the HFA scale", () => {
    // 250 - 10 = 240 cd/m^2 of increment; 10*log10(3183/240) = 11.2 dB.
    expect(lum.floorDb).toBeCloseTo(11.2, 1);
  });

  it("cannot reach a clinical 0 dB stimulus", () => {
    expect(lum.floorDb).toBeGreaterThan(5);
    expect(lum.isRenderable(0)).toBe(false);
  });

  it("covers the range where normal sensitivities live", () => {
    expect(lum.ceilingDb).toBeGreaterThan(30);
    expect(lum.isRenderable(28)).toBe(true);
  });

  it("is monotonic: more dB means a dimmer stimulus", () => {
    for (let db = lum.floorDb; db < lum.ceilingDb - 1; db += 1) {
      expect(lum.grayForDb(db + 1)).toBeLessThan(lum.grayForDb(db));
    }
  });

  it("never renders a stimulus below the background", () => {
    expect(lum.grayForDb(lum.ceilingDb + 20)).toBeGreaterThanOrEqual(lum.backgroundGray);
  });

  it("round-trips gray and luminance through the gamma curve", () => {
    for (const nits of [10, 50, 120, 250]) {
      expect(lum.grayToNits(lum.nitsToGray(nits))).toBeCloseTo(nits, 4);
    }
  });

  it("renders the perimetric background as a dark gray, not black", () => {
    expect(lum.backgroundGray).toBeGreaterThan(30);
    expect(lum.backgroundGray).toBeLessThan(90);
    expect(lum.grayToNits(lum.backgroundGray)).toBeCloseTo(BACKGROUND_NITS, 5);
  });

  it("a brighter panel reaches a lower (brighter) floor", () => {
    const bright = new LuminanceModel({ maxNits: 600, gamma: 2.2 });
    expect(bright.floorDb).toBeLessThan(lum.floorDb);
  });

  it("clamps requests into the renderable range", () => {
    expect(lum.clampDb(0)).toBe(lum.floorDb);
    expect(lum.clampDb(99)).toBe(lum.ceilingDb);
  });

  it("keeps headroom on an implausibly dim panel", () => {
    const dim = new LuminanceModel({ maxNits: 40, gamma: 2.2 });
    expect(dim.backgroundNits).toBeLessThan(dim.maxNits / 2);
    expect(dim.ceilingDb).toBeGreaterThan(dim.floorDb);
  });

  it("uses the clinical constants", () => {
    expect(HFA_MAX_NITS).toBe(3183);
    expect(BACKGROUND_NITS).toBe(10);
  });
});
