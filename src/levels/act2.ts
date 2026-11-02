/** Act 2 level specs (spec 8.2): Levels 6, 7, 8, the Garage, Level 37, Sewers, Hospital, Server Farm. */
import { makeLevel, type LevelSpec } from './factory';
import { LEVEL_NOTES } from '../story/notes';
import type { LevelLook } from '../gen/types';

const ids = (lvl: string) => LEVEL_NOTES(lvl).map((n) => n.id);
const look = (o: Partial<LevelLook> & Pick<LevelLook, 'walls' | 'floor' | 'ceiling' | 'trim'>): LevelLook => ({
  fogColor: 0x0a0a0c, fogDensity: 0.03, ambient: 0x303038, ambientIntensity: 0.4, lampColor: 0xfff0c0,
  grade: { tint: [1, 1, 1], saturation: 1, contrast: 1.05 }, dust: 0xcccccc, ...o,
});

// ---- Level 6: Lights Out (horror) ----
const level6: LevelSpec = {
  id: 'level6', name: 'Level 6: Lights Out', act: 2, tier: 'horror', door: { color: '#202020', icon: '6' }, intensity: 0.7, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 1], ['concrete', 1], ['wallpaper', 3], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['concrete', 1], trim: ['metal', 0], fogColor: 0x020203, fogDensity: 0.05, ambient: 0x10121a, ambientIntensity: 0.05, lampColor: 0xfff0c0, grade: { tint: [0.9, 0.95, 1.1], saturation: 0.8, contrast: 1.2 } }),
  graph: { width: 100, depth: 80, rooms: 26, minRoom: 8, maxRoom: 20, wallHeight: 3, locks: 1, lockStyles: ['key'], loops: 0.35, variants: 4, nests: 2, loot: 40, lootTable: [['battery', 5], ['almond_water', 2], ['glowstick', 3], ['flare', 1], ['bandage', 2], ['cracker', 1]] },
  lights: 'dark', beacons: true, hallAspect: 2.4,
  props: [{ kind: 'crate', w: 1.1, d: 1.1, h: 1.0, color: 0x3a3a3a, count: 14 }],
  ecology: [{ entity: 'lurker', where: 'near' }, { entity: 'lurker', where: 'far' }],
  notes: ids('level6'), hides: 0.35,
};

// ---- Level 7: Thalassophobia (tense) ----
const level7: LevelSpec = {
  id: 'level7', name: 'Level 7: Thalassophobia', act: 2, tier: 'tense', door: { color: '#2a5a7a', icon: '7' }, intensity: 0.55, targetSeconds: [90, 2400],
  look: look({ walls: [['metal', 0], ['concrete', 1], ['metal', 0], ['concrete', 1]], floor: ['metal', 0], ceiling: ['concrete', 1], trim: ['metal', 0], fogColor: 0x061418, fogDensity: 0.045, ambient: 0x1c3a48, ambientIntensity: 0.45, lampColor: 0xb8e4ff, grade: { tint: [0.85, 1.02, 1.1], saturation: 0.95, contrast: 1.1 }, dust: 0x9ac0d0 }),
  graph: { width: 120, depth: 80, rooms: 30, minRoom: 8, maxRoom: 22, wallHeight: 3.2, locks: 1, lockStyles: ['key'], loops: 0.35, variants: 4, nests: 1, loot: 34, lootTable: [['battery', 2], ['almond_water', 3], ['bandage', 2], ['cracker', 2], ['rope', 1], ['rag', 1]] },
  water: { wade: 0.15, swim: 0.5, flooded: 0.5 },
  props: [{ kind: 'crate', w: 1.2, d: 1.2, h: 1.0, color: 0x4a5a50, count: 14 }],
  ecology: [{ entity: 'leviathan', where: 'far' }],
  notes: ids('level7'), hides: 0.15,
};

// ---- Level 8: Cave System (tense) ----
const level8: LevelSpec = {
  id: 'level8', name: 'Level 8: Cave System', act: 2, tier: 'tense', door: { color: '#4a6a5a', icon: '8' }, intensity: 0.55, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 1], ['concrete', 1], ['concrete', 1], ['metal', 0]], floor: ['concrete', 1], ceiling: ['concrete', 1], trim: ['concrete', 1], fogColor: 0x040a0a, fogDensity: 0.05, ambient: 0x12302c, ambientIntensity: 0.3, lampColor: 0x80ffd0, grade: { tint: [0.85, 1.1, 1.05], saturation: 1.1, contrast: 1.1 }, dust: 0x80c0b0 }),
  graph: { width: 120, depth: 90, rooms: 32, minRoom: 7, maxRoom: 20, wallHeight: 3.4, locks: 2, lockStyles: ['rope', 'key'], loops: 0.4, variants: 4, nests: 2, loot: 34, lootTable: [['battery', 3], ['glowstick', 3], ['flare', 2], ['almond_water', 2], ['rope', 2], ['bandage', 2]] },
  props: [{ kind: 'glow', w: 0.7, d: 0.7, h: 1.3, color: 0x2a9a8a, count: 40 }, { kind: 'rock', w: 1.6, d: 1.0, h: 1.2, color: 0x3a3a36, count: 24 }],
  ecology: [{ entity: 'crawler', where: 'near' }, { entity: 'crawler', where: 'far' }],
  notes: ids('level8'), hides: 0.3,
};

// ---- The Garage (horror) ----
const garage: LevelSpec = {
  id: 'garage', name: 'The Garage', act: 2, tier: 'horror', door: { color: '#d88a2a', icon: 'G' }, intensity: 0.7, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 0], ['concrete', 1], ['concrete', 0], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['concrete', 0], trim: ['metal', 0], fogColor: 0x0a0804, fogDensity: 0.035, ambient: 0x3a2a14, ambientIntensity: 0.3, lampColor: 0xffa040, grade: { tint: [1.12, 0.95, 0.75], saturation: 1.05, contrast: 1.15 }, dust: 0xe0b070 }),
  graph: { width: 120, depth: 90, rooms: 30, minRoom: 10, maxRoom: 26, wallHeight: 2.6, locks: 3, lockStyles: ['breaker'], loops: 0.35, variants: 4, nests: 2, loot: 30, lootTable: [['battery', 3], ['almond_water', 2], ['glowstick', 2], ['bandage', 2], ['flare', 1], ['cracker', 1]] },
  lights: 'sections', flicker: 0.3,
  props: [{ kind: 'car', w: 4.2, d: 1.8, h: 1.4, color: 0x4a4a52, count: 30 }, { kind: 'pillar', w: 0.7, d: 0.7, h: 2.6, color: 0x6a6a64, count: 18 }],
  ecology: [{ entity: 'smiler', where: 'near' }, { entity: 'smiler', where: 'far' }],
  notes: ids('garage'), hides: 0.35,
};

// ---- Level 37: Poolrooms (chill) ----
const level37: LevelSpec = {
  id: 'level37', name: 'Level 37: Poolrooms', anchor: 3, act: 2, tier: 'chill', door: { color: '#6ad8d0', icon: '37' }, intensity: 0.12, targetSeconds: [90, 2400],
  look: look({ walls: [['tile', 1], ['tile', 1], ['tile', 0], ['tile', 1]], floor: ['tile', 1], ceiling: ['ceiling', 0], trim: ['tile', 0], fogColor: 0x0a2a2c, fogDensity: 0.02, ambient: 0x5ac0c0, ambientIntensity: 0.7, lampColor: 0xc8ffff, grade: { tint: [0.9, 1.08, 1.1], saturation: 1.1, contrast: 1.02 }, dust: 0xb0f0f0 }),
  graph: { width: 100, depth: 80, rooms: 26, minRoom: 10, maxRoom: 22, wallHeight: 4, locks: 1, lockStyles: ['key'], loops: 0.4, variants: 4, nests: 1, loot: 24, lootTable: [['almond_water', 4], ['battery', 2], ['bandage', 2], ['cracker', 2]] },
  water: { wade: 0.25, swim: 0.35, flooded: 0.4 },
  ecology: [{ entity: 'drowned', where: 'far' }],
  notes: ids('level37'), hides: 0.1,
  extra(plan) {
    // the optional scary sublevel: the Drowned's nest holds a cache and is flooded
    const nest = plan.rooms.find((r) => r.kind === 'nest');
    if (!nest) return;
    if (!plan.water?.some((w) => w.room === nest.id)) (plan.water ??= []).push({ room: nest.id, depth: 'swim' });
    for (let i = 0; i < 8; i++) plan.items.push({ id: `item${plan.items.length}`, item: i % 2 ? 'almond_water' : 'battery', kind: 'tool', room: nest.id, pos: { x: nest.x + 1.5 + (i % 4) * ((nest.w - 3) / 4), z: nest.z + 1.5 + Math.floor(i / 4) * ((nest.d - 3) / 2) } });
  },
};

// ---- Sewers (tense) ----
const sewers: LevelSpec = {
  id: 'sewers', name: 'Sewers', act: 2, tier: 'tense', door: { color: '#5a6a3a', icon: 'W' }, intensity: 0.55, targetSeconds: [90, 2400],
  look: look({ walls: [['concrete', 1], ['concrete', 1], ['metal', 0], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['concrete', 1], trim: ['metal', 0], fogColor: 0x0c1206, fogDensity: 0.05, ambient: 0x2a3418, ambientIntensity: 0.4, lampColor: 0xd0e890, grade: { tint: [0.95, 1.08, 0.85], saturation: 1.0, contrast: 1.1 }, dust: 0xa0b070 }),
  graph: { width: 130, depth: 70, rooms: 32, minRoom: 5, maxRoom: 22, wallHeight: 3, locks: 2, lockStyles: ['valves', 'key'], loops: 0.35, variants: 4, nests: 2, loot: 32, lootTable: [['battery', 2], ['bottle', 2], ['rag', 2], ['can', 2], ['purify_tablet', 2], ['dirty_water', 2], ['bandage', 2], ['almond_water', 2]] },
  water: { wade: 0.55, swim: 0.1, flooded: 0.2, sludge: true }, acoustics: { damping: 0.7 },
  props: [{ kind: 'pipe', w: 6, d: 0.5, h: 0.5, color: 0x4a5a3a, count: 16 }],
  ecology: [{ entity: 'leech', where: 'near' }, { entity: 'hound', where: 'far' }],
  notes: ids('sewers'), hides: 0.25,
};

// ---- Hospital (horror) ----
const hospital: LevelSpec = {
  id: 'hospital', name: 'Hospital', act: 2, tier: 'horror', door: { color: '#a8d0c8', icon: 'H' }, intensity: 0.7, targetSeconds: [90, 2400],
  look: look({ walls: [['tile', 0], ['wallpaper', 3], ['tile', 0], ['concrete', 0]], floor: ['tile', 0], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x0a100e, fogDensity: 0.035, ambient: 0x4a2a2a, ambientIntensity: 0.38, lampColor: 0xd8fff0, grade: { tint: [1.0, 1.05, 1.0], saturation: 0.85, contrast: 1.12 }, dust: 0xd8e8e0 }),
  graph: { width: 110, depth: 90, rooms: 36, minRoom: 6, maxRoom: 18, wallHeight: 3, locks: 2, lockStyles: ['key'], loops: 0.4, variants: 4, nests: 1, loot: 32, lootTable: [['bandage', 4], ['battery', 2], ['almond_water', 2], ['cracker', 2], ['glowstick', 1]] },
  flicker: 0.5,
  props: [{ kind: 'bed', w: 2.0, d: 0.9, h: 0.8, color: 0x9aa8a4, count: 40 }, { kind: 'gurney', w: 1.9, d: 0.7, h: 0.9, color: 0x707a78, count: 10 }],
  ecology: [{ entity: 'faceling', where: 'far' }],
  notes: ids('hospital'), hides: 0.4,
  extra(plan, rng) {
    // patient-record puzzle: the ward question only staff (real patients/nurses) answer correctly
    const wards = ['East', 'West', 'North', 'South'];
    const answer = rng.pick(wards); const wrong = wards.find((w) => w !== answer)!;
    plan.verify = { question: 'Which ward is bed 12 in?', answer: `${answer} ward`, wrong: `${wrong} ward` };
    plan.noteText = { ...(plan.noteText ?? {}), hp_ward: { title: 'Patient record, torn', text: `Bed 12, ${answer} Ward, Mr. Alder. Allergic to almonds, which is funny here. Visiting hours are a lie.` } };
    const spots = plan.rooms.filter((r) => r.kind === 'room' && r.id !== plan.spawn.room && r.id !== plan.exit.room);
    for (let i = 0; i < 2 && spots.length; i++) { const r = rng.pick(spots); plan.entitySlots.push({ room: r.id, pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, role: 'ambush', entity: 'coworker' }); }
  },
};

// ---- Server Farm (tense) ----
const serverfarm: LevelSpec = {
  id: 'serverfarm', name: 'Server Farm', act: 2, tier: 'tense', door: { color: '#3a8aa8', icon: 'SF' }, intensity: 0.55, targetSeconds: [90, 2400],
  look: look({ walls: [['metal', 0], ['concrete', 0], ['metal', 0], ['concrete', 0]], floor: ['metal', 0], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x060a12, fogDensity: 0.03, ambient: 0x203048, ambientIntensity: 0.4, lampColor: 0xa8d8ff, grade: { tint: [0.9, 1.0, 1.15], saturation: 1.0, contrast: 1.12 }, dust: 0x90b0e0 }),
  graph: { width: 110, depth: 90, rooms: 32, minRoom: 8, maxRoom: 22, wallHeight: 3.4, locks: 2, lockStyles: ['sequence', 'key'], loops: 0.35, variants: 4, nests: 2, loot: 30, lootTable: [['battery', 3], ['almond_water', 2], ['cracker', 2], ['bandage', 2], ['rope', 1]] },
  props: [{ kind: 'rack', w: 0.9, d: 1.0, h: 2.2, color: 0x2a2e36, count: 56 }, { kind: 'cable', w: 3, d: 0.3, h: 0.15, color: 0x1a1a1e, count: 20 }],
  ecology: [{ entity: 'static', where: 'near' }, { entity: 'static', where: 'far' }],
  notes: ids('serverfarm'), hides: 0.3,
};

export const ACT2: LevelSpec[] = [level6, level7, level8, garage, level37, sewers, hospital, serverfarm];
export const act2Levels = ACT2.map(makeLevel);
