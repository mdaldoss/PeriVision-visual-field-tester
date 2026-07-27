import type { DeviceProfile } from "../core/types";

/** ISO/IEC 7810 ID-1: the format of every credit and bank card. */
export const CREDIT_CARD_WIDTH_MM = 85.6;
export const CREDIT_CARD_HEIGHT_MM = 53.98;

/** Reasonable default when the user has not told us anything about the panel. */
export const DEFAULT_MAX_NITS = 250;
export const DEFAULT_GAMMA = 2.2;

export function pxPerMmFromCardWidth(cardWidthPx: number): number {
  return cardWidthPx / CREDIT_CARD_WIDTH_MM;
}

/** Screen scale from a diagonal in inches, using the reported resolution. */
export function pxPerMmFromDiagonal(
  diagonalInches: number,
  widthPx: number,
  heightPx: number,
): number {
  const diagonalPx = Math.hypot(widthPx, heightPx);
  const diagonalMm = diagonalInches * 25.4;
  return diagonalPx / diagonalMm;
}

export interface ScreenGeometry {
  widthPx: number;
  heightPx: number;
}

export function currentScreenGeometry(): ScreenGeometry {
  return {
    widthPx: window.screen?.width ?? window.innerWidth,
    heightPx: window.screen?.height ?? window.innerHeight,
  };
}

export function buildDeviceProfile(
  pxPerMm: number,
  opts: {
    gamma?: number;
    maxNits?: number;
    geometry?: ScreenGeometry;
    id?: string;
  } = {},
): DeviceProfile {
  const geom = opts.geometry ?? currentScreenGeometry();
  return {
    id: opts.id ?? `device-${Math.random().toString(36).slice(2, 10)}`,
    pxPerMm,
    screenWmm: geom.widthPx / pxPerMm,
    screenHmm: geom.heightPx / pxPerMm,
    screenWpx: geom.widthPx,
    screenHpx: geom.heightPx,
    gamma: opts.gamma ?? DEFAULT_GAMMA,
    maxNits: opts.maxNits ?? DEFAULT_MAX_NITS,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    calibratedAt: new Date().toISOString(),
  };
}

/** Sanity check: laptop panels land in a fairly narrow band of pixel density. */
export function isPlausiblePxPerMm(pxPerMm: number): boolean {
  return pxPerMm > 2 && pxPerMm < 20;
}

export function diagonalInches(profile: DeviceProfile): number {
  return Math.hypot(profile.screenWmm, profile.screenHmm) / 25.4;
}

/**
 * Estimate display gamma from a visual match. The user adjusts a solid patch
 * until it matches a 50% black/white dither pattern; the dither averages to
 * half the panel's maximum luminance, so if the match happens at gray level g
 * then (g/255)^gamma = 0.5.
 */
export function gammaFromMatch(matchedGray: number): number {
  const v = Math.min(Math.max(matchedGray, 1), 254) / 255;
  const gamma = Math.log(0.5) / Math.log(v);
  return Math.min(Math.max(gamma, 1.4), 3.0);
}

export function formatDistance(mm: number, locale: string): string {
  const cm = mm / 10;
  const inches = mm / 25.4;
  return locale.startsWith("en")
    ? `${cm.toFixed(0)} cm (${inches.toFixed(0)} in)`
    : `${cm.toFixed(0)} cm`;
}
