import type { Eye, GazeSample } from "../../core/types";
import { estimateDistanceMm, FEATURE_COUNT } from "./features";
import { OneEuroPoint } from "./oneEuro";
import { predict, ridgeFit, rmsError } from "./ridge";
import type { WorkerOut } from "./faceWorker";

/**
 * The model and its WASM runtime are fetched once from a CDN (overridable, so
 * the whole app can be self-hosted offline). This is a one-time download of
 * code and weights - camera frames are never uploaded anywhere.
 */
const WASM_BASE =
  import.meta.env.VITE_MP_WASM ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  import.meta.env.VITE_MP_MODEL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type GazeStatus = "idle" | "requesting" | "loading" | "ready" | "unavailable";

/** Blink score above which we call the eye closed. */
const BLINK_THRESHOLD = 0.5;
/**
 * Assumed quality of an uncalibrated estimate, in degrees. It is deliberately
 * pessimistic: the engine widens its fixation-loss threshold in proportion, so
 * without calibration we only ever catch gross deviations instead of throwing
 * away good trials on noise.
 */
const UNCALIBRATED_QUALITY_DEG = 8;
/** Rough degrees of gaze per unit of normalised iris offset, before calibration. */
const RAW_GAIN_X = 110;
const RAW_GAIN_Y = 140;

export interface GazeDebugInfo {
  status: GazeStatus;
  delegate: string | null;
  fps: number;
  faceFound: boolean;
  rawDistanceMm: number | null;
  gazeXDeg: number;
  gazeYDeg: number;
  deviationDeg: number;
  blinkLeft: number;
  blinkRight: number;
  openEye: Eye | null;
  calibrated: boolean;
  qualityDeg: number;
  error: string | null;
}

interface CalibrationSample {
  features: number[];
  targetXDeg: number;
  targetYDeg: number;
}

export class GazeService {
  status: GazeStatus = "idle";
  error: string | null = null;
  delegate: string | null = null;

  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private busy = false;
  private stopped = false;
  private intervalHandle: number | null = null;

  private listeners = new Set<(s: GazeSample) => void>();
  private smoother = new OneEuroPoint(1.2, 0.03);

  private weightsX: number[] | null = null;
  private weightsY: number[] | null = null;
  private qualityDeg = UNCALIBRATED_QUALITY_DEG;
  private calibrating = false;
  private calibrationTarget: { xDeg: number; yDeg: number } | null = null;
  private calibrationSamples: CalibrationSample[] = [];

  private distanceCorrection = 1;
  private frameTimes: number[] = [];
  private debug: GazeDebugInfo = {
    status: "idle",
    delegate: null,
    fps: 0,
    faceFound: false,
    rawDistanceMm: null,
    gazeXDeg: 0,
    gazeYDeg: 0,
    deviationDeg: 0,
    blinkLeft: 0,
    blinkRight: 0,
    openEye: null,
    calibrated: false,
    qualityDeg: UNCALIBRATED_QUALITY_DEG,
    error: null,
  };

  get isCalibrated(): boolean {
    return this.weightsX !== null && this.weightsY !== null;
  }

  getDebug(): GazeDebugInfo {
    return { ...this.debug, status: this.status, error: this.error, delegate: this.delegate };
  }

  onSample(cb: (s: GazeSample) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Ask for the camera and spin up the model. Resolves false if unavailable. */
  async start(): Promise<boolean> {
    if (this.status === "ready") return true;
    this.stopped = false;
    this.status = "requesting";
    this.error = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      const video = document.createElement("video");
      video.srcObject = this.stream;
      video.playsInline = true;
      video.muted = true;
      await video.play();
      this.video = video;

      this.status = "loading";
      await this.startWorker();
      this.status = "ready";
      this.pump();
      return true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.status = "unavailable";
      this.stop();
      return false;
    }
  }

  private startWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./faceWorker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      const timeout = window.setTimeout(
        () => reject(new Error("Face model timed out while loading")),
        45000,
      );
      worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const msg = e.data;
        if (msg.type === "ready") {
          window.clearTimeout(timeout);
          this.delegate = msg.delegate;
          worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.onWorkerMessage(ev.data);
          resolve();
        } else if (msg.type === "error") {
          window.clearTimeout(timeout);
          reject(new Error(msg.message));
        }
      };
      worker.onerror = (e) => {
        window.clearTimeout(timeout);
        reject(new Error(e.message || "Face worker failed to start"));
      };
      worker.postMessage({ type: "init", wasmBase: WASM_BASE, modelUrl: MODEL_URL });
    });
  }

  /** Feed frames to the worker, never more than one in flight. */
  private pump(): void {
    const video = this.video;
    if (!video) return;

    const send = async () => {
      if (this.stopped || this.busy || !this.worker) return;
      if (video.readyState < 2) return;
      this.busy = true;
      try {
        const bitmap = await createImageBitmap(video);
        this.worker.postMessage({ type: "frame", bitmap, timestamp: performance.now() }, [bitmap]);
      } catch {
        this.busy = false;
      }
    };

    const rvfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }
    ).requestVideoFrameCallback;

    if (typeof rvfc === "function") {
      const loop = () => {
        if (this.stopped) return;
        void send();
        rvfc.call(video, loop);
      };
      loop();
    } else {
      this.intervalHandle = window.setInterval(() => void send(), 33);
    }
  }

  private onWorkerMessage(msg: WorkerOut): void {
    if (msg.type === "error") {
      this.error = msg.message;
      this.busy = false;
      return;
    }
    if (msg.type !== "metrics") return;
    this.busy = false;

    const now = performance.now();
    this.frameTimes.push(now);
    while (this.frameTimes.length > 0 && this.frameTimes[0] < now - 1000) this.frameTimes.shift();

    if (!msg.found || !msg.metrics) {
      this.debug = {
        ...this.debug,
        fps: this.frameTimes.length,
        faceFound: false,
        openEye: null,
      };
      this.emit({
        t: now,
        faceFound: false,
        deviationDeg: 0,
        blink: false,
        distanceMm: null,
        openEye: null,
        qualityDeg: this.qualityDeg,
      });
      return;
    }

    const m = msg.metrics;
    const blinkLeft = Math.max(m.blinkLeft, msg.blendBlinkLeft ?? 0);
    const blinkRight = Math.max(m.blinkRight, msg.blendBlinkRight ?? 0);
    const leftClosed = blinkLeft > BLINK_THRESHOLD;
    const rightClosed = blinkRight > BLINK_THRESHOLD;

    // MediaPipe names eyes from the subject's point of view, so their right eye
    // is OD. Exactly one eye open is the state we want during a test.
    let openEye: Eye | null = null;
    if (!rightClosed && leftClosed) openEye = "OD";
    else if (rightClosed && !leftClosed) openEye = "OS";

    const raw = this.mapToField(m.features);
    const smoothed = this.smoother.filter(raw.xDeg, raw.yDeg, now);
    const deviationDeg = Math.hypot(smoothed.x, smoothed.y);

    const distanceMm = estimateDistanceMm(
      m.irisDiameterPx,
      msg.imageWidth,
      60,
      this.distanceCorrection,
    );

    if (this.calibrating && this.calibrationTarget && !leftClosed !== !rightClosed) {
      // Only collect calibration frames while a face is properly visible.
      this.calibrationSamples.push({
        features: m.features,
        targetXDeg: this.calibrationTarget.xDeg,
        targetYDeg: this.calibrationTarget.yDeg,
      });
    }

    this.debug = {
      ...this.debug,
      fps: this.frameTimes.length,
      faceFound: true,
      rawDistanceMm: distanceMm,
      gazeXDeg: smoothed.x,
      gazeYDeg: smoothed.y,
      deviationDeg,
      blinkLeft,
      blinkRight,
      openEye,
      calibrated: this.isCalibrated,
      qualityDeg: this.qualityDeg,
    };

    this.emit({
      t: now,
      faceFound: true,
      deviationDeg,
      // Both eyes shut means a blink; one eye shut is the covered eye.
      blink: leftClosed && rightClosed,
      distanceMm,
      openEye,
      qualityDeg: this.qualityDeg,
    });
  }

  private mapToField(features: number[]): { xDeg: number; yDeg: number } {
    if (this.weightsX && this.weightsY) {
      return {
        xDeg: predict(this.weightsX, features),
        yDeg: predict(this.weightsY, features),
      };
    }
    // Uncalibrated: average the two eyes' iris offsets with a rough gain.
    const oxR = features[1];
    const oyR = features[2];
    const oxL = features[3];
    const oyL = features[4];
    return {
      xDeg: (((oxR + oxL) / 2) * RAW_GAIN_X) / 2,
      yDeg: (-(oyR + oyL) / 2) * RAW_GAIN_Y * 0.5,
    };
  }

  private emit(sample: GazeSample): void {
    for (const cb of this.listeners) cb(sample);
  }

  /* -------------------- calibration -------------------- */

  beginCalibration(): void {
    this.calibrating = true;
    this.calibrationSamples = [];
    this.weightsX = null;
    this.weightsY = null;
    this.qualityDeg = UNCALIBRATED_QUALITY_DEG;
  }

  /** Collect frames while the user looks at a target, then move on. */
  captureCalibrationPoint(xDeg: number, yDeg: number, durationMs: number): Promise<number> {
    this.calibrationTarget = { xDeg, yDeg };
    const before = this.calibrationSamples.length;
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.calibrationTarget = null;
        resolve(this.calibrationSamples.length - before);
      }, durationMs);
    });
  }

  /**
   * Fit the model. Returns the residual in degrees, which the engine uses to
   * decide how much to trust gaze at all.
   */
  finishCalibration(): { ok: boolean; rmsDeg: number; samples: number } {
    this.calibrating = false;
    this.calibrationTarget = null;
    const samples = this.calibrationSamples;
    if (samples.length < FEATURE_COUNT * 4) {
      this.qualityDeg = UNCALIBRATED_QUALITY_DEG;
      return { ok: false, rmsDeg: UNCALIBRATED_QUALITY_DEG, samples: samples.length };
    }
    const X = samples.map((s) => s.features);
    const wx = ridgeFit(
      X,
      samples.map((s) => s.targetXDeg),
      1e-3,
    );
    const wy = ridgeFit(
      X,
      samples.map((s) => s.targetYDeg),
      1e-3,
    );
    const rms = Math.hypot(
      rmsError(
        X,
        samples.map((s) => s.targetXDeg),
        wx,
      ),
      rmsError(
        X,
        samples.map((s) => s.targetYDeg),
        wy,
      ),
    );
    // A fit worse than this is not worth having: keep the pessimistic default
    // rather than pretending we know where the eye is pointing.
    if (!Number.isFinite(rms) || rms > UNCALIBRATED_QUALITY_DEG) {
      this.weightsX = null;
      this.weightsY = null;
      this.qualityDeg = UNCALIBRATED_QUALITY_DEG;
      return { ok: false, rmsDeg: Number.isFinite(rms) ? rms : 99, samples: samples.length };
    }
    this.weightsX = wx;
    this.weightsY = wy;
    this.qualityDeg = Math.max(1.5, rms);
    this.smoother.reset();
    return { ok: true, rmsDeg: rms, samples: samples.length };
  }

  /** Scale the iris-based distance estimate to a distance the user measured. */
  calibrateDistance(actualMm: number): void {
    const raw = this.debug.rawDistanceMm;
    if (!raw || raw <= 0) return;
    this.distanceCorrection *= actualMm / raw;
  }

  stop(): void {
    this.stopped = true;
    if (this.intervalHandle !== null) window.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
    this.worker?.postMessage({ type: "close" });
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.status !== "unavailable") this.status = "idle";
  }
}
