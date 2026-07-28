/// <reference lib="webworker" />
/**
 * Face landmark inference, off the main thread.
 *
 * This runs in a worker on purpose: the test's whole value depends on stimuli
 * appearing for exactly 200 ms, and a 20-30 ms inference pass on the main
 * thread would drop animation frames right when a stimulus is on screen.
 *
 * Frames come in as ImageBitmaps and only derived numbers go back out. No
 * video ever leaves the device - the model file is downloaded once, and the
 * pixels stay in this worker.
 */
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { extractMetrics, type FaceMetrics, type Landmark } from "./features";

export interface WorkerInit {
  type: "init";
  wasmBase: string;
  modelUrl: string;
}

export interface WorkerFrame {
  type: "frame";
  bitmap: ImageBitmap;
  timestamp: number;
}

export type WorkerIn = WorkerInit | WorkerFrame | { type: "close" };

export interface WorkerMetrics {
  type: "metrics";
  timestamp: number;
  found: boolean;
  metrics: FaceMetrics | null;
  /** Blendshape blink scores when the model provides them, else null. */
  blendBlinkLeft: number | null;
  blendBlinkRight: number | null;
  imageWidth: number;
  imageHeight: number;
}

export type WorkerOut =
  | { type: "ready"; delegate: string }
  | { type: "error"; message: string }
  | WorkerMetrics;

let landmarker: FaceLandmarker | null = null;
let lastTimestamp = -1;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function init(msg: WorkerInit): Promise<void> {
  const fileset = await FilesetResolver.forVisionTasks(msg.wasmBase);
  const options = {
    baseOptions: { modelAssetPath: msg.modelUrl, delegate: "GPU" as const },
    runningMode: "VIDEO" as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  };
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    ctx.postMessage({ type: "ready", delegate: "GPU" } satisfies WorkerOut);
  } catch {
    // Plenty of machines have no usable GPU delegate in a worker context.
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
    ctx.postMessage({ type: "ready", delegate: "CPU" } satisfies WorkerOut);
  }
}

function handleFrame(msg: WorkerFrame): void {
  const bitmap = msg.bitmap;
  try {
    if (!landmarker) return;
    // MediaPipe requires strictly increasing timestamps in video mode.
    const ts = msg.timestamp <= lastTimestamp ? lastTimestamp + 1 : msg.timestamp;
    lastTimestamp = ts;

    const res = landmarker.detectForVideo(bitmap, ts);
    const lms = res.faceLandmarks?.[0] as Landmark[] | undefined;
    const metrics = lms ? extractMetrics(lms, bitmap.width, bitmap.height) : null;

    let blendBlinkLeft: number | null = null;
    let blendBlinkRight: number | null = null;
    const categories = res.faceBlendshapes?.[0]?.categories;
    if (categories) {
      for (const c of categories) {
        if (c.categoryName === "eyeBlinkLeft") blendBlinkLeft = c.score;
        else if (c.categoryName === "eyeBlinkRight") blendBlinkRight = c.score;
      }
    }

    ctx.postMessage({
      type: "metrics",
      timestamp: msg.timestamp,
      found: metrics !== null,
      metrics,
      blendBlinkLeft,
      blendBlinkRight,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
    } satisfies WorkerOut);
  } catch (err) {
    ctx.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOut);
  } finally {
    bitmap.close();
  }
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === "init") {
    init(msg).catch((err) =>
      ctx.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOut),
    );
  } else if (msg.type === "frame") {
    handleFrame(msg);
  } else if (msg.type === "close") {
    landmarker?.close();
    landmarker = null;
  }
};
