/**
 * Settings: one schema drives defaults, validation, persistence and the settings UI.
 * Stored inside the global profile so they survive slot deletion and Hardcore deaths.
 */
import { bus } from './events';
import { DEFAULT_BINDINGS, sanitizeBindings, cloneBindings, type Bindings } from './input/actions';
import type { DifficultyId, ScareIntensity } from './difficulty';

export type TierSetting = 'auto' | 'ultra' | 'high' | 'medium' | 'low' | 'potato';
export type Category = 'Graphics' | 'Audio' | 'Controls' | 'Gameplay' | 'Accessibility';

export interface Settings {
  // graphics
  tier: TierSetting; resolutionScale: number; fpsCap: string; fov: number; drawDistance: number;
  shadowQuality: 'off' | 'low' | 'high'; textureQuality: 'low' | 'medium' | 'high'; antialias: boolean;
  bloom: boolean; ssao: boolean; vhs: boolean; vhsIntensity: number; grain: boolean; scanlines: boolean;
  chromatic: boolean; vignette: boolean; dust: boolean; batterySaver: boolean; showFps: boolean;
  // audio
  master: number; music: number; sfx: number; ambience: number; voice: number;
  // controls
  sensitivity: number; invertY: boolean; padDeadzone: number; padCurve: number; padVibration: boolean; gyro: boolean;
  touchSize: number; touchOpacity: number; leftHanded: boolean; oneHanded: boolean; holdToggleSprint: 'hold' | 'toggle';
  holdToggleCrouch: 'hold' | 'toggle'; bindings: Bindings;
  // gameplay
  difficulty: DifficultyId; scare: ScareIntensity; hunger: boolean; autosave: boolean;
  // accessibility
  lens: string;
  subtitles: boolean; reduceFlicker: boolean; reduceJumpscares: boolean; reduceShake: boolean;
  colorblind: 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia'; textSize: number; highContrast: boolean;
}

type Base = { key: keyof Settings; label: string; category: Category; hint?: string };
export type SettingDef =
  | (Base & { type: 'toggle'; def: boolean })
  | (Base & { type: 'range'; def: number; min: number; max: number; step: number; unit?: string })
  | (Base & { type: 'select'; def: string; options: { value: string; label: string }[] });

const opts = (...a: string[]) => a.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const tog = (key: keyof Settings, label: string, category: Category, def: boolean, hint?: string): SettingDef => ({ key, label, category, type: 'toggle', def, hint });
const rng = (key: keyof Settings, label: string, category: Category, def: number, min: number, max: number, step: number, unit?: string): SettingDef =>
  ({ key, label, category, type: 'range', def, min, max, step, unit });
const sel = (key: keyof Settings, label: string, category: Category, def: string, options: { value: string; label: string }[], hint?: string): SettingDef =>
  ({ key, label, category, type: 'select', def, options, hint });

export const SCHEMA: SettingDef[] = [
  sel('tier', 'Quality tier', 'Graphics', 'auto', opts('auto', 'ultra', 'high', 'medium', 'low', 'potato'), 'Auto benchmarks your device and adapts while you play.'),
  rng('resolutionScale', 'Resolution scale', 'Graphics', 1, 0.5, 1, 0.05),
  sel('fpsCap', 'FPS cap', 'Graphics', '60', [{ value: '30', label: '30' }, { value: '60', label: '60' }, { value: '120', label: '120' }, { value: '0', label: 'Uncapped' }], 'Browsers always sync to the display; the cap limits it further.'),
  rng('fov', 'Field of view', 'Graphics', 75, 60, 110, 1, '°'),
  rng('drawDistance', 'Draw distance', 'Graphics', 1, 0.4, 1.5, 0.1, '×'),
  sel('shadowQuality', 'Shadow quality', 'Graphics', 'high', opts('off', 'low', 'high')),
  sel('textureQuality', 'Texture quality', 'Graphics', 'high', opts('low', 'medium', 'high')),
  tog('antialias', 'Anti-aliasing', 'Graphics', true, 'Applies on next restart.'),
  tog('bloom', 'Bloom', 'Graphics', true),
  tog('ssao', 'Ambient occlusion', 'Graphics', true),
  tog('vhs', 'VHS / camcorder layer', 'Graphics', true),
  rng('vhsIntensity', 'VHS intensity', 'Graphics', 0.7, 0, 1, 0.05),
  tog('grain', 'Film grain', 'Graphics', true),
  tog('scanlines', 'Scanlines', 'Graphics', true),
  tog('chromatic', 'Chromatic aberration', 'Graphics', true),
  tog('vignette', 'Vignette', 'Graphics', true),
  tog('dust', 'Floating dust', 'Graphics', true),
  tog('batterySaver', 'Battery saver', 'Graphics', false, '30 fps, lower resolution. Good for phones.'),
  tog('showFps', 'Show performance stats', 'Graphics', false),

  rng('master', 'Master', 'Audio', 0.8, 0, 1, 0.05),
  rng('music', 'Music', 'Audio', 0.7, 0, 1, 0.05),
  rng('sfx', 'Effects', 'Audio', 0.9, 0, 1, 0.05),
  rng('ambience', 'Ambience', 'Audio', 0.8, 0, 1, 0.05),
  rng('voice', 'Voice blips', 'Audio', 0.7, 0, 1, 0.05),

  rng('sensitivity', 'Look sensitivity', 'Controls', 1, 0.2, 3, 0.05, '×'),
  tog('invertY', 'Invert Y', 'Controls', false),
  rng('padDeadzone', 'Gamepad dead zone', 'Controls', 0.18, 0.05, 0.4, 0.01),
  rng('padCurve', 'Gamepad response curve', 'Controls', 1.6, 1, 3, 0.1),
  tog('padVibration', 'Gamepad vibration', 'Controls', true),
  tog('gyro', 'Touch: gyro aiming', 'Controls', false),
  rng('touchSize', 'Touch control size', 'Controls', 1, 0.6, 1.6, 0.05, '×'),
  rng('touchOpacity', 'Touch control opacity', 'Controls', 0.6, 0.2, 1, 0.05),
  tog('leftHanded', 'Touch: left-handed layout', 'Controls', false),
  tog('oneHanded', 'Touch: one-handed layout', 'Controls', false),
  sel('holdToggleSprint', 'Sprint', 'Controls', 'hold', opts('hold', 'toggle')),
  sel('holdToggleCrouch', 'Crouch', 'Controls', 'hold', opts('hold', 'toggle')),

  sel('difficulty', 'Difficulty (new games)', 'Gameplay', 'normal', opts('easy', 'normal', 'hard', 'nightmare', 'hardcore')),
  sel('scare', 'Scare intensity', 'Gameplay', 'standard', opts('relaxed', 'standard', 'brutal')),
  tog('hunger', 'Hunger and thirst', 'Gameplay', true, 'Off in Easy regardless.'),
  tog('autosave', 'Autosave', 'Gameplay', true),

  sel('lens', 'Camcorder lens', 'Gameplay', 'standard', opts('standard', 'amber', 'mono', 'gold'), 'Unlocked by finishing the game; locked lenses fall back to standard.'),
  tog('subtitles', 'Captions for sounds', 'Accessibility', true),
  tog('reduceFlicker', 'Reduce flicker and strobe', 'Accessibility', false),
  tog('reduceJumpscares', 'Reduce jump scares', 'Accessibility', false),
  tog('reduceShake', 'Reduce camera shake and head bob', 'Accessibility', false),
  sel('colorblind', 'Colorblind mode', 'Accessibility', 'off', opts('off', 'protanopia', 'deuteranopia', 'tritanopia')),
  rng('textSize', 'Text size', 'Accessibility', 1, 0.8, 1.6, 0.05, '×'),
  tog('highContrast', 'High-contrast UI', 'Accessibility', false),
];

export function defaultSettings(): Settings {
  const o: Record<string, unknown> = {};
  for (const d of SCHEMA) o[d.key] = d.def;
  o.bindings = cloneBindings(DEFAULT_BINDINGS);
  return o as unknown as Settings;
}

/** Validate a raw blob against the schema: unknown keys dropped, ranges clamped, bad values defaulted. */
export function sanitizeSettings(raw: unknown): Settings {
  const out = defaultSettings() as unknown as Record<string, unknown>;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const d of SCHEMA) {
    const v = r[d.key];
    if (v === undefined) continue;
    if (d.type === 'toggle' && typeof v === 'boolean') out[d.key] = v;
    else if (d.type === 'range' && typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.min(d.max, Math.max(d.min, v));
    else if (d.type === 'select' && typeof v === 'string' && d.options.some((o) => o.value === v)) out[d.key] = v;
  }
  out.bindings = sanitizeBindings(r.bindings);
  return out as unknown as Settings;
}

type Listener = (s: Settings, changed: keyof Settings) => void;

/** Live settings object. `persist` is injected so this file has no storage dependency. */
export class SettingsStore {
  value: Settings;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(raw: unknown = {}, private persist: (s: Settings) => void = () => {}) {
    this.value = sanitizeSettings(raw);
  }

  get<K extends keyof Settings>(k: K): Settings[K] { return this.value[k]; }

  set<K extends keyof Settings>(k: K, v: Settings[K]): void {
    if (this.value[k] === v) return;
    this.value = sanitizeSettings({ ...this.value, [k]: v });
    this.listeners.forEach((l) => l(this.value, k));
    bus.emit('settings:changed', { key: k });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.persist(this.value), 250); // debounce slider drags
  }

  flush(): void { if (this.timer) { clearTimeout(this.timer); this.timer = null; } this.persist(this.value); }

  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }

  /** Select values arrive as strings; convert to the declared type when applying from UI. */
  setFromUi(key: keyof Settings, raw: string | number | boolean): void {
    const d = SCHEMA.find((s) => s.key === key);
    if (!d) return;
    let v: unknown = raw;
    if (d.type === 'range') v = Number(raw);
    this.set(key, v as never);
  }
}

/** FPS cap as a number (fpsCap is stored as a select string in the UI). */
export function fpsCapOf(s: Settings): number {
  if (s.batterySaver) return 30;
  return Number(s.fpsCap) || 0;
}
