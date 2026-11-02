/**
 * MaterialLibrary: turns a level's `look` + a tier into THREE materials. Textures are synthesized
 * in workers (or inline), uploaded once and cached. Standard PBR on Medium+, Lambert on Low/Potato.
 * High-resolution sets (1K/2K) stream in after the level starts: materials first get a 512 set,
 * then swap maps in place when the full-size set arrives (like an engine's texture streaming).
 * Every level surface is patched with baked lighting, analytic AO and macro variation (surface.ts).
 * Optional CC0 PBR sets (public/assets/cc0/manifest.json) override procedural ones when present.
 */
import {
  Color, DataTexture, LinearMipmapLinearFilter, LinearFilter, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
  RepeatWrapping, ClampToEdgeWrapping, SRGBColorSpace, NoColorSpace, Vector2, type Material, type Texture,
} from 'three';
import type { WorkerPool } from '../gen/pool';
import type { TexKind, TexSet } from '../gen/textures';
import type { LevelLook } from '../gen/types';
import type { MatKey } from '../gen/mesher';
import type { TierDef } from './quality';
import { macroTexture, patchSurface, type SurfaceShared } from './surface';

function tex(data: Uint8ClampedArray, size: number, srgb: boolean, aniso: number): Texture {
  const t = new DataTexture(data as unknown as Uint8Array, size, size);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

export interface Cc0Manifest { sets?: Record<string, { albedo: string; normal?: string; orm?: string }> }

/** Try to read the optional CC0 manifest. Never throws: missing files just mean procedural fallback. */
export async function loadCc0Manifest(base: string): Promise<Cc0Manifest> {
  try {
    const r = await fetch(`${base}assets/cc0/manifest.json`, { cache: 'no-cache' });
    if (!r.ok) return {};
    const m = (await r.json()) as Cc0Manifest;
    return m && typeof m === 'object' ? m : {};
  } catch { return {}; }
}

/** How strongly world-scale grime / stains / wet gloss apply per texture kind. */
const MACRO: Partial<Record<TexKind, { grime: number; stain: number; wet: number }>> = {
  wallpaper: { grime: 0.55, stain: 0.75, wet: 0 },
  carpet: { grime: 0.6, stain: 0.55, wet: 0.85 },
  concrete: { grime: 0.6, stain: 0.5, wet: 0.45 },
  tile: { grime: 0.35, stain: 0.35, wet: 0.3 },
  metal: { grime: 0.45, stain: 0.3, wet: 0.2 },
  ceiling: { grime: 0.3, stain: 0.6, wet: 0 },
};
const NORMAL_SCALE: Partial<Record<TexKind, number>> = { wallpaper: 0.6, carpet: 1, concrete: 1, tile: 0.8, metal: 0.7, ceiling: 0.8 };

/** Big surfaces get the full tier resolution; small ones (trim, tile accents, decals) cap lower. */
const BIG: MatKey[] = ['wall0', 'wall1', 'wall2', 'wall3', 'floor', 'ceiling'];
const STREAM_BASE = 512;

export class MaterialLibrary {
  private mats = new Map<MatKey, Material>();
  private cache = new Map<string, Promise<TexSet>>();
  readonly lamp: MeshBasicMaterial;
  private textures: Texture[] = [];
  private disposed = false;
  /** Resolves when streamed high-resolution sets have all been swapped in. */
  streamed: Promise<void> = Promise.resolve();

  constructor(private tier: TierDef, private pool: WorkerPool, private maxAniso: number, private look: LevelLook, private seed: number, private surface: SurfaceShared | null = null) {
    this.lamp = new MeshBasicMaterial({ color: new Color(look.lampColor).multiplyScalar(2.6) });
  }

  private set(kind: TexKind, variant: number, size: number): Promise<TexSet> {
    const k = `${kind}:${variant}:${size}`;
    let s = this.cache.get(k);
    if (!s) { s = this.pool.texture(kind, this.seed, size, variant); this.cache.set(k, s); }
    return s;
  }

  private bgCache = new Map<string, Promise<TexSet | null>>();
  private bgSet(kind: TexKind, variant: number, size: number): Promise<TexSet | null> {
    const k = `${kind}:${variant}:${size}`;
    let s = this.bgCache.get(k);
    if (!s) { s = this.pool.textureBackground(kind, this.seed, size, variant); this.bgCache.set(k, s); }
    return s;
  }

  private sizeFor(key: MatKey | 'prop'): number {
    const full = this.tier.textureSize;
    if (key === 'decal') return Math.min(256, full);
    return BIG.includes(key as MatKey) ? full : Math.min(1024, full);
  }

  private make(s: TexSet, kind: TexKind, opts: { transparent?: boolean } = {}): Material {
    const albedo = tex(s.albedo, s.size, true, this.maxAniso);
    this.textures.push(albedo);
    const common = { transparent: !!opts.transparent, depthWrite: !opts.transparent, polygonOffset: !!opts.transparent, polygonOffsetFactor: -2 };
    if (this.tier.materials === 'lambert') return new MeshLambertMaterial({ map: albedo, ...common });
    const normal = tex(s.normal, s.size, false, this.maxAniso);
    const orm = tex(s.orm, s.size, false, this.maxAniso);
    this.textures.push(normal, orm);
    const ns = NORMAL_SCALE[kind] ?? 1;
    return new MeshStandardMaterial({
      map: albedo, normalMap: normal, normalScale: new Vector2(ns, ns), aoMap: orm, aoMapIntensity: 1, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, ...common,
    });
  }

  /** Replace a material's maps with a higher-resolution set (same kind) without recompiling. */
  /**
   * Queue a material for its higher-resolution maps. Uploads are paced by `pump()`: one texture per
   * frame is uploaded ahead of time (initTexture), and the material swaps once all its maps are on
   * the GPU, so streaming never costs more than a single upload in any frame.
   */
  private upgrade(m: Material, s: TexSet): void {
    if (this.disposed) return;
    const std = m instanceof MeshStandardMaterial;
    const maps: Texture[] = [tex(s.albedo, s.size, true, this.maxAniso)];
    if (std) maps.push(tex(s.normal, s.size, false, this.maxAniso), tex(s.orm, s.size, false, this.maxAniso));
    this.pending.push({ m, maps, uploaded: 0 });
  }
  private pending: { m: Material; maps: Texture[]; uploaded: number }[] = [];

  /** Call once per rendered frame. */
  pump(renderer: { initTexture(t: Texture): void }): void {
    const job = this.pending[0];
    if (!job || this.disposed) return;
    if (job.uploaded < job.maps.length) { renderer.initTexture(job.maps[job.uploaded++]); return; }
    this.pending.shift();
    const old: (Texture | null)[] = [];
    if (job.m instanceof MeshStandardMaterial) {
      old.push(job.m.map, job.m.normalMap, job.m.aoMap);
      job.m.map = job.maps[0]; job.m.normalMap = job.maps[1]; job.m.aoMap = job.m.roughnessMap = job.m.metalnessMap = job.maps[2];
    } else if (job.m instanceof MeshLambertMaterial) { old.push(job.m.map); job.m.map = job.maps[0]; }
    this.textures.push(...job.maps);
    for (const o of old) if (o) { o.dispose(); this.textures = this.textures.filter((x) => x !== o); }
  }

  private patch(m: Material, kind: TexKind | null, bake = true): void {
    if (!this.surface) return;
    const mc = (kind && MACRO[kind]) || { grime: 0, stain: 0, wet: 0 };
    patchSurface(m, this.surface, { ...mc, scale: 1 / 7.3, bake });
  }

  /** Synthesize and upload everything this level's look needs. `onProgress` drives the loading bar. */
  async load(onProgress: (done: number, total: number) => void = () => {}): Promise<void> {
    const L = this.look;
    const jobs: [MatKey, TexKind, number, boolean?][] = [
      ['wall0', ...L.walls[0 % L.walls.length]], ['wall1', ...L.walls[1 % L.walls.length]],
      ['wall2', ...L.walls[2 % L.walls.length]], ['wall3', ...L.walls[3 % L.walls.length]],
      ['floor', ...L.floor], ['floorTile', 'tile', 0], ['ceiling', ...L.ceiling], ['trim', ...L.trim],
    ];
    if (this.tier.level >= 2) jobs.push(['decal', 'stain', 0, true]);
    let done = 0;
    const total = jobs.length + 2;
    const late: Promise<void>[] = [];
    const extra = async () => {
      // macro variation map + the light diffuser (prismatic panel) for the fixtures
      const [macro, louver] = await Promise.all([this.set('macro', 0, 256), this.set('louver', 0, Math.min(256, Math.max(64, this.tier.textureSize)))]);
      if (this.surface) { const t = macroTexture(macro.albedo, macro.size); this.textures.push(t); this.surface.uMacro.value = t; }
      const lt = tex(louver.albedo, louver.size, true, this.maxAniso); lt.wrapS = lt.wrapT = ClampToEdgeWrapping; // clamp: one panel per fixture
      this.textures.push(lt); this.lamp.map = lt; this.lamp.needsUpdate = true;
      onProgress(++done, total); onProgress(++done, total);
    };
    await extra();
    await Promise.all(jobs.map(async ([key, kind, variant, transparent]) => {
      const full = this.sizeFor(key);
      const first = Math.min(full, STREAM_BASE);
      const m = this.make(await this.set(kind, variant, first), kind, { transparent });
      this.patch(m, kind === 'stain' ? null : kind);
      this.mats.set(key, m);
      if (full > first) late.push(this.bgSet(kind, variant, full).then((s) => { if (s) this.upgrade(m, s); }));
      onProgress(++done, total);
    }));
    // suspended-ceiling grid: painted steel
    const tbar = this.tier.materials === 'lambert' ? new MeshLambertMaterial({ color: 0xb4ae9c }) : new MeshStandardMaterial({ color: 0xbcb6a4, roughness: 0.5, metalness: 0.15 });
    this.patch(tbar, null);
    if (L.ceiling[0] === 'ceiling' && this.tier.level >= 2) this.mats.set('tbar', tbar); else tbar.dispose();
    this.streamed = Promise.all(late).then(() => undefined);
  }

  get(key: MatKey): Material {
    const m = this.mats.get(key);
    if (!m) throw new Error(`material ${key} not loaded`);
    return m;
  }
  has(key: MatKey): boolean { return this.mats.has(key); }

  /** Set a standard texture by kind for props (gallery boxes etc.) */
  async propMaterial(kind: TexKind, variant = 0): Promise<Material> {
    const m = this.make(await this.set(kind, variant, Math.min(512, this.tier.textureSize)), kind);
    return m;
  }

  get textureCount(): number { return this.textures.length; }

  dispose(): void {
    this.disposed = true;
    this.pending.forEach((j) => j.maps.forEach((t) => t.dispose())); this.pending = [];
    this.mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.lamp.dispose();
    this.mats.clear(); this.textures.length = 0; this.cache.clear(); this.bgCache.clear();
  }
}
