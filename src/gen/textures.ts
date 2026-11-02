/**
 * Procedural PBR texture synthesis (spec 6.2). Pure CPU code: returns raw RGBA byte buffers for
 * albedo, tangent-space normal and an "ORM" map (R = ambient occlusion, G = roughness, B = metalness)
 * so it can run in a Web Worker and in Node tests. Every texture tiles seamlessly (all noise is periodic).
 *
 * Toolbox: value-noise fBm, ridged noise (cracks, fissures), cellular/Worley noise (aggregate, carpet
 * loops, pores), domain warping (organic water stains with tide lines), and a cavity-AO pass computed
 * from the height field. One texture tile covers 2 m x 2 m of world space.
 */
import { Rng } from './rng';

export type TexKind = 'wallpaper' | 'carpet' | 'concrete' | 'tile' | 'metal' | 'ceiling' | 'stain' | 'louver' | 'macro';
export interface TexSet { size: number; albedo: Uint8ClampedArray; normal: Uint8ClampedArray; orm: Uint8ClampedArray }

const LATTICE = 256;

/** Tileable noise source built on a 256x256 random lattice. */
class Noise {
  private t = new Float32Array(LATTICE * LATTICE);
  constructor(seed: number) { const r = new Rng(seed); for (let i = 0; i < this.t.length; i++) this.t[i] = r.next(); }
  lat(x: number, y: number): number { return this.t[(y & 255) * LATTICE + (x & 255)]; }
  /** Smooth value noise in [0,1); u,v in tile space [0,1); `period` = cells across (power of two <= 256). */
  at(u: number, v: number, period: number): number {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const m = period - 1;
    const x0 = ix & m, x1 = (ix + 1) & m, y0 = iy & m, y1 = (iy + 1) & m;
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10); // quintic: no grid artefacts
    const a = this.lat(x0, y0), b = this.lat(x1, y0), c = this.lat(x0, y1), d = this.lat(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(u: number, v: number, period: number, octaves: number, gain = 0.5): number {
    let sum = 0, amp = 0.5, tot = 0, p = period;
    for (let o = 0; o < octaves; o++) { sum += this.at(u, v, p) * amp; tot += amp; amp *= gain; p = Math.min(LATTICE, p * 2); }
    return sum / tot;
  }
  /** Ridged fBm: thin bright ridges where the noise crosses 0.5 (cracks, fissures, veins). */
  ridged(u: number, v: number, period: number, octaves: number): number {
    let sum = 0, amp = 0.5, tot = 0, p = period;
    for (let o = 0; o < octaves; o++) { const n = 1 - Math.abs(this.at(u, v, p) * 2 - 1); sum += n * n * amp; tot += amp; amp *= 0.5; p = Math.min(LATTICE, p * 2); }
    return sum / tot;
  }
  /** Worley/cellular noise: F1 distance (0..~1) and a per-cell random id. Writes into `out`. */
  cell(u: number, v: number, period: number, out: { f1: number; f2: number; id: number }): void {
    const x = u * period, y = v * period;
    const ix = Math.floor(x), iy = Math.floor(y);
    let f1 = 9, f2 = 9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const wx = ((cx % period) + period) % period, wy = ((cy % period) + period) % period;
      const px = cx + this.lat(wx * 7 + 3, wy * 13 + 5), py = cy + this.lat(wx * 11 + 17, wy * 5 + 29);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; id = this.lat(wx + 101, wy + 37); } else if (d < f2) f2 = d;
    }
    out.f1 = f1; out.f2 = f2; out.id = id;
  }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash1 = (n: number) => { n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; };

/** Surface sample written by recipes. Reused object: no per-pixel allocation. */
interface Px { r: number; g: number; b: number; a: number; h: number; rough: number; metal: number; ao: number; emit: number }
interface Ctx { n: Noise; n2: Noise; c: { f1: number; f2: number; id: number }; c2: { f1: number; f2: number; id: number } }
type Recipe = (u: number, v: number, x: Ctx, variant: number, o: Px) => void;

/** A domain-warped water stain: returns [inside 0..1, tide-line 0..1]. */
function stainAt(x: Ctx, u: number, v: number, period: number, threshold: number): [number, number] {
  const wu = u + (x.n.fbm(u, v, period, 3) - 0.5) * 0.25, wv = v + (x.n.fbm(u + 0.37, v + 0.71, period, 3) - 0.5) * 0.25;
  const s = x.n2.fbm(wu, wv, period, 5);
  // interior fades in from the tide line (water wicks outward and dries leaving a ring)
  const inside = smooth(threshold, threshold + 0.03, s) * (0.45 + 0.55 * smooth(threshold + 0.1, threshold + 0.01, s));
  const tide = smooth(0.016, 0, Math.abs(s - threshold - 0.008)) * (0.5 + 0.5 * x.n.at(u, v, 64));
  return [inside, tide];
}

const WALLPAPERS: [number, number, number][] = [[0.80, 0.71, 0.40], [0.66, 0.70, 0.48], [0.76, 0.56, 0.42], [0.60, 0.63, 0.68]];

const RECIPES: Record<TexKind, Recipe> = {
  /** Mono-yellow office wallpaper: 4 paper strips per tile, seams, faint printed motif, fibres, tide-line water stains, peeling. */
  wallpaper(u, v, x, variant, o) {
    const base = WALLPAPERS[variant % WALLPAPERS.length];
    const strip = Math.floor(u * 4), fu = (u * 4) % 1;
    const seam = smooth(0.012, 0, Math.min(fu, 1 - fu));
    // printed pattern: thin double pinstripes + a small offset diamond motif (very low contrast, like the real thing)
    const su = (u * 32) % 1;
    const pin = smooth(0.06, 0.02, Math.abs(su - 0.5)) * 0.6 + smooth(0.04, 0.0, Math.abs(su - 0.18)) * 0.3;
    const mu = (u * 16 + (Math.floor(v * 24) % 2) * 0.5) % 1, mv = (v * 24) % 1;
    const motif = smooth(0.06, 0.02, Math.abs(Math.abs(mu - 0.5) * 1.2 + Math.abs(mv - 0.5) - 0.22));
    const fibre = x.n2.at(u, v, 256) * 0.5 + x.n2.at(u * 0.25, v, 256) * 0.5; // slightly vertical paper grain
    const blotch = x.n.fbm(u, v, 4, 4);
    const [stain, tide] = stainAt(x, u, v, 8, 0.71);
    // occasional peel at a seam: the paper lifts and shows the pale backing
    const peelOn = hash1(strip * 31 + variant) > 0.8;
    const peel = peelOn ? smooth(0.06, 0.0, fu) * smooth(0.55, 0.62, x.n.fbm(u * 0.5, v, 8, 3)) : 0;
    let k = 0.86 + (fibre - 0.5) * 0.06 + (blotch - 0.5) * 0.12 - pin * 0.07 - motif * 0.1 - seam * 0.12;
    k *= 1 - stain * 0.16 - tide * 0.32;
    const yel = stain * 0.08 + tide * 0.12; // stains yellow-brown the paper
    o.r = base[0] * k * (1 + yel * 0.2); o.g = base[1] * k * (1 - yel * 0.15); o.b = base[2] * k * (1 - yel * 0.8);
    if (peel > 0) { const pk = peel * 0.55; o.r = mix(o.r, base[0] * 1.08, pk); o.g = mix(o.g, base[1] * 1.06, pk); o.b = mix(o.b, base[2] * 1.12, pk); }
    o.h = 0.5 + fibre * 0.05 + motif * 0.02 + pin * 0.01 - seam * 0.12 + peel * 0.25 + tide * 0.02;
    o.rough = 0.82 + fibre * 0.08 - motif * 0.05 - stain * 0.06; o.metal = 0; o.ao = 1;
  },
  /** Damp looped-pile office carpet: Worley tufts, fibre noise, nap shading, wet patches with tide lines, wear. */
  carpet(u, v, x, variant, o) {
    x.n.cell(u, v, 128, x.c);
    const tuft = 1 - smooth(0.0, 0.75, x.c.f1);            // loop tops
    const fibre = x.n2.at(u, v, 256);
    const nap = x.n.fbm(u, v, 8, 3);                         // light/dark nap direction patches
    const [damp, tide] = stainAt(x, u + 0.13, v + 0.29, 8, 0.7);
    const wear = smooth(0.55, 0.8, x.n2.fbm(u * 0.5 + 0.2, v, 4, 3)) * 0.5;
    const base = variant === 1 ? [0.33, 0.37, 0.31] : [0.60, 0.52, 0.24];
    let k = 0.7 + tuft * 0.2 + (fibre - 0.5) * 0.1 + (nap - 0.5) * 0.14 + (x.c.id - 0.5) * 0.05;
    k *= 1 - damp * 0.3 - tide * 0.25 - wear * 0.12;
    o.r = base[0] * k; o.g = base[1] * k; o.b = base[2] * k * (1 - damp * 0.15);
    o.h = tuft * 0.7 + fibre * 0.3 - damp * 0.1;
    o.rough = mix(0.97 - tuft * 0.05, 0.42, damp); // wet carpet glints under light
    o.metal = 0; o.ao = 0.85 + tuft * 0.15;
  },
  /** Poured concrete: mottling, Worley aggregate, pores, warped cracks, efflorescence stains, form-tie holes. */
  concrete(u, v, x, variant, o) {
    const big = x.n.fbm(u, v, 4, 6);
    x.n.cell(u, v, 48, x.c);
    const agg = smooth(0.35, 0.05, x.c.f1) * (x.c.id - 0.5);          // pebbles peeking through
    x.n2.cell(u, v, 128, x.c2);
    const pore = smooth(0.14, 0.05, x.c2.f1) * (x.c2.id > 0.72 ? 1 : 0);
    const wu = u + (x.n.at(u, v, 8) - 0.5) * 0.08;
    const crack = smooth(0.965, 0.995, x.n2.ridged(wu, v, 8, 4)) * smooth(0.45, 0.65, x.n.at(u, v, 4));
    const [stain, tide] = stainAt(x, u, v, 8, 0.71);
    const ef = smooth(0.62, 0.8, x.n2.fbm(u, v * 0.5, 8, 4)) * 0.4;     // pale efflorescence streaks
    const tu = (u * 3) % 1, tv = (v * 3) % 1;
    const tie = variant === 0 ? smooth(0.045, 0.03, Math.hypot(tu - 0.5, tv - 0.5)) : 0;
    let k = (variant === 1 ? 0.36 : 0.56) + (big - 0.5) * 0.28 + agg * 0.16 + (x.n2.at(u, v, 256) - 0.5) * 0.06;
    k *= 1 - pore * 0.5 - crack * 0.55 - stain * 0.18 - tide * 0.25 - tie * 0.6;
    k += ef * 0.18;
    o.r = k * 0.97; o.g = k * 0.96; o.b = k;
    o.h = 0.55 + (big - 0.5) * 0.25 + agg * 0.2 - pore * 0.35 - crack * 0.4 - tie * 0.5;
    o.rough = 0.9 - stain * 0.12 + pore * 0.05; o.metal = 0; o.ao = 1;
  },
  /** Glazed ceramic tile: bevelled edges, per-tile tint, glaze roughness variation, crazing, dirty grout, chipped corners. */
  tile(u, v, x, variant, o) {
    const N = variant === 1 ? 16 : 8;
    const tu = u * N, tv = v * N, ix = Math.floor(tu), iy = Math.floor(tv), gu = tu - ix, gv = tv - iy;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    const grout = 1 - smooth(0.018, 0.04, edge);
    const bevel = smooth(0.02, 0.1, edge);
    const id = hash1(ix * 73 + iy * 191 + variant * 7);
    const dirt = x.n.fbm(u, v, 8, 5);
    const craze = variant === 0 ? smooth(0.97, 0.995, x.n2.ridged(u, v, 32, 3)) * 0.5 : 0;
    const corner = Math.min(Math.hypot(gu, gv), Math.hypot(1 - gu, gv), Math.hypot(gu, 1 - gv), Math.hypot(1 - gu, 1 - gv));
    const chip = hash1(ix * 17 + iy * 5) > 0.86 ? smooth(0.1, 0.06, corner) : 0;
    const base = variant === 1 ? [0.42, 0.78, 0.80] : [0.86, 0.85, 0.80];
    const k = 0.9 + (id - 0.5) * 0.12 - dirt * 0.12 * (1 - bevel * 0.5) - craze * 0.1;
    const gk = 0.38 + dirt * 0.14;
    o.r = mix(base[0] * k, gk * 0.95, grout); o.g = mix(base[1] * k, gk * 0.92, grout); o.b = mix(base[2] * k, gk * 0.85, grout);
    if (chip > 0) { o.r = mix(o.r, 0.7, chip); o.g = mix(o.g, 0.66, chip); o.b = mix(o.b, 0.6, chip); }
    o.h = mix(0.25, 0.75, bevel) - grout * 0.15 + (x.n2.at(u, v, 64) - 0.5) * 0.02 - chip * 0.3;
    o.rough = mix(0.06 + dirt * 0.18 + (x.n2.at(u, v, 128) - 0.5) * 0.06 + craze * 0.2, 0.92, Math.max(grout, chip));
    o.metal = 0; o.ao = mix(1, 0.45, grout);
  },
  /** Steel: brushed grain, random scratches, rust bloom with pitting (rust is rough and non-metallic). */
  metal(u, v, x, _variant, o) {
    const grain = x.n2.at(u * 0.03, v, 256) * 0.6 + x.n2.at(u * 0.1, v, 128) * 0.4; // stretched along u
    // scratches: one random segment per cell
    const C = 16, cu = u * C, cv = v * C, ci = Math.floor(cu), cj = Math.floor(cv);
    let scratch = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const a = ci + i, b = cj + j, wa = ((a % C) + C) % C, wb = ((b % C) + C) % C;
      const h = hash1(wa * 131 + wb * 7);
      if (h > 0.55) continue;
      const ang = h * 40, len = 0.6 + hash1(wa + wb * 3) * 1.4;
      const px = a + hash1(wa * 3 + wb), py = b + hash1(wa + wb * 9);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const qx = cu - px, qy = cv - py, t = Math.max(-len, Math.min(len, qx * dx + qy * dy));
      scratch = Math.max(scratch, smooth(0.035, 0.0, Math.hypot(qx - t * dx, qy - t * dy)));
    }
    const wu = u + (x.n.at(u, v, 8) - 0.5) * 0.1;
    const rust = smooth(0.6, 0.74, x.n.fbm(wu, v, 8, 5));
    x.n.cell(u, v, 96, x.c);
    const pit = rust * smooth(0.18, 0.05, x.c.f1);
    const streak = smooth(0.6, 0.85, x.n2.fbm(u * 2, v * 0.25, 8, 3)) * 0.4;
    const steel = 0.52 + grain * 0.18 + scratch * 0.07;
    const rustK = 0.5 + x.n2.at(u, v, 128) * 0.5;
    o.r = mix(steel * 0.95, 0.42 * rustK, rust); o.g = mix(steel * 0.96, 0.22 * rustK, rust); o.b = mix(steel, 0.10 * rustK, rust);
    o.r = mix(o.r, 0.34, streak * (1 - rust)); o.g = mix(o.g, 0.22, streak * (1 - rust)); o.b = mix(o.b, 0.14, streak * (1 - rust));
    o.h = 0.5 + grain * 0.04 - scratch * 0.08 + rust * 0.15 - pit * 0.3;
    o.rough = mix(0.32 + grain * 0.15 - scratch * 0.12, 0.9, rust); o.metal = mix(0.95, 0.05, Math.max(rust, streak * 0.6)); o.ao = 1;
  },
  /** Mineral-fibre acoustic ceiling tiles (3x3 per tile = 0.67 m, aligned to the T-bar grid): fissures, pinholes, sag, water stains. */
  ceiling(u, v, x, _variant, o) {
    const tu = u * 3, tv = v * 3, ix = Math.floor(tu), iy = Math.floor(tv), gu = tu - ix, gv = tv - iy;
    const edge = Math.min(gu, 1 - gu, gv, 1 - gv);
    const rim = smooth(0.04, 0.0, edge);
    const id = hash1(ix * 41 + iy * 89);
    const fissure = smooth(0.9, 0.99, x.n.ridged(u + id * 0.3, v, 32, 3));
    x.n2.cell(u, v, 192, x.c);
    const pin = smooth(0.13, 0.05, x.c.f1) * (x.c.id > 0.45 ? 1 : 0);
    const sag = Math.sin(gu * Math.PI) * Math.sin(gv * Math.PI);
    const stained = id > 0.7;
    const [stain, tide] = stained ? stainAt(x, u, v, 8, 0.6) : [0, 0];
    let k = 0.88 + (id - 0.5) * 0.05 - fissure * 0.14 - pin * 0.22 - rim * 0.18 + (x.n2.at(u, v, 256) - 0.5) * 0.04;
    k *= 1 - stain * 0.12 - tide * 0.35;
    o.r = k * (1 + tide * 0.05); o.g = k * (0.985 - tide * 0.06); o.b = k * (0.94 - stain * 0.08 - tide * 0.2);
    o.h = 0.55 + sag * 0.08 - fissure * 0.18 - pin * 0.3 - rim * 0.2;
    o.rough = 0.95; o.metal = 0; o.ao = 1 - rim * 0.25;
  },
  /** Alpha decal: blotchy stain with a darker tide line. */
  stain(u, v, x, _variant, o) {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    const s = d + (x.n.fbm(u, v, 8, 5) - 0.5) * 0.8;
    const inside = smooth(0.95, 0.55, s);
    const tide = smooth(0.08, 0.0, Math.abs(s - 0.85)) * 0.8;
    o.r = 0.2; o.g = 0.14; o.b = 0.07; o.a = clamp01(inside * 0.35 + tide * 0.6) * (0.7 + x.n2.at(u, v, 64) * 0.3);
    o.h = 0.5; o.rough = 0.45; o.metal = 0; o.ao = 1;
  },
  /**
   * Macro variation (data, not colour): R = broad grime, G = large water stains with tide lines,
   * B = wet/glossy patches. Sampled at world scale in the shader so tiled surfaces never repeat visibly.
   */
  macro(u, v, x, _variant, o) {
    const grime = x.n.fbm(u, v, 2, 7);
    const [stain, tide] = stainAt(x, u, v, 4, 0.6);
    const wet = smooth(0.56, 0.7, x.n2.fbm(u + 0.31, v + 0.17, 4, 5));
    o.r = grime; o.g = clamp01(stain * 0.55 + tide); o.b = wet; o.h = 0.5; o.rough = 1; o.metal = 0; o.ao = 1;
  },
  /** Prismatic light-panel diffuser (used as the lamp's emissive map): fine pyramid grid inside a dark frame. */
  louver(u, v, x, _variant, o) {
    const fu = (u * 24) % 1, fv = (v * 24) % 1;
    const prism = 1 - Math.max(Math.abs(fu - 0.5), Math.abs(fv - 0.5)) * 0.5;
    const frame = smooth(0.05, 0.08, Math.min(u, 1 - u, v, 1 - v));
    const k = (0.8 + prism * 0.2 + (x.n.at(u, v, 16) - 0.5) * 0.05) * (0.45 + 0.55 * frame);
    o.r = k; o.g = k * 0.99; o.b = k * 0.96; o.h = prism; o.rough = 0.3; o.metal = 0; o.ao = 1;
  },
};

const NORMAL_STRENGTH: Record<TexKind, number> = { wallpaper: 3.5, carpet: 5, concrete: 5, tile: 6, metal: 3, ceiling: 4.5, stain: 1, louver: 1, macro: 0 };

/** Generate a full PBR set. `size` must be a power of two (32..2048). Deterministic in (kind, seed, variant). */
export function synthTexture(kind: TexKind, seed: number, size: number, variant = 0): TexSet {
  const rng = new Rng(seed ^ (variant * 7919) ^ (kind.length * 131));
  const ctx: Ctx = { n: new Noise(rng.u32()), n2: new Noise(rng.u32()), c: { f1: 0, f2: 0, id: 0 }, c2: { f1: 0, f2: 0, id: 0 } };
  const recipe = RECIPES[kind];
  const albedo = new Uint8ClampedArray(size * size * 4);
  const orm = new Uint8ClampedArray(size * size * 4);
  const height = new Float32Array(size * size);
  const ao = new Float32Array(size * size);
  const px: Px = { r: 0, g: 0, b: 0, a: 1, h: 0.5, rough: 0.8, metal: 0, ao: 1, emit: 0 };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      px.a = 1;
      recipe(x / size, v, ctx, variant, px);
      const i = y * size + x, j = i * 4;
      albedo[j] = clamp01(px.r) * 255; albedo[j + 1] = clamp01(px.g) * 255; albedo[j + 2] = clamp01(px.b) * 255; albedo[j + 3] = clamp01(px.a) * 255;
      orm[j + 1] = clamp01(px.rough) * 255; orm[j + 2] = clamp01(px.metal) * 255; orm[j + 3] = 255;
      height[i] = px.h; ao[i] = px.ao;
    }
  }
  // cavity AO: how far each texel sits below its blurred neighbourhood (crevices, grout, pores darken)
  const blurred = boxBlur(height, size, Math.max(1, size >> 7));
  for (let i = 0; i < size * size; i++) {
    const cav = clamp01(1 - Math.max(0, blurred[i] - height[i]) * 4.5);
    orm[i * 4] = clamp01(ao[i] * cav) * 255;
  }
  return { size, albedo, orm, normal: heightToNormal(height, size, NORMAL_STRENGTH[kind]) };
}

/** Separable wrapping box blur (two passes) for the cavity term. */
function boxBlur(src: Float32Array, size: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const m = size - 1, w = 2 * r + 1;
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * size + (k & m)];
    for (let x = 0; x < size; x++) { tmp[y * size + x] = acc / w; acc += src[y * size + ((x + r + 1) & m)] - src[y * size + ((x - r) & m)]; }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[(k & m) * size + x];
    for (let y = 0; y < size; y++) { out[y * size + x] = acc / w; acc += tmp[((y + r + 1) & m) * size + x] - tmp[((y - r) & m) * size + x]; }
  }
  return out;
}

/** Sobel height -> tangent-space normal (wrapping edges so the tile stays seamless). */
export function heightToNormal(h: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const m = size - 1;
  const s = strength * (size / 256);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const xl = (x - 1) & m, xr = (x + 1) & m, yu = (y - 1) & m, yd = (y + 1) & m;
    const dx = (h[yu * size + xr] + 2 * h[y * size + xr] + h[yd * size + xr] - h[yu * size + xl] - 2 * h[y * size + xl] - h[yd * size + xl]) * 0.25 * s;
    const dy = (h[yd * size + xl] + 2 * h[yd * size + x] + h[yd * size + xr] - h[yu * size + xl] - 2 * h[yu * size + x] - h[yu * size + xr]) * 0.25 * s;
    const il = 1 / Math.sqrt(dx * dx + dy * dy + 1);
    const j = (y * size + x) * 4;
    out[j] = (-dx * il * 0.5 + 0.5) * 255; out[j + 1] = (-dy * il * 0.5 + 0.5) * 255; out[j + 2] = (il * 0.5 + 0.5) * 255; out[j + 3] = 255;
  }
  return out;
}
