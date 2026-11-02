/**
 * Procedural PBR texture synthesis (spec 6.2). Pure CPU code: returns raw RGBA byte buffers for
 * albedo, tangent-space normal and an "ORM" map (R = ambient occlusion, G = roughness, B = metalness)
 * so it can run in a Web Worker and in Node tests. All textures tile seamlessly.
 */
import { Rng } from './rng';

export type TexKind = 'wallpaper' | 'carpet' | 'concrete' | 'tile' | 'metal' | 'ceiling' | 'stain';
export interface TexSet { size: number; albedo: Uint8ClampedArray; normal: Uint8ClampedArray; orm: Uint8ClampedArray }

const LATTICE = 256;

/** Tileable value-noise source: a 256x256 lattice sampled with wrapping at a given period. */
class Noise {
  private t = new Float32Array(LATTICE * LATTICE);
  constructor(seed: number) { const r = new Rng(seed); for (let i = 0; i < this.t.length; i++) this.t[i] = r.next(); }
  /** u,v in [0,1) tile space; `period` lattice cells across (power of two <= 256). */
  at(u: number, v: number, period: number): number {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const m = period - 1;
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = iy & m, y1 = (iy + 1) & m;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const t = this.t;
    const a = t[y0 * LATTICE + x0], b = t[y0 * LATTICE + x1], c = t[y1 * LATTICE + x0], d = t[y1 * LATTICE + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(u: number, v: number, period: number, octaves: number): number {
    let sum = 0, amp = 0.5, tot = 0, p = period;
    for (let o = 0; o < octaves; o++) { sum += this.at(u, v, p) * amp; tot += amp; amp *= 0.5; p = Math.min(LATTICE, p * 2); }
    return sum / tot;
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixc = (a: number, b: number, t: number) => a + (b - a) * t;

/** Surface sample written by recipes. Reused object: no per-pixel allocation. */
interface Px { r: number; g: number; b: number; a: number; h: number; rough: number; metal: number; ao: number }

type Recipe = (u: number, v: number, n: Noise, n2: Noise, variant: number, o: Px) => void;

const WALLPAPERS: [number, number, number][] = [[0.78, 0.68, 0.36], [0.68, 0.72, 0.5], [0.74, 0.55, 0.4], [0.6, 0.62, 0.7]];

const RECIPES: Record<TexKind, Recipe> = {
  wallpaper(u, v, n, n2, variant, o) {
    const base = WALLPAPERS[variant % WALLPAPERS.length];
    const stripe = Math.sin(u * Math.PI * 2 * 8);
    const band = smooth(-0.15, 0.15, stripe);
    // repeating diamond motif inside the pale stripes
    const fu = (u * 8) % 1, fv = (v * 4) % 1;
    const dia = smooth(0.05, 0, Math.abs(Math.abs(fu - 0.5) + Math.abs(fv - 0.5) - 0.28));
    const stain = smooth(0.55, 0.85, n.fbm(u, v, 4, 5)) * 0.5;
    const grime = smooth(0.0, 0.35, 1 - v) * 0.0 + n2.fbm(u, v, 32, 3) * 0.08;
    const k = 0.78 + band * 0.22 - dia * 0.14 - stain * 0.35 - grime;
    o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k * (1 - stain * 0.2);
    o.h = 0.5 + band * 0.04 + dia * 0.03 + n2.at(u, v, 128) * 0.02;
    o.rough = 0.82 - dia * 0.1; o.metal = 0; o.ao = 1 - stain * 0.25;
  },
  carpet(u, v, n, n2, variant, o) {
    const fibre = n2.at(u, v, 256) * 0.6 + n2.at(u, v, 128) * 0.4;
    const patches = n.fbm(u, v, 4, 5);
    const damp = smooth(0.52, 0.72, patches);
    const k = (0.68 + fibre * 0.5) * (1 - damp * 0.38);
    const base = variant === 1 ? [0.35, 0.4, 0.34] : [0.62, 0.55, 0.26];
    o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k;
    o.h = fibre; o.rough = mixc(0.95, 0.5, damp); o.metal = 0; o.ao = 0.7 + fibre * 0.3;
  },
  concrete(u, v, n, n2, variant, o) {
    const big = n.fbm(u, v, 4, 6);
    const pits = smooth(0.78, 0.9, n2.fbm(u, v, 64, 3));
    const crack = smooth(0.012, 0, Math.abs(n.fbm(u, v, 8, 4) - 0.5)) * smooth(0.45, 0.6, n2.at(u, v, 4));
    const k = 0.5 + big * 0.35 - pits * 0.25 - crack * 0.35 + (variant === 1 ? -0.15 : 0);
    o.r = k * 0.95; o.g = k * 0.95; o.b = k;
    o.h = 0.55 + big * 0.2 - pits * 0.25 - crack * 0.3;
    o.rough = 0.88 - pits * 0.1; o.metal = 0; o.ao = 1 - pits * 0.4 - crack * 0.4;
  },
  tile(u, v, n, _n2, variant, o) {
    const N = 8;
    const gu = (u * N) % 1, gv = (v * N) % 1;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    const grout = 1 - smooth(0.012, 0.03, edge);
    const id = Math.floor(u * N) + Math.floor(v * N) * N;
    const tileVar = ((Math.imul(id, 2654435761) >>> 8) & 255) / 255;
    const aqua = variant === 1;
    const dirt = n.fbm(u, v, 8, 5);
    const base = aqua ? [0.5, 0.8, 0.82] : [0.82, 0.8, 0.74];
    const k = 0.86 + tileVar * 0.12 - dirt * 0.18;
    const gk = 0.45 + dirt * 0.1;
    o.r = mixc(base[0] * k, gk, grout); o.g = mixc(base[1] * k, gk, grout); o.b = mixc(base[2] * k, gk * 0.95, grout);
    o.h = mixc(0.7, 0.2, grout); o.rough = mixc(0.18 + dirt * 0.25, 0.9, grout); o.metal = 0; o.ao = mixc(1, 0.55, grout);
  },
  metal(u, v, n, n2, _variant, o) {
    const streak = n2.fbm(u * 0.1, v, 4, 4); // stretched in u for brushed look
    const rust = smooth(0.5, 0.72, n.fbm(u, v, 8, 5));
    const base = 0.55 + streak * 0.2;
    o.r = mixc(base * 0.8, 0.45, rust); o.g = mixc(base * 0.82, 0.22, rust); o.b = mixc(base * 0.88, 0.09, rust);
    o.h = 0.5 + streak * 0.05 + rust * 0.12;
    o.rough = mixc(0.35 + streak * 0.2, 0.85, rust); o.metal = mixc(0.9, 0.1, rust); o.ao = 1 - rust * 0.3;
  },
  ceiling(u, v, n, n2, _variant, o) {
    const gu = (u * 2) % 1, gv = (v * 2) % 1;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    const frame = 1 - smooth(0.01, 0.03, edge);
    // perforation dots
    const du = (u * 32) % 1 - 0.5, dv = (v * 32) % 1 - 0.5;
    const dot = smooth(0.17, 0.12, Math.hypot(du, dv)) * (1 - frame);
    const stain = smooth(0.6, 0.85, n.fbm(u, v, 4, 5));
    const k = 0.86 - stain * 0.3 - dot * 0.2 - frame * 0.15 + n2.at(u, v, 128) * 0.04;
    o.r = k; o.g = k * 0.98; o.b = k * (0.92 - stain * 0.1);
    o.h = 0.6 - dot * 0.3 - frame * 0.3; o.rough = 0.9; o.metal = 0; o.ao = 1 - dot * 0.3 - frame * 0.5;
  },
  /** Alpha stain used for decals: soft blotchy brown-grey shape with alpha falloff. */
  stain(u, v, n, _n2, _variant, o) {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const shape = smooth(1, 0.35, d + (n.fbm(u, v, 8, 5) - 0.5) * 0.9);
    const ring = smooth(0.0, 0.2, shape) * (1 - smooth(0.5, 1, shape) * 0.5);
    o.r = 0.18; o.g = 0.13; o.b = 0.07; o.a = ring * 0.65;
    o.h = 0.5; o.rough = 0.4; o.metal = 0; o.ao = 1;
  },
};

/** Generate a full PBR set. `size` must be a power of two (32..2048). Deterministic in (kind, seed, variant). */
export function synthTexture(kind: TexKind, seed: number, size: number, variant = 0): TexSet {
  const rng = new Rng(seed ^ (variant * 7919) ^ kind.length * 131);
  const n = new Noise(rng.u32());
  const n2 = new Noise(rng.u32());
  const recipe = RECIPES[kind];
  const albedo = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const px: Px = { r: 0, g: 0, b: 0, a: 1, h: 0.5, rough: 0.8, metal: 0, ao: 1 };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      px.a = 1;
      recipe(x / size, v, n, n2, variant, px);
      const i = y * size + x, j = i * 4;
      albedo[j] = clamp01(px.r) * 255; albedo[j + 1] = clamp01(px.g) * 255; albedo[j + 2] = clamp01(px.b) * 255; albedo[j + 3] = clamp01(px.a) * 255;
      orm[j] = clamp01(px.ao) * 255; orm[j + 1] = clamp01(px.rough) * 255; orm[j + 2] = clamp01(px.metal) * 255; orm[j + 3] = 255;
      height[i] = px.h;
    }
  }
  return { size, albedo, orm, normal: heightToNormal(height, size, kind === 'carpet' ? 3 : 4) };
}

/** Sobel height -> tangent-space normal (wrapping edges so the tile stays seamless). */
export function heightToNormal(h: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const m = size - 1;
  const s = strength * (size / 256);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1) & m, xr = (x + 1) & m, yu = (y - 1) & m, yd = (y + 1) & m;
    const dx = (h[y * size + xr] - h[y * size + xl]) * s;
    const dy = (h[yd * size + x] - h[yu * size + x]) * s;
    const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const j = (y * size + x) * 4;
    out[j] = (-dx * il * 0.5 + 0.5) * 255; out[j + 1] = (-dy * il * 0.5 + 0.5) * 255; out[j + 2] = (il * 0.5 + 0.5) * 255; out[j + 3] = 255;
  }
  return out;
}
