/**
 * Seeded RNG (mulberry32). Every random decision in a run flows through one
 * instance so that storing the seed makes the run exactly reproducible.
 */
export class Rng {
  private state: number;

  constructor(public readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(pTrue: number): boolean {
    return this.next() < pTrue;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick() from empty array");
    return items[this.int(0, items.length - 1)];
  }

  /** In-place Fisher-Yates. Returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
