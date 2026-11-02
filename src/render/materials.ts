/**
 * MaterialLibrary: turns a level's `look` + a tier into THREE materials. Textures are synthesized
 * in workers (or inline), uploaded once and cached. Standard PBR on Medium+, Lambert on Low/Potato.
 * Optional CC0 PBR sets (public/assets/cc0/manifest.json) override procedural ones when present.
 */
import {
  Color, DataTexture, LinearMipmapLinearFilter, LinearFilter, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace, NoColorSpace, type Material, type Texture,
} from 'three';
import type { WorkerPool } from '../gen/pool';
import type { TexKind, TexSet } from '../gen/textures';
import type { LevelLook } from '../gen/types';
import type { MatKey } from '../gen/mesher';
import type { TierDef } from './quality';

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

export class MaterialLibrary {
  private mats = new Map<MatKey, Material>();
  private cache = new Map<string, TexSet>();
  readonly lamp: MeshBasicMaterial;
  private textures: Texture[] = [];

  constructor(private tier: TierDef, private pool: WorkerPool, private maxAniso: number, private look: LevelLook, private seed: number) {
    this.lamp = new MeshBasicMaterial({ color: new Color(look.lampColor).multiplyScalar(2.4) });
  }

  private async set(kind: TexKind, variant: number): Promise<TexSet> {
    const k = `${kind}:${variant}:${this.tier.textureSize}`;
    let s = this.cache.get(k);
    if (!s) { s = await this.pool.texture(kind, this.seed, kind === 'stain' ? Math.min(256, this.tier.textureSize) : this.tier.textureSize, variant); this.cache.set(k, s); }
    return s;
  }

  private make(s: TexSet, opts: { transparent?: boolean; tint?: number } = {}): Material {
    const albedo = tex(s.albedo, s.size, true, this.maxAniso);
    this.textures.push(albedo);
    if (this.tier.materials === 'lambert') {
      return new MeshLambertMaterial({ map: albedo, transparent: !!opts.transparent, depthWrite: !opts.transparent, polygonOffset: !!opts.transparent, polygonOffsetFactor: -2 });
    }
    const normal = tex(s.normal, s.size, false, this.maxAniso);
    const orm = tex(s.orm, s.size, false, this.maxAniso);
    this.textures.push(normal, orm);
    return new MeshStandardMaterial({
      map: albedo, normalMap: normal, aoMap: orm, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1,
      transparent: !!opts.transparent, depthWrite: !opts.transparent, polygonOffset: !!opts.transparent, polygonOffsetFactor: -2,
    });
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
    // dedupe texture generation for repeated (kind, variant)
    let done = 0;
    const total = jobs.length;
    await Promise.all(jobs.map(async ([key, kind, variant, transparent]) => {
      const set = await this.set(kind, variant);
      this.mats.set(key, this.make(set, { transparent }));
      onProgress(++done, total);
    }));
  }

  get(key: MatKey): Material {
    const m = this.mats.get(key);
    if (!m) throw new Error(`material ${key} not loaded`);
    return m;
  }
  has(key: MatKey): boolean { return this.mats.has(key); }

  /** Set a standard texture by kind for props (gallery boxes etc.) */
  async propMaterial(kind: TexKind, variant = 0): Promise<Material> { return this.make(await this.set(kind, variant)); }

  get textureCount(): number { return this.textures.length; }

  dispose(): void {
    this.mats.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.lamp.dispose();
    this.mats.clear(); this.textures.length = 0;
  }
}
