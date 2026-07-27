/**
 * Turning face landmarks into the handful of numbers the gaze model needs.
 *
 * MediaPipe's canonical face mesh numbers landmarks from the SUBJECT's point of
 * view: 33/133/159/145 and iris 468-472 belong to the subject's right eye,
 * 362/263/386/374 and iris 473-477 to their left eye.
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export const LM = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeUpper: 159,
  rightEyeLower: 145,
  leftEyeInner: 362,
  leftEyeOuter: 263,
  leftEyeUpper: 386,
  leftEyeLower: 374,
  rightIrisCenter: 468,
  rightIrisRing: [469, 470, 471, 472],
  leftIrisCenter: 473,
  leftIrisRing: [474, 475, 476, 477],
  noseTip: 1,
  forehead: 10,
  chin: 152,
  cheekLeft: 454,
  cheekRight: 234,
} as const;

/** Horizontal diameter of the human iris. Remarkably constant across adults. */
export const IRIS_DIAMETER_MM = 11.7;

export interface FaceMetrics {
  /** Feature vector fed to the gaze regression (includes the bias term). */
  features: number[];
  /** Mean iris diameter in image pixels, for the distance estimate. */
  irisDiameterPx: number;
  /** 0..1 per eye; high means closed. */
  blinkRight: number;
  blinkLeft: number;
  /** Face bounding box width in image pixels. */
  faceWidthPx: number;
  /** Face centre in normalised image coordinates. */
  faceCx: number;
  faceCy: number;
}

export const FEATURE_COUNT = 9;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: Landmark, b: Landmark): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Eye aspect ratio: lid gap over eye width. Used as a blink signal alongside
 * the model's blendshapes so we still detect blinks if blendshapes are off.
 */
export function eyeAspectRatio(upper: Landmark, lower: Landmark, outer: Landmark, inner: Landmark) {
  const w = dist(outer, inner);
  return w < 1e-6 ? 0 : dist(upper, lower) / w;
}

/** EAR below this is treated as a closed eye. */
export const EAR_CLOSED = 0.16;

export function extractMetrics(
  lms: Landmark[],
  imageWidth: number,
  imageHeight: number,
): FaceMetrics | null {
  if (lms.length < 478) return null;

  const px = (l: Landmark) => ({ x: l.x * imageWidth, y: l.y * imageHeight, z: l.z });
  const rOuter = px(lms[LM.rightEyeOuter]);
  const rInner = px(lms[LM.rightEyeInner]);
  const lInner = px(lms[LM.leftEyeInner]);
  const lOuter = px(lms[LM.leftEyeOuter]);
  const rIris = px(lms[LM.rightIrisCenter]);
  const lIris = px(lms[LM.leftIrisCenter]);
  const nose = px(lms[LM.noseTip]);
  const cheekL = px(lms[LM.cheekLeft]);
  const cheekR = px(lms[LM.cheekRight]);
  const forehead = px(lms[LM.forehead]);
  const chin = px(lms[LM.chin]);

  const rWidth = dist(rOuter, rInner);
  const lWidth = dist(lInner, lOuter);
  if (rWidth < 2 || lWidth < 2) return null;

  const rCenter = mid(rOuter, rInner);
  const lCenter = mid(lInner, lOuter);

  // Iris displacement inside the eye opening, normalised by eye width so it is
  // independent of how far away the user is sitting.
  const oxR = (rIris.x - rCenter.x) / rWidth;
  const oyR = (rIris.y - rCenter.y) / rWidth;
  const oxL = (lIris.x - lCenter.x) / lWidth;
  const oyL = (lIris.y - lCenter.y) / lWidth;

  const faceWidthPx = dist(cheekL, cheekR);
  const faceHeightPx = dist(forehead, chin);
  const faceCxPx = (cheekL.x + cheekR.x) / 2;
  const faceCyPx = (forehead.y + chin.y) / 2;

  // Crude head pose proxies. They matter because the same iris position means
  // a different gaze direction once the head turns.
  const yaw = faceWidthPx > 1e-6 ? (nose.x - faceCxPx) / faceWidthPx : 0;
  const pitch = faceHeightPx > 1e-6 ? (nose.y - faceCyPx) / faceHeightPx : 0;

  const irisR = irisDiameter(lms, LM.rightIrisRing, imageWidth, imageHeight);
  const irisL = irisDiameter(lms, LM.leftIrisRing, imageWidth, imageHeight);
  const irisDiameterPx = (irisR + irisL) / 2;

  const earR = eyeAspectRatio(
    px(lms[LM.rightEyeUpper]),
    px(lms[LM.rightEyeLower]),
    rOuter,
    rInner,
  );
  const earL = eyeAspectRatio(px(lms[LM.leftEyeUpper]), px(lms[LM.leftEyeLower]), lOuter, lInner);

  return {
    features: [
      1, // bias
      oxR,
      oyR,
      oxL,
      oyL,
      yaw,
      pitch,
      faceCxPx / imageWidth - 0.5,
      faceCyPx / imageHeight - 0.5,
    ],
    irisDiameterPx,
    blinkRight: earToBlink(earR),
    blinkLeft: earToBlink(earL),
    faceWidthPx,
    faceCx: faceCxPx / imageWidth,
    faceCy: faceCyPx / imageHeight,
  };
}

function earToBlink(ear: number): number {
  // Map the aspect ratio onto 0..1 where 1 means fully closed.
  const open = 0.3;
  return Math.min(1, Math.max(0, (open - ear) / (open - EAR_CLOSED)));
}

function irisDiameter(lms: Landmark[], ring: readonly number[], w: number, h: number): number {
  let maxD = 0;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const a = lms[ring[i]];
      const b = lms[ring[j]];
      maxD = Math.max(maxD, Math.hypot((a.x - b.x) * w, (a.y - b.y) * h));
    }
  }
  return maxD;
}

/**
 * Distance from the camera, from how large the iris appears. The iris is a
 * good ruler because its true size barely varies between people; the estimate
 * is still only good to about 10%, which is fine for "sit at 33 cm" guidance
 * but not for anything we would put on the report as a measurement.
 */
export function estimateDistanceMm(
  irisDiameterPx: number,
  imageWidth: number,
  horizontalFovDeg = 60,
  correction = 1,
): number | null {
  if (irisDiameterPx < 2) return null;
  const focalPx = imageWidth / 2 / Math.tan((horizontalFovDeg * Math.PI) / 360);
  return (IRIS_DIAMETER_MM * focalPx * correction) / irisDiameterPx;
}
