import type { EngineEvent } from "../core/types";
import type { SoundEvent } from "../services/audio";

export type LogLevel = "info" | "good" | "warn" | "bad" | "dim";

export interface LogLine {
  t: number;
  level: LogLevel;
  text: string;
}

/**
 * Turn an engine event into a line for the debug console, and say which sound
 * (if any) should accompany it. Only the events a supervisor actually needs to
 * notice make a noise.
 */
export function describeEvent(e: EngineEvent): { line: LogLine; sound?: SoundEvent } | null {
  const at = e.t;
  switch (e.type) {
    case "stimulusOn":
      return {
        line: {
          t: at,
          level: "dim",
          text: `STIM  #${e.index} (${fmt(e.xDeg)}°, ${fmt(e.yDeg)}°) ${e.levelDb?.toFixed(1)} dB`,
        },
      };
    case "press":
      if (e.class === "valid" || e.class === "practice") {
        return {
          line: { t: at, level: "good", text: `PRESS seen, RT ${Math.round(e.rtMs ?? 0)} ms` },
        };
      }
      if (e.class === "anticipatory") {
        return {
          line: {
            t: at,
            level: "bad",
            text: `FALSE TRIGGER anticipatory (+${Math.round(e.rtMs ?? 0)} ms, too fast)`,
          },
          sound: "falseTrigger",
        };
      }
      if (e.class === "spontaneous") {
        return {
          line: { t: at, level: "bad", text: "FALSE TRIGGER no stimulus shown" },
          sound: "falseTrigger",
        };
      }
      if (e.class === "fpCatchHit") {
        return {
          line: { t: at, level: "bad", text: "FALSE TRIGGER pressed on an empty catch trial" },
          sound: "falseTrigger",
        };
      }
      return {
        line: { t: at, level: "warn", text: "PRESS inside the blind spot" },
        sound: "gazeLost",
      };
    case "fixationLoss":
      return {
        line: {
          t: at,
          level: "warn",
          text:
            e.source === "gaze"
              ? `GAZE LOST deviation ${e.deviationDeg?.toFixed(1)}°`
              : "GAZE LOST blind-spot stimulus was seen",
        },
        sound: "gazeLost",
      };
    case "trialInvalidated":
      return {
        line: { t: at, level: "warn", text: `DISCARDED #${e.index} (${e.reason}) - will repeat` },
        sound: "trialInvalidated",
      };
    case "trialResolved":
      if (e.outcome === "invalidated") return null; // already logged above
      return {
        line: { t: at, level: "dim", text: `RESOLVED #${e.index} ${e.outcome}` },
      };
    case "blindSpotFound":
      return {
        line: {
          t: at,
          level: "good",
          text: `BLIND SPOT found at (${fmt(e.xDeg)}°, ${fmt(e.yDeg)}°)`,
        },
      };
    case "blindSpotNotFound":
      return {
        line: { t: at, level: "warn", text: "BLIND SPOT not found - fixation checks reduced" },
      };
    case "pause":
      return { line: { t: at, level: "warn", text: `PAUSED ${e.reason}` }, sound: "paused" };
    case "resume":
      return { line: { t: at, level: "info", text: "RESUMED" } };
    case "sessionStart":
      return { line: { t: at, level: "info", text: `START ${e.eye}` } };
    case "eyeComplete":
      return { line: { t: at, level: "good", text: `COMPLETE ${e.eye}` }, sound: "complete" };
    case "aborted":
      return { line: { t: at, level: "bad", text: "ABORTED" } };
    case "trialScheduled":
      return e.kind === "normal"
        ? null
        : { line: { t: at, level: "info", text: `CATCH  ${e.kind} #${e.index}` } };
    default:
      return null;
  }
}

function fmt(v: number): string {
  return v.toFixed(0);
}

export function formatLogLine(line: LogLine, startedAt: number): string {
  const secs = ((line.t - startedAt) / 1000).toFixed(2).padStart(7, " ");
  return `${secs}s  ${line.text}`;
}
