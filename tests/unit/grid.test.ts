import { describe, expect, it } from "vitest";
import {
  blindSpotCenter,
  blindSpotUsable,
  degToPx,
  mmToDeg,
  recommendedDistanceMm,
  resolveGrid,
  screenExtentDeg,
  SPEC_10_2,
  SPEC_24_2,
} from "../../src/core/grid";
import { makeDevice } from "./helpers/fixtures";

describe("grid specs", () => {
  it("24-2 has the standard 54 points", () => {
    expect(SPEC_24_2.points).toHaveLength(54);
  });

  it("24-2 is symmetric about the horizontal meridian", () => {
    for (const p of SPEC_24_2.points) {
      expect(SPEC_24_2.points.some((q) => q.xDeg === p.xDeg && q.yDeg === -p.yDeg)).toBe(true);
    }
  });

  it("24-2 has its nasal step at 27 degrees on the nasal side for OD", () => {
    const at27 = SPEC_24_2.points.filter((p) => Math.abs(p.xDeg) === 27);
    expect(at27).toHaveLength(2);
    // Defined for the right eye, where nasal is negative x.
    expect(at27.every((p) => p.xDeg === -27)).toBe(true);
  });

  it("10-2-style stays inside the central 10 degrees", () => {
    expect(SPEC_10_2.points.length).toBeGreaterThan(60);
    for (const p of SPEC_10_2.points) {
      expect(Math.hypot(p.xDeg, p.yDeg)).toBeLessThanOrEqual(10.0001);
    }
  });
});

describe("geometry", () => {
  it("converts degrees to pixels using the tangent, not the small-angle rule", () => {
    const device = makeDevice();
    // 20 deg at 330 mm is 330*tan(20) = 120.1 mm.
    const px = degToPx(20, 330, device.pxPerMm);
    expect(px / device.pxPerMm).toBeCloseTo(330 * Math.tan((20 * Math.PI) / 180), 3);
  });

  it("round-trips mm and degrees", () => {
    expect(mmToDeg(120.1, 330)).toBeCloseTo(20, 2);
  });
});

describe("recommended distance", () => {
  it("clamps a 15.6 inch laptop to the near end of the comfort range for 24-2", () => {
    // The +/-21 deg rows would need ~250 mm, which is too close for comfort,
    // so we expect the minimum comfortable distance and some clipping.
    const d = recommendedDistanceMm(SPEC_24_2, makeDevice());
    expect(d).toBe(300);
  });

  it("puts the central grid at a comfortable distance", () => {
    const d = recommendedDistanceMm(SPEC_10_2, makeDevice());
    expect(d).toBeGreaterThanOrEqual(500);
    expect(d).toBeLessThanOrEqual(600);
  });

  it("matches the plan's coverage table at 30 cm", () => {
    const ext = screenExtentDeg(makeDevice(), 300);
    expect(ext.xDeg).toBeCloseTo(28.4, 0);
    expect(ext.yDeg).toBeCloseTo(16.9, 0);
  });
});

describe("resolveGrid", () => {
  const device = makeDevice();

  it("drops the rows that do not fit and reports the true extent", () => {
    const grid = resolveGrid(SPEC_24_2, "OD", device, 300);
    expect(grid.points.length).toBeLessThan(54);
    expect(grid.coverage).toBeGreaterThan(SPEC_24_2.minCoverage);
    expect(grid.maxYDeg).toBeLessThanOrEqual(17);
    expect(grid.droppedCount).toBe(54 - grid.points.length);
    // Nothing outside the physical screen survives.
    for (const p of grid.points) {
      expect(Math.abs(p.yDeg)).toBeLessThanOrEqual(grid.maxYDeg);
    }
  });

  it("mirrors horizontally for the left eye", () => {
    const od = resolveGrid(SPEC_24_2, "OD", device, 300);
    const os = resolveGrid(SPEC_24_2, "OS", device, 300);
    expect(os.points).toHaveLength(od.points.length);
    for (const p of od.points) {
      expect(os.points.some((q) => q.xDeg === -p.xDeg && q.yDeg === p.yDeg)).toBe(true);
    }
  });

  it("keeps the whole central grid at its recommended distance", () => {
    const d = recommendedDistanceMm(SPEC_10_2, device);
    const grid = resolveGrid(SPEC_10_2, "OD", device, d);
    expect(grid.coverage).toBe(1);
  });

  it("sorts points from the centre outwards", () => {
    const grid = resolveGrid(SPEC_24_2, "OD", device, 300);
    for (let i = 1; i < grid.points.length; i++) {
      expect(grid.points[i].eccDeg).toBeGreaterThanOrEqual(grid.points[i - 1].eccDeg);
    }
  });
});

describe("blind spot", () => {
  it("sits temporally for each eye", () => {
    expect(blindSpotCenter("OD").xDeg).toBeGreaterThan(0);
    expect(blindSpotCenter("OS").xDeg).toBeLessThan(0);
  });

  it("is on screen at the usual working distance", () => {
    expect(blindSpotUsable("OD", makeDevice(), 330)).toBe(true);
    expect(blindSpotUsable("OS", makeDevice(), 330)).toBe(true);
  });

  it("falls off screen if the user sits much too far away", () => {
    expect(blindSpotUsable("OD", makeDevice(), 900)).toBe(false);
  });
});
