/**
 * Quality tiers (spec 6.3) + Auto selection + dynamic resolution scaling. Pure logic (no THREE/DOM)
 * so the decisions are unit-testable. The same level is built at every tier; only detail changes.
 */
import type { Settings, TierSetting } from '../core/settings';

export type TierId = 'ultra' | 'high' | 'medium' | 'low' | 'potato';
export const TIER_ORDER: TierId[] = ['potato', 'low', 'medium', 'high', 'ultra'];

export interface TierDef {
  id: TierId;
  /** 0..4, passed to builders as the `quality` parameter. */
  level: number;
  label: string;
  /** Base internal resolution multiplier (before the user slider and dynamic scaling). */
  resolution: number;
  maxPixelRatio: number;
  /** Real-time point lights active near the viewer, and how many cast shadows. */
  lights: number;
  shadowLights: number;
  shadowMap: number;
  textureSize: number;
  post: 'full' | 'light' | 'none';
  bloom: boolean;
  ssao: boolean;
  ssaoScale: number;
  dust: number;
  /** Draw distance in metres (chunk load radius) and fog far. */
  drawDistance: number;
  materials: 'standard' | 'lambert';
  fpsTarget: number;
  /** Ms per frame budget used by adaptive quality. */
  frameBudgetMs: number;
}

export const TIERS: Record<TierId, TierDef> = {
  ultra:  { id: 'ultra',  level: 4, label: 'Ultra',  resolution: 1,    maxPixelRatio: 2,   lights: 10, shadowLights: 2, shadowMap: 1024, textureSize: 2048, post: 'full',  bloom: true,  ssao: true,  ssaoScale: 1,    dust: 1500, drawDistance: 70, materials: 'standard', fpsTarget: 60, frameBudgetMs: 16.7 },
  high:   { id: 'high',   level: 3, label: 'High',   resolution: 1,    maxPixelRatio: 1.5, lights: 8,  shadowLights: 2, shadowMap: 512,  textureSize: 1024,  post: 'full',  bloom: true,  ssao: true,  ssaoScale: 0.5,  dust: 800,  drawDistance: 60, materials: 'standard', fpsTarget: 60, frameBudgetMs: 16.7 },
  medium: { id: 'medium', level: 2, label: 'Medium', resolution: 0.85, maxPixelRatio: 1.25, lights: 5, shadowLights: 1, shadowMap: 512,  textureSize: 512,  post: 'light', bloom: true,  ssao: false, ssaoScale: 0.5,  dust: 300,  drawDistance: 50, materials: 'standard', fpsTarget: 60, frameBudgetMs: 16.7 },
  low:    { id: 'low',    level: 1, label: 'Low',    resolution: 0.7,  maxPixelRatio: 1,   lights: 3,  shadowLights: 0, shadowMap: 256,  textureSize: 256,  post: 'light', bloom: false, ssao: false, ssaoScale: 0.5,  dust: 80,   drawDistance: 40, materials: 'lambert',  fpsTarget: 45, frameBudgetMs: 22 },
  potato: { id: 'potato', level: 0, label: 'Potato', resolution: 0.5,  maxPixelRatio: 1,   lights: 2,  shadowLights: 0, shadowMap: 256,  textureSize: 128,  post: 'none',  bloom: false, ssao: false, ssaoScale: 0.5,  dust: 0,    drawDistance: 28, materials: 'lambert',  fpsTarget: 30, frameBudgetMs: 33.3 },
};

export interface HardwareInfo {
  gpu: string;            // WEBGL_debug_renderer_info string, may be ''
  cores: number;
  memoryGb: number;       // navigator.deviceMemory (0 if unknown)
  mobile: boolean;
  maxTextureSize: number;
}

export interface BenchResult { avgFrameMs: number; frames: number }

const SOFTWARE_GPU = /swiftshader|llvmpipe|software|basic render/i;
const WEAK_GPU = /intel.*(hd|uhd) graphics (?:[2-5]\d{2}\b|4000)|mali-[34]|adreno \(?(?:[1-4]\d{2})|powervr/i;
/** Integrated GPUs that run Medium well but not the full post chain (Surface / ultrabooks). */
const MID_GPU = /iris|intel.*arc.*graphics|intel\(r\) graphics|radeon\(tm\) graphics|vega \d|adreno \(?[5-6]\d{2}|mali-g[5-7]/i;

/** Choose a tier from a short benchmark (frame time at High-ish detail) and hardware hints. */
export function pickTier(b: BenchResult, hw: HardwareInfo): TierId {
  let score: number; // 4 = ultra .. 0 = potato
  const ms = b.avgFrameMs;
  if (ms <= 6) score = 4; else if (ms <= 11) score = 3; else if (ms <= 17) score = 2; else if (ms <= 28) score = 1; else score = 0;
  // hardware caps: the benchmark scene is simple, so it can overestimate weak devices
  let cap = 4;
  if (SOFTWARE_GPU.test(hw.gpu)) cap = 0;
  else if (WEAK_GPU.test(hw.gpu)) cap = 1;
  else if (MID_GPU.test(hw.gpu)) cap = 2;
  if (hw.mobile) cap = Math.min(cap, 2);
  if (hw.memoryGb > 0 && hw.memoryGb <= 2) cap = Math.min(cap, 1);
  if (hw.cores > 0 && hw.cores <= 2) cap = Math.min(cap, 2);
  if (hw.maxTextureSize > 0 && hw.maxTextureSize < 4096) cap = Math.min(cap, 1);
  return TIER_ORDER[Math.min(score, cap)];
}

/** Effective tier from the settings choice. `autoTier` is what the benchmark picked. */
export function resolveTier(setting: TierSetting, autoTier: TierId): TierDef {
  return TIERS[setting === 'auto' ? autoTier : setting];
}

/** Resolve the final render scale from tier base, user slider, battery saver and dynamic factor. */
export function renderScale(tier: TierDef, s: Pick<Settings, 'resolutionScale' | 'batterySaver'>, dynamic: number): number {
  const saver = s.batterySaver ? 0.75 : 1;
  return Math.max(0.35, Math.min(1, tier.resolution * s.resolutionScale * saver * dynamic));
}

export type AdaptAction = { kind: 'scale'; scale: number } | { kind: 'tierDown'; to: TierId } | { kind: 'offerUp'; to: TierId } | null;

/**
 * Dynamic resolution scaling + automatic tier-down (+ thermal fallback: the long window catches
 * sustained slowdowns). Feed it one frame time at a time; apply any returned action.
 */
export class AdaptiveQuality {
  scale = 1;
  private slow = 0;
  private fast = 0;
  private longSlow = 0;
  private longFast = 0;
  private cooldown = 0;
  minScale = 0.55;

  constructor(public tier: TierId, private auto: boolean) {}

  setTier(t: TierId): void { this.tier = t; this.scale = 1; this.slow = this.fast = this.longSlow = this.longFast = 0; this.cooldown = 120; }

  /**
   * @param frameMs wall-clock time of the last frame.
   * Dynamic resolution runs on every tier (a manually chosen tier still has to hold its frame rate);
   * tier changes are only made or offered when the tier is on Auto.
   */
  update(frameMs: number): AdaptAction {
    if (this.cooldown > 0) { this.cooldown--; return null; }
    const budget = TIERS[this.tier].frameBudgetMs;
    if (frameMs > budget * 1.2) { this.slow++; this.fast = 0; this.longSlow++; this.longFast = 0; }
    else if (frameMs < budget * 0.7) { this.fast++; this.slow = 0; this.longFast++; this.longSlow = 0; }
    else { this.slow = Math.max(0, this.slow - 1); this.fast = Math.max(0, this.fast - 1); }

    // quick response: lower resolution
    if (this.slow >= 45 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, +(this.scale - 0.08).toFixed(2));
      this.slow = 0; this.cooldown = 30;
      return { kind: 'scale', scale: this.scale };
    }
    // already at the floor and still slow for ~6 s: drop a tier (also covers thermal throttling)
    if (this.auto && this.scale <= this.minScale + 1e-6 && this.longSlow >= 360) {
      const i = TIER_ORDER.indexOf(this.tier);
      this.longSlow = 0;
      if (i > 0) return { kind: 'tierDown', to: TIER_ORDER[i - 1] };
    }
    // recovery
    if (this.fast >= 180 && this.scale < 1) {
      this.scale = Math.min(1, +(this.scale + 0.05).toFixed(2));
      this.fast = 0; this.cooldown = 30;
      return { kind: 'scale', scale: this.scale };
    }
    if (this.auto && this.longFast >= 1800 && this.scale >= 1) {
      this.longFast = 0;
      const i = TIER_ORDER.indexOf(this.tier);
      if (i < TIER_ORDER.length - 1) return { kind: 'offerUp', to: TIER_ORDER[i + 1] };
    }
    return null;
  }
}
