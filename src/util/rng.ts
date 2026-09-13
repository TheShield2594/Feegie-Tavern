/** Deterministic PRNG so world generation is reproducible across sessions. */
export class Rng {
  private state: number;

  constructor(seed = 1) {
    // Avoid a zero state, which would lock mulberry32 at 0.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** mulberry32 — fast, good enough distribution for content scattering. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length)];
  }

  /** Signed value in [-amount, amount]. */
  spread(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Value noise with smooth interpolation — good for gentle terrain undulation. */
export function valueNoise2D(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const h = (ix: number, iy: number) => {
    const s = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
    return s - Math.floor(s);
  };

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Layered value noise. Returns roughly [0,1]. */
export function fbm2D(x: number, y: number, octaves = 4, seed = 0): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * frequency, y * frequency, seed + i * 13.37) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}
