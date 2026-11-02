/** Act 3 level specs (spec 8.2): Metro, Carnival, Suburbs, Wheat Field, Arctic Station, Endless City, Level 94, Gallery, Run for Your Life, Finale. */
import { makeLevel, type LevelSpec } from './factory';
import { LEVEL_NOTES } from '../story/notes';
import type { LevelLook, LevelPlan, RuleDef } from '../gen/types';
import type { Rng } from '../gen/rng';

const ids = (lvl: string) => LEVEL_NOTES(lvl).map((n) => n.id);
const look = (o: Partial<LevelLook> & Pick<LevelLook, 'walls' | 'floor' | 'ceiling' | 'trim'>): LevelLook => ({
  fogColor: 0x0a0a0c, fogDensity: 0.03, ambient: 0x383840, ambientIntensity: 0.42, lampColor: 0xfff0c0,
  grade: { tint: [1, 1, 1], saturation: 1, contrast: 1.05 }, dust: 0xcccccc, ...o,
});

/** Spawn extra ambush-slot entities in ordinary rooms (never start/exit/supply). */
function populate(plan: LevelPlan, rng: Rng, entity: string, n: number): void {
  const rooms = plan.rooms.filter((r) => (r.kind === 'room' || r.kind === 'hall' || r.kind === 'dead') && r.id !== plan.spawn.room && r.id !== plan.exit.room && !plan.waypoints.some((w) => w.room === r.id));
  for (let i = 0; i < n && rooms.length; i++) { const r = rng.pick(rooms); plan.entitySlots.push({ room: r.id, pos: { x: r.x + r.w / 2 + rng.range(-1.2, 1.2), z: r.z + r.d / 2 + rng.range(-1.2, 1.2) }, role: 'ambush', entity }); }
}

const metro: LevelSpec = {
  id: 'metro', name: 'Metro', act: 3, tier: 'uneasy', door: { color: '#8a8aa8', icon: 'M' }, intensity: 0.4, targetSeconds: [90, 2400],
  look: look({ walls: [['tile', 0], ['concrete', 0], ['tile', 0], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['concrete', 0], trim: ['metal', 0], fogColor: 0x0a0c12, fogDensity: 0.03, ambient: 0x2a3040, ambientIntensity: 0.4, lampColor: 0xcfe0ff, grade: { tint: [0.92, 1.0, 1.1], saturation: 0.9, contrast: 1.1 } }),
  graph: { width: 130, depth: 50, rooms: 28, minRoom: 8, maxRoom: 30, wallHeight: 4, locks: 1, lockStyles: ['key'], loops: 0.35, variants: 4, nests: 2, loot: 28 },
  hallAspect: 1.8, schedule: { period: 45, window: 14, offset: 20 },
  props: [{ kind: 'bench', w: 2.0, d: 0.6, h: 0.5, color: 0x4a4a52, count: 24 }, { kind: 'pillar', w: 0.7, d: 0.7, h: 4, color: 0x6a6a70, count: 20 }],
  ecology: [{ entity: 'wraith', where: 'near' }, { entity: 'wraith', where: 'far' }], notes: ids('metro'), hides: 0.35,
};

const carnival: LevelSpec = {
  id: 'carnival', name: 'Carnival', act: 3, tier: 'tense', door: { color: '#d85a8a', icon: 'C' }, intensity: 0.5, targetSeconds: [90, 2400],
  look: look({ walls: [['wallpaper', 2], ['wallpaper', 0], ['wallpaper', 2], ['concrete', 0]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x140a12, fogDensity: 0.03, ambient: 0x4a2a40, ambientIntensity: 0.46, lampColor: 0xffc0e0, grade: { tint: [1.1, 0.95, 1.05], saturation: 1.15, contrast: 1.1 }, dust: 0xf0b0d0 }),
  graph: { width: 120, depth: 90, rooms: 30, minRoom: 9, maxRoom: 24, wallHeight: 3.6, locks: 2, lockStyles: ['sequence', 'key'], loops: 0.4, variants: 4, nests: 0, loot: 30 },
  ruleEntity: 'partygoers',
  props: [{ kind: 'booth', w: 2.2, d: 1.6, h: 2.6, color: 0xc0306a, count: 20 }, { kind: 'ride', w: 3, d: 3, h: 2.2, color: 0x3a6ac0, count: 8 }],
  notes: ids('carnival'), hides: 0.35,
  extra(plan, rng) {
    populate(plan, rng, 'partygoer', 9);
    const pool: Omit<RuleDef, 'real' | 'id'>[] = [{ kind: 'noRunning', text: 'NO RUNNING.' }, { kind: 'noLight', text: 'NO LIGHTS AFTER DARK.' }, { kind: 'noNoise', text: 'KEEP THE NOISE DOWN.' }, { kind: 'noKnock', text: 'KNOCK BEFORE YOU ENTER A BOOTH.' }];
    const real = new Set(rng.shuffle([0, 1, 2]).slice(0, 2));
    plan.rules = pool.map((r, i) => ({ ...r, id: `rule${i}`, real: real.has(i) }));
  },
};

const suburbs: LevelSpec = {
  id: 'suburbs', name: 'Suburbs', act: 3, tier: 'tense', door: { color: '#a8c06a', icon: 'U' }, intensity: 0.5, targetSeconds: [90, 2400],
  look: look({ walls: [['wallpaper', 1], ['wallpaper', 2], ['wallpaper', 0], ['wallpaper', 3]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['concrete', 0], fogColor: 0x0c120a, fogDensity: 0.025, ambient: 0x3a4a30, ambientIntensity: 0.5, lampColor: 0xfff4d0, grade: { tint: [1.0, 1.06, 0.92], saturation: 1.05, contrast: 1.05 }, dust: 0xc8d8a8 }),
  graph: { width: 120, depth: 100, rooms: 34, minRoom: 8, maxRoom: 20, wallHeight: 3, locks: 2, lockStyles: ['key'], loops: 0.45, variants: 4, nests: 0, loot: 32 },
  props: [{ kind: 'sofa', w: 2.0, d: 0.9, h: 0.9, color: 0x6a5a4a, count: 26 }, { kind: 'table', w: 1.2, d: 1.2, h: 0.8, color: 0x7a6a4a, count: 18 }],
  notes: ids('suburbs'), hides: 0.5,
  extra(plan, rng) { populate(plan, rng, 'watcher', 7); },
};

const wheatfield: LevelSpec = {
  id: 'wheatfield', name: 'Wheat Field', anchor: 5, act: 3, tier: 'uneasy', door: { color: '#d8c060', icon: 'W' }, intensity: 0.15, targetSeconds: [90, 2400],
  look: look({ walls: [['wallpaper', 0], ['wallpaper', 0], ['concrete', 0], ['concrete', 0]], floor: ['carpet', 0], ceiling: ['ceiling', 0], trim: ['concrete', 0], fogColor: 0x6a5a30, fogDensity: 0.012, ambient: 0xd8c080, ambientIntensity: 0.8, lampColor: 0xfff0c0, grade: { tint: [1.12, 1.0, 0.8], saturation: 1.1, contrast: 1.0 }, dust: 0xf0d890 }),
  graph: { width: 220, depth: 200, rooms: 18, minRoom: 30, maxRoom: 80, wallHeight: 3, locks: 0, loops: 0.2, variants: 2, nests: 0, loot: 10 },
  open: 1,
  props: [{ kind: 'wheat', w: 0.7, d: 0.7, h: 1.4, color: 0xc8a840, count: 900, soft: true }, { kind: 'tree', w: 1.6, d: 1.6, h: 6, color: 0x4a3a28, count: 10, soft: false }],
  notes: ids('wheatfield'),
  guaranteed: [{ item: 'compass', count: 1, where: 'any' }],
};

const arctic: LevelSpec = {
  id: 'arctic', name: 'Arctic Station', act: 3, tier: 'horror', door: { color: '#c8e0f0', icon: 'A' }, intensity: 0.65, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 0], ['concrete', 0], ['metal', 0], ['concrete', 0]], floor: ['concrete', 0], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0xc8d8e4, fogDensity: 0.06, ambient: 0xb0c8e0, ambientIntensity: 0.7, lampColor: 0xe0f0ff, grade: { tint: [0.9, 1.0, 1.15], saturation: 0.7, contrast: 1.05 }, dust: 0xffffff }),
  graph: { width: 130, depth: 100, rooms: 30, minRoom: 9, maxRoom: 24, wallHeight: 3.2, locks: 2, lockStyles: ['key'], loops: 0.35, variants: 4, nests: 2, loot: 34, lootTable: [['flare', 3], ['battery', 3], ['almond_water', 3], ['cracker', 2], ['bandage', 2], ['canned_food', 1]] },
  open: 0.5, cold: { rate: 1.3, shelters: 3 },
  props: [{ kind: 'crate', w: 1.2, d: 1.2, h: 1.0, color: 0x5a6a78, count: 14 }, { kind: 'drift', w: 3.0, d: 1.6, h: 0.7, color: 0xe8f0f8, count: 14, soft: true }],
  ecology: [{ entity: 'stalker', where: 'near' }, { entity: 'stalker', where: 'far' }], notes: ids('arctic'), hides: 0.25,
};

const city: LevelSpec = {
  id: 'city', name: 'Endless City', act: 3, tier: 'uneasy', door: { color: '#7a8aa0', icon: 'Y' }, intensity: 0.4, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 0], ['concrete', 1], ['metal', 0], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x101624, fogDensity: 0.02, ambient: 0x2a3858, ambientIntensity: 0.5, lampColor: 0xffd090, grade: { tint: [0.95, 0.98, 1.12], saturation: 0.9, contrast: 1.12 }, dust: 0x9aa8c8 }),
  graph: { width: 140, depth: 110, rooms: 28, minRoom: 12, maxRoom: 30, wallHeight: 3.4, locks: 2, lockStyles: ['key', 'rope'], loops: 0.4, variants: 4, nests: 0, loot: 28 },
  open: 0.55,
  props: [{ kind: 'sign', w: 2.4, d: 0.3, h: 2.2, color: 0xc04040, count: 18 }, { kind: 'vent', w: 1.6, d: 1.6, h: 1.0, color: 0x5a5e66, count: 20 }],
  notes: ids('city'), hides: 0.2,
  extra(plan, rng) { populate(plan, rng, 'windowman', 5); },
};

const level94: LevelSpec = {
  id: 'level94', name: 'Level 94: Motion', anchor: 4, act: 3, tier: 'tense', door: { color: '#b0b0c0', icon: '94' }, intensity: 0.5, targetSeconds: [90, 2400],
  look: look({ walls: [['metal', 0], ['tile', 0], ['metal', 0], ['tile', 1]], floor: ['tile', 0], ceiling: ['metal', 0], trim: ['metal', 0], fogColor: 0x0c0e14, fogDensity: 0.025, ambient: 0x384050, ambientIntensity: 0.55, lampColor: 0xe8f0ff, grade: { tint: [0.95, 1.0, 1.1], saturation: 0.8, contrast: 1.15 }, dust: 0xd0d8e8 }),
  graph: { width: 100, depth: 80, rooms: 24, minRoom: 10, maxRoom: 22, wallHeight: 3.4, locks: 1, lockStyles: ['key'], loops: 0.5, variants: 4, nests: 0, loot: 24 },
  props: [{ kind: 'pillar', w: 0.8, d: 0.8, h: 3.4, color: 0x8a90a0, count: 14 }],
  notes: ids('level94'), hides: 0.2,
  extra(plan, rng) { populate(plan, rng, 'echo', 1); },
};

const gallery: LevelSpec = {
  id: 'gallery', name: 'Level 188: The Gallery', act: 3, tier: 'horror', door: { color: '#8a6a3a', icon: 'G' }, intensity: 0.65, targetSeconds: [90, 2400],
  look: look({ walls: [['wallpaper', 2], ['wallpaper', 0], ['wallpaper', 2], ['wallpaper', 0]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['concrete', 1], fogColor: 0x100a06, fogDensity: 0.035, ambient: 0x3a2a1a, ambientIntensity: 0.38, lampColor: 0xffd890, grade: { tint: [1.1, 0.96, 0.8], saturation: 1.0, contrast: 1.12 }, dust: 0xe0c890 }),
  graph: { width: 110, depth: 90, rooms: 28, minRoom: 9, maxRoom: 22, wallHeight: 3.6, locks: 2, lockStyles: ['sequence', 'key'], loops: 0.4, variants: 4, nests: 0, loot: 26 },
  portraits: { count: 26, wrong: 0.32 },
  props: [{ kind: 'plinth', w: 0.8, d: 0.8, h: 1.2, color: 0x8a8a84, count: 16 }],
  notes: ids('gallery'), hides: 0.3,
};

const chase: LevelSpec = {
  id: 'chase', name: 'Run for Your Life', act: 3, tier: 'horror', door: { color: '#c0301a', icon: 'R' }, intensity: 0.8, targetSeconds: [60, 1800],
  look: look({ walls: [['concrete', 1], ['wallpaper', 2], ['concrete', 1], ['wallpaper', 2]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x140606, fogDensity: 0.04, ambient: 0x401818, ambientIntensity: 0.4, lampColor: 0xff7050, grade: { tint: [1.15, 0.85, 0.8], saturation: 1.1, contrast: 1.15 }, dust: 0xd89080 }),
  graph: { width: 240, depth: 26, rooms: 14, minRoom: 12, maxRoom: 40, wallHeight: 3.4, locks: 0, loops: 0.15, variants: 4, nests: 0, loot: 14, lootTable: [['battery', 2], ['almond_water', 2], ['bandage', 2], ['cracker', 1]] },
  hallAspect: 1.6, notes: ids('chase'), hides: 0,
  extra(plan) {
    // the Pursuer starts just behind you (a neighbouring side room if there is one) and waits a short grace period
    const spawn = plan.spawn.room;
    const nb = plan.connections.filter((c) => c.a === spawn || c.b === spawn).map((c) => (c.a === spawn ? c.b : c.a)).find((r) => !plan.criticalPath.includes(r)) ?? plan.criticalPath[1];
    const r = plan.rooms[nb];
    plan.entitySlots.push({ room: nb, pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, role: 'ambush', entity: 'pursuer' });
  },
};

const finale: LevelSpec = {
  id: 'finale', name: 'The Finale', act: 3, tier: 'tense', door: { color: '#f0f0f0', icon: 'F' }, intensity: 0.45, targetSeconds: [60, 2400],
  look: look({ walls: [['wallpaper', 0], ['concrete', 0], ['wallpaper', 3], ['tile', 0]], floor: ['carpet', 0], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x0c0c10, fogDensity: 0.03, ambient: 0x5a5a60, ambientIntensity: 0.55, lampColor: 0xfff8e8, grade: { tint: [1.02, 1.0, 0.96], saturation: 0.9, contrast: 1.08 }, dust: 0xe8e8e0 }),
  graph: { width: 100, depth: 80, rooms: 24, minRoom: 9, maxRoom: 22, wallHeight: 3.4, locks: 1, lockStyles: ['key'], loops: 0.4, variants: 4, nests: 3, loot: 26 },
  ecology: [{ entity: 'stick', where: 'near' }, { entity: 'hound', where: 'far' }, { entity: 'howler', where: 'far' }], notes: ids('finale'), hides: 0.3,
  extra(plan) {
    plan.finale = true;
    const r = plan.rooms[plan.exit.room];
    plan.entitySlots.push({ room: r.id, pos: { x: plan.exit.pos.x + 1.6, z: plan.exit.pos.z }, role: 'ambush', entity: 'architect' });
  },
};

export const ACT3: LevelSpec[] = [metro, carnival, suburbs, wheatfield, arctic, city, level94, gallery, chase, finale];
export const act3Levels = ACT3.map(makeLevel);
