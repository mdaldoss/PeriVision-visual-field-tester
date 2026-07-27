import type { DeviceProfile, Eye, GridPoint, GridSpec, ResolvedGrid } from "./types";

/** Keep stimuli this far inside the physical screen edge. */
const EDGE_SAFETY = 0.94;

/** Comfort limits for laptop viewing, mm. */
export const MIN_DISTANCE_MM = 300;
export const MAX_DISTANCE_MM = 600;

/**
 * Standard 24-2 layout: 54 points on a 6 deg grid straddling the meridians,
 * out to 21 deg, plus the two nasal-step points at 27 deg. Defined here for a
 * RIGHT eye (nasal = negative x); mirrored for the left eye in resolveGrid().
 */
const GRID_24_2_ROWS: { y: number; xs: number[] }[] = [
  { y: 21, xs: [-9, -3, 3, 9] },
  { y: 15, xs: [-15, -9, -3, 3, 9, 15] },
  { y: 9, xs: [-21, -15, -9, -3, 3, 9, 15, 21] },
  { y: 3, xs: [-27, -21, -15, -9, -3, 3, 9, 15, 21] },
  { y: -3, xs: [-27, -21, -15, -9, -3, 3, 9, 15, 21] },
  { y: -9, xs: [-21, -15, -9, -3, 3, 9, 15, 21] },
  { y: -15, xs: [-15, -9, -3, 3, 9, 15] },
  { y: -21, xs: [-9, -3, 3, 9] },
];

export const SPEC_24_2: GridSpec = {
  id: "24-2",
  label: "24-2",
  points: GRID_24_2_ROWS.flatMap((row) => row.xs.map((x) => ({ xDeg: x, yDeg: row.y }))),
  // The vertical half-height of a 16:9 laptop is the binding constraint: a
  // 15.6" panel keeps ~85% of the pattern at 30 cm, a 13" one only ~60% (it
  // loses the +/-15 and +/-21 deg rows). What survives is still a genuine
  // central field test out to the horizontal periphery, and the report always
  // prints the extent actually covered - so the floor only rejects the cases
  // where too little is left to be worth calling a field test at all.
  minCoverage: 0.5,
};

/**
 * A 10-2-STYLE macular grid: 2 deg spacing on odd degrees within the central
 * 10 deg. This approximates the clinical 10-2 pattern (which has 68 points);
 * we use a symmetric radius rule instead of the exact proprietary layout, so
 * it yields 80 points. Reports label it "10-2-style" for honesty.
 */
function build10_2Style(): { xDeg: number; yDeg: number }[] {
  const coords = [-9, -7, -5, -3, -1, 1, 3, 5, 7, 9];
  const pts: { xDeg: number; yDeg: number }[] = [];
  for (const y of coords) {
    for (const x of coords) {
      if (Math.hypot(x, y) <= 10.0) pts.push({ xDeg: x, yDeg: y });
    }
  }
  return pts;
}

export const SPEC_10_2: GridSpec = {
  id: "10-2-style",
  label: "10-2-style",
  points: build10_2Style(),
  minCoverage: 0.9, // this one fits on every laptop; if it doesn't, something is wrong
};

export const GRID_SPECS: Record<string, GridSpec> = {
  [SPEC_24_2.id]: SPEC_24_2,
  [SPEC_10_2.id]: SPEC_10_2,
};

export function getGridSpec(id: string): GridSpec {
  const spec = GRID_SPECS[id];
  if (!spec) throw new Error(`Unknown grid spec: ${id}`);
  return spec;
}

/** Physical offset on a flat screen for a given visual angle. */
export function degToMm(deg: number, distanceMm: number): number {
  return distanceMm * Math.tan((deg * Math.PI) / 180);
}

export function mmToDeg(mm: number, distanceMm: number): number {
  return (Math.atan(mm / distanceMm) * 180) / Math.PI;
}

export function degToPx(deg: number, distanceMm: number, pxPerMm: number): number {
  return degToMm(deg, distanceMm) * pxPerMm;
}

/**
 * Angular size (diameter) of a stimulus rendered at an eccentric position.
 * Using the small-angle form at the centre is close enough for a 0.43 deg dot;
 * we simply convert the angular diameter to mm at the viewing distance.
 */
export function angularSizeToPx(sizeDeg: number, distanceMm: number, pxPerMm: number): number {
  return 2 * degToPx(sizeDeg / 2, distanceMm, pxPerMm);
}

export function pointId(xDeg: number, yDeg: number): string {
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `x${fmt(xDeg)}_y${fmt(yDeg)}`;
}

/**
 * The furthest the user can sit and still have the whole grid on screen.
 * Sitting further away shrinks the angular field; sitting closer is
 * uncomfortable and strains accommodation, so the result is clamped to the
 * comfort range and the caller clips whatever still does not fit.
 */
export function recommendedDistanceMm(spec: GridSpec, device: DeviceProfile): number {
  const maxX = Math.max(...spec.points.map((p) => Math.abs(p.xDeg)));
  const maxY = Math.max(...spec.points.map((p) => Math.abs(p.yDeg)));
  const halfW = (device.screenWmm / 2) * EDGE_SAFETY;
  const halfH = (device.screenHmm / 2) * EDGE_SAFETY;
  const dForX = halfW / Math.tan((maxX * Math.PI) / 180);
  const dForY = halfH / Math.tan((maxY * Math.PI) / 180);
  const ideal = Math.min(dForX, dForY);
  return Math.round(Math.min(MAX_DISTANCE_MM, Math.max(MIN_DISTANCE_MM, ideal)));
}

/** Largest visual angles the screen can show at a given distance. */
export function screenExtentDeg(device: DeviceProfile, distanceMm: number) {
  return {
    xDeg: mmToDeg((device.screenWmm / 2) * EDGE_SAFETY, distanceMm),
    yDeg: mmToDeg((device.screenHmm / 2) * EDGE_SAFETY, distanceMm),
  };
}

/**
 * Turn a nominal spec into the points we can actually deliver on this screen,
 * mirrored for the tested eye. Points that fall off-screen are dropped and
 * counted; the report prints the true tested extent.
 */
export function resolveGrid(
  spec: GridSpec,
  eye: Eye,
  device: DeviceProfile,
  distanceMm: number,
): ResolvedGrid {
  const limit = screenExtentDeg(device, distanceMm);
  const mirror = eye === "OS" ? -1 : 1;
  const points: GridPoint[] = [];
  for (const p of spec.points) {
    const xDeg = p.xDeg * mirror;
    const yDeg = p.yDeg;
    if (Math.abs(xDeg) > limit.xDeg || Math.abs(yDeg) > limit.yDeg) continue;
    points.push({ id: pointId(xDeg, yDeg), xDeg, yDeg, eccDeg: Math.hypot(xDeg, yDeg) });
  }
  points.sort((a, b) => a.eccDeg - b.eccDeg || a.id.localeCompare(b.id));
  return {
    spec,
    eye,
    points,
    coverage: points.length / spec.points.length,
    maxXDeg: points.reduce((m, p) => Math.max(m, Math.abs(p.xDeg)), 0),
    maxYDeg: points.reduce((m, p) => Math.max(m, Math.abs(p.yDeg)), 0),
    droppedCount: spec.points.length - points.length,
  };
}

/** Physiological blind spot centre in field coordinates for the tested eye. */
export function blindSpotCenter(eye: Eye): { xDeg: number; yDeg: number } {
  return { xDeg: eye === "OD" ? 15.5 : -15.5, yDeg: -1.5 };
}

/** Candidate probe locations used to find a spot the user genuinely cannot see. */
export function blindSpotCandidates(eye: Eye): { xDeg: number; yDeg: number }[] {
  const c = blindSpotCenter(eye);
  const sign = eye === "OD" ? 1 : -1;
  return [
    c,
    { xDeg: c.xDeg + sign * 1.5, yDeg: c.yDeg },
    { xDeg: c.xDeg - sign * 1.5, yDeg: c.yDeg },
    { xDeg: c.xDeg, yDeg: c.yDeg + 1.5 },
    { xDeg: c.xDeg, yDeg: c.yDeg - 1.5 },
  ];
}

/** True when the blind spot is on screen and therefore usable for fixation checks. */
export function blindSpotUsable(eye: Eye, device: DeviceProfile, distanceMm: number): boolean {
  const limit = screenExtentDeg(device, distanceMm);
  const c = blindSpotCenter(eye);
  return Math.abs(c.xDeg) + 2 <= limit.xDeg && Math.abs(c.yDeg) + 2 <= limit.yDeg;
}
