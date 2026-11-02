/**
 * Seeded randomness. Everything procedural in the game derives from these helpers so a bug
 * is reproducible from a seed. Chunk randomness uses `hash*` so streaming order never matters.
 */

/** Hash a string to a 32-bit unsigned int (FNV-1a + avalanche). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix(h);
}

/** 32-bit integer finalizer (murmur3 style). */
export function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Order-independent hash of integer coordinates + seed. */
export function hash3(seed: number, x: number, y: number, z = 0): number {
  let h = mix(seed ^ 0x9e3779b9);
  h = mix(h ^ Math.imul(x | 0, 0x27d4eb2d));
  h = mix(h ^ Math.imul(y | 0, 0x165667b1));
  h = mix(h ^ Math.imul(z | 0, 0x85ebca77));
  return h;
}

/** Derive a child seed from a parent seed and a label (e.g. "level:3" or "loot"). */
export function deriveSeed(parent: number, label: string): number {
  return mix(parent ^ hashString(label));
}

/** Turn user text (or number) into a seed. Pure numbers are used as-is. */
export function parseSeed(input: string | number): number {
  if (typeof input === 'number') return input >>> 0;
  const t = input.trim();
  if (/^\d{1,10}$/.test(t)) return Number(t) >>> 0;
  return hashString(t.toUpperCase());
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Human friendly run seed like "K7QD-93MX". Uses Math.random: only for *new* seeds. */
export function randomSeedString(): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (i === 3) s += '-';
  }
  return s;
}

/** sfc32 generator with convenience helpers. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = this.seed ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.u32();
  }

  /** Next unsigned 32-bit integer. */
  u32(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0,1). */
  next(): number { return this.u32() / 4294967296; }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  sign(): 1 | -1 { return this.next() < 0.5 ? -1 : 1; }
  /** Approximate normal (sum of 3 uniforms). */
  gauss(mean = 0, sd = 1): number { return mean + sd * ((this.next() + this.next() + this.next()) * 2 - 3); }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Weighted pick from [item, weight] pairs. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = this.next() * total;
    for (const [v, w] of items) { r -= w; if (r <= 0) return v; }
    return items[items.length - 1][0];
  }

  /** Independent child generator, so adding draws in one subsystem never shifts another. */
  fork(label: string): Rng { return new Rng(deriveSeed(this.seed, label)); }
}

/** Convenience: RNG for a spatial cell, independent of generation order. */
export function cellRng(seed: number, x: number, y: number, z = 0): Rng {
  return new Rng(hash3(seed, x, y, z));
}
