/**
 * Short synthesised cues. Nothing is loaded from disk so timing is exact.
 *
 * Note that in a normal run the app is almost silent: audible feedback tied to
 * stimuli would coach the user ("that beep means there WAS a light there") and
 * corrupt the very thing we are measuring. The event cues below are for DEBUG
 * mode, where a supervisor wants to hear what the engine is detecting.
 */
export type SoundEvent =
  | "falseTrigger"
  | "gazeLost"
  | "trialInvalidated"
  | "eyeMismatch"
  | "distanceDrift"
  | "responseClick"
  | "paused"
  | "complete";

interface Tone {
  freq: number;
  durationMs: number;
  /** Number of repeats and the gap between them. */
  repeats?: number;
  gapMs?: number;
  type?: OscillatorType;
  gain?: number;
}

const TONES: Record<SoundEvent, Tone> = {
  falseTrigger: { freq: 220, durationMs: 120, type: "square", gain: 0.12 },
  gazeLost: { freq: 880, durationMs: 70, repeats: 2, gapMs: 90, gain: 0.1 },
  trialInvalidated: { freq: 1400, durationMs: 25, gain: 0.05 },
  eyeMismatch: { freq: 660, durationMs: 90, repeats: 3, gapMs: 110, gain: 0.12 },
  distanceDrift: { freq: 480, durationMs: 140, type: "triangle", gain: 0.1 },
  responseClick: { freq: 1800, durationMs: 15, gain: 0.04 },
  paused: { freq: 330, durationMs: 180, type: "sine", gain: 0.1 },
  complete: { freq: 587, durationMs: 220, repeats: 2, gapMs: 240, type: "sine", gain: 0.12 },
};

export class AudioService {
  private ctx: AudioContext | null = null;
  private muted = new Set<SoundEvent>();
  enabled = true;

  /** Must be called from a user gesture, or browsers refuse to start audio. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  setMuted(event: SoundEvent, muted: boolean): void {
    if (muted) this.muted.add(event);
    else this.muted.delete(event);
  }

  isMuted(event: SoundEvent): boolean {
    return this.muted.has(event);
  }

  play(event: SoundEvent): void {
    if (!this.enabled || this.muted.has(event) || !this.ctx) return;
    const tone = TONES[event];
    const repeats = tone.repeats ?? 1;
    const gap = tone.gapMs ?? 0;
    for (let i = 0; i < repeats; i++) {
      this.blip(tone, this.ctx.currentTime + (i * (tone.durationMs + gap)) / 1000);
    }
  }

  private blip(tone: Tone, at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    const peak = tone.gain ?? 0.1;
    const dur = tone.durationMs / 1000;
    // Ramp in and out so short blips do not click.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  close(): void {
    this.ctx?.close();
    this.ctx = null;
  }
}

export const SOUND_EVENTS = Object.keys(TONES) as SoundEvent[];
