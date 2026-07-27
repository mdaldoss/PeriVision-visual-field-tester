/**
 * Approximate "hill of vision" — the sensitivity a healthy eye is expected to
 * have at a given eccentricity and age.
 *
 * This is a deliberately simple linear approximation of the well-known pattern
 * (sensitivity peaks at fixation, falls with eccentricity, declines with age,
 * and is slightly worse in the superior field). It is used only to:
 *   - pick sensible starting levels for the staircase, and
 *   - pick the stimulus level for suprathreshold screening.
 * It is NOT a validated normative database, so it is never used to declare a
 * point "abnormal" on its own.
 */

const BASE_DB = 33.5;
const AGE_SLOPE_DB_PER_YEAR = 0.08;
const ECC_SLOPE_DB_PER_DEG = 0.15;
const SUPERIOR_PENALTY_DB = 1.5;

export function expectedSensitivityDb(eccDeg: number, yDeg: number, age: number): number {
  const safeAge = Math.min(Math.max(age, 10), 95);
  let db = BASE_DB - AGE_SLOPE_DB_PER_YEAR * safeAge - ECC_SLOPE_DB_PER_DEG * eccDeg;
  if (yDeg > 12) db -= SUPERIOR_PENALTY_DB;
  return Math.round(Math.min(Math.max(db, 8), 36) * 10) / 10;
}

/** How much brighter than the expected threshold a screening stimulus is shown. */
export const SCREENING_OFFSET_DB = 6;
