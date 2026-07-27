import { AudioService } from "./audio";
import { GazeService } from "./gaze/gazeService";

/**
 * Long-lived singletons. These own a camera stream, a worker and an audio
 * context, so they deliberately live outside React state: re-creating them on
 * a render would restart the camera mid-test.
 */
export const gaze = new GazeService();
export const audio = new AudioService();
