/**
 * One-Euro filter: low latency when the signal moves fast, heavy smoothing
 * when it is nearly still. Webcam gaze estimates are jittery at rest, and a
 * plain low-pass either leaves that jitter in (false fixation losses) or adds
 * lag that makes a real saccade land too late to veto the trial it spoiled.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private minCutoff = 1.0,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = 0;
  }

  filter(x: number, tMs: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tMs;
      return x;
    }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;

    const dx = (x - this.xPrev) / dt;
    const dxHat = lowpass(dx, this.dxPrev, alpha(this.dCutoff, dt));
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const xHat = lowpass(x, this.xPrev, alpha(cutoff, dt));
    this.xPrev = xHat;
    return xHat;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function lowpass(x: number, prev: number, a: number): number {
  return a * x + (1 - a) * prev;
}

/** Two independent filters, for a 2D point. */
export class OneEuroPoint {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff = 1.0, beta = 0.02) {
    this.fx = new OneEuroFilter(minCutoff, beta);
    this.fy = new OneEuroFilter(minCutoff, beta);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, tMs: number): { x: number; y: number } {
    return { x: this.fx.filter(x, tMs), y: this.fy.filter(y, tMs) };
  }
}
