/**
 * Response key handling. The spacebar is the patient's button; every press is
 * timestamped from the same clock the engine runs on so reaction times are
 * comparable with the stimulus onsets.
 */
export type PressHandler = (tMs: number) => void;

export interface InputOptions {
  onPress: PressHandler;
  onPause?: () => void;
  onAbort?: () => void;
  onToggleDebug?: () => void;
}

export class InputService {
  private handler = (e: KeyboardEvent) => this.onKeyDown(e);
  private attached = false;

  constructor(private opts: InputOptions) {}

  attach(): void {
    if (this.attached) return;
    window.addEventListener("keydown", this.handler, { passive: false });
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener("keydown", this.handler);
    this.attached = false;
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Holding the key down must not machine-gun responses.
    if (e.repeat) return;

    if (e.code === "Space") {
      e.preventDefault(); // stop the page scrolling under the test
      this.opts.onPress(performance.now());
      return;
    }
    if (e.code === "KeyP") {
      this.opts.onPause?.();
      return;
    }
    if (e.code === "Escape") {
      this.opts.onAbort?.();
      return;
    }
    if (e.code === "KeyD" && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      this.opts.onToggleDebug?.();
    }
  }
}
