import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { translator, type Translate } from "../i18n";
import type { GazeSample } from "../core/types";
import { gaze } from "../services/instances";
import { useApp } from "../state/store";

export function useT(): Translate {
  const locale = useApp((s) => s.locale);
  return useMemo(() => translator(locale), [locale]);
}

/** Latest gaze debug snapshot, polled at a rate that will not thrash React. */
export function useGazeDebug(intervalMs = 200) {
  const [info, setInfo] = useState(() => gaze.getDebug());
  useEffect(() => {
    const id = window.setInterval(() => setInfo(gaze.getDebug()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return info;
}

/** Subscribe to raw gaze samples without re-rendering on every frame. */
export function useGazeSamples(handler: (s: GazeSample) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => gaze.onSample((s) => ref.current(s)), []);
}

export function useFullscreen() {
  const [isFullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // These must keep a stable identity: callers put them in effect dependency
  // arrays, and a fresh function every render restarts whatever the effect
  // was doing.
  const request = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      return true;
    } catch {
      return false;
    }
  }, []);
  const exit = useCallback(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  }, []);
  return { isFullscreen, request, exit };
}

/** Keeps the screen awake during a test where the user barely touches the keyboard. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
    };
    nav.wakeLock
      ?.request("screen")
      .then((s) => {
        if (cancelled) void s.release();
        else sentinel = s;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
