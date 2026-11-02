/** Act 1 level specs (spec 8.2): Levels 1-5 and the Schoolhouse, built with the level factory. */
import { makeLevel, type LevelSpec } from './factory';
import { LEVEL_NOTES } from '../story/notes';
import { Rng } from '../gen/rng';
import type { LevelLook, LevelPlan, RuleDef } from '../gen/types';

const ids = (lvl: string) => LEVEL_NOTES(lvl).map((n) => n.id);
const look = (o: Partial<LevelLook> & Pick<LevelLook, 'walls' | 'floor' | 'ceiling' | 'trim'>): LevelLook => ({
  fogColor: 0x0e0e0c, fogDensity: 0.03, ambient: 0x444438, ambientIntensity: 0.42, lampColor: 0xfff0c0,
  grade: { tint: [1, 1, 1], saturation: 1, contrast: 1.04 }, dust: 0xcccccc, ...o,
});

// ---------------- Level 1: Habitable Zone ----------------
const level1: LevelSpec = {
  id: 'level1', name: 'Level 1: Habitable Zone', act: 1, tier: 'uneasy', door: { color: '#9a9a90', icon: '1' }, intensity: 0.4, targetSeconds: [90, 2000],
  look: look({ walls: [['concrete', 0], ['concrete', 1], ['concrete', 0], ['concrete', 1]], floor: ['concrete', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x0b0d0f, fogDensity: 0.028, lampColor: 0xffd9a0, grade: { tint: [0.95, 1.0, 1.05], saturation: 0.9, contrast: 1.08 } }),
  graph: { width: 130, depth: 100, rooms: 26, minRoom: 12, maxRoom: 30, wallHeight: 5.5, locks: 1, lockStyles: ['pry'], loops: 0.3, variants: 4, nests: 2, loot: 44, lootTable: [['battery', 3], ['almond_water', 3], ['can', 3], ['rag', 2], ['bottle', 2], ['rope', 2], ['canned_food', 2], ['bandage', 2], ['flare', 1], ['cracker', 2]] },
  props: [{ kind: 'rack', w: 3.2, d: 0.9, h: 3.4, color: 0x59636b, count: 40 }, { kind: 'crate', w: 1.1, d: 1.1, h: 1.0, color: 0x6b5a3e, count: 24 }],
  ecology: [{ entity: 'hound', where: 'near' }, { entity: 'hound', where: 'far' }],
  notes: ids('level1'), hides: 0.4,
  // the survivors' camp: radio, can opener, and Pim, who can come along
  guaranteed: [{ item: 'radio', count: 1, where: 'supply' }, { item: 'can_opener', count: 1, where: 'supply' }],
  extra(plan) {
    const camp = plan.rooms.find((r) => r.kind === 'supply');
    if (!camp) return;
    plan.entitySlots.push({ room: camp.id, pos: { x: camp.x + camp.w - 2.2, z: camp.z + 2.2 }, role: 'ambush', entity: 'companion' });
  },
};

// ---------------- Level 2: Pipe Dreams ----------------
const level2: LevelSpec = {
  id: 'level2', name: 'Level 2: Pipe Dreams', anchor: 2, act: 1, tier: 'tense', door: { color: '#c97a3a', icon: '2' }, intensity: 0.55, targetSeconds: [90, 2200],
  look: look({ walls: [['concrete', 1], ['metal', 0], ['concrete', 1], ['metal', 0]], floor: ['metal', 0], ceiling: ['concrete', 1], trim: ['metal', 0], fogColor: 0x1a1008, fogDensity: 0.055, ambient: 0x4a3018, ambientIntensity: 0.4, lampColor: 0xff9a50, grade: { tint: [1.1, 0.95, 0.8], saturation: 1.05, contrast: 1.1 }, dust: 0xd8c0a0 }),
  graph: { width: 140, depth: 70, rooms: 34, minRoom: 5, maxRoom: 22, wallHeight: 3.2, locks: 2, lockStyles: ['valves', 'key'], loops: 0.3, variants: 4, nests: 2, loot: 36, lootTable: [['bottle', 3], ['can', 3], ['rag', 3], ['rope', 2], ['battery', 2], ['almond_water', 2], ['bandage', 2], ['cracker', 1]] },
  acoustics: { damping: 0.8 },
  props: [{ kind: 'pipe', w: 7, d: 0.5, h: 0.5, color: 0x6b4a32, count: 30 }, { kind: 'boiler', w: 1.6, d: 1.6, h: 2.2, color: 0x4a4038, count: 8 }],
  ecology: [{ entity: 'howler', where: 'near' }, { entity: 'hound', where: 'far' }],
  notes: ids('level2'), hides: 0.35,
};

// ---------------- Level 3: Electrical Station (chill, entity-free) ----------------
const level3: LevelSpec = {
  id: 'level3', name: 'Level 3: Electrical Station', act: 1, tier: 'chill', door: { color: '#5aa0e0', icon: '3' }, intensity: 0.15, targetSeconds: [90, 2000],
  look: look({ walls: [['concrete', 0], ['metal', 0], ['concrete', 0], ['metal', 0]], floor: ['concrete', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x080c12, fogDensity: 0.03, ambient: 0x2a3a52, ambientIntensity: 0.5, lampColor: 0xcfe4ff, grade: { tint: [0.9, 1.0, 1.12], saturation: 0.95, contrast: 1.08 }, dust: 0xb8d0f0 }),
  graph: { width: 110, depth: 90, rooms: 30, minRoom: 8, maxRoom: 22, wallHeight: 4, locks: 3, lockStyles: ['fuse'], loops: 0.3, variants: 4, nests: 0, loot: 30 },
  props: [{ kind: 'transformer', w: 2.2, d: 1.8, h: 2.8, color: 0x3a4a5a, count: 22 }, { kind: 'cabinet', w: 1.0, d: 0.6, h: 2.0, color: 0x5a5a52, count: 16 }],
  notes: ids('level3'), hides: 0.15,
  extra(plan) {
    // the reward: the stockroom just past the last fuse gate becomes a big supply room
    const last = plan.connections.filter((c) => c.lock).sort((a, b) => plan.criticalPath.indexOf(a.b) - plan.criticalPath.indexOf(b.b)).pop();
    if (!last) return;
    const idx = Math.max(plan.criticalPath.indexOf(last.a), plan.criticalPath.indexOf(last.b));
    const room = plan.rooms[plan.criticalPath[Math.min(idx, plan.criticalPath.length - 2)]];
    if (room.kind === 'room' || room.kind === 'hall') room.kind = 'supply';
    const rng = new Rng(plan.seed ^ 0x3333);
    for (let i = 0; i < 12; i++) plan.items.push({ id: `item${plan.items.length}`, item: rng.weighted([['battery', 3], ['almond_water', 3], ['bandage', 2], ['cracker', 2], ['glowstick', 2], ['canned_food', 1]]), kind: 'loot', room: room.id, pos: { x: room.x + 1.5 + rng.next() * Math.max(0.1, room.w - 3), z: room.z + 1.5 + rng.next() * Math.max(0.1, room.d - 3) } });
  },
};

// ---------------- Level 4: Abandoned Offices ----------------
const level4: LevelSpec = {
  id: 'level4', name: 'Level 4: Abandoned Offices', act: 1, tier: 'tense', door: { color: '#a8b0a0', icon: '4' }, intensity: 0.5, targetSeconds: [90, 2200],
  look: look({ walls: [['wallpaper', 3], ['wallpaper', 1], ['wallpaper', 3], ['concrete', 0]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x0c110e, fogDensity: 0.03, ambient: 0x384238, ambientIntensity: 0.45, lampColor: 0xe4ffe0, grade: { tint: [0.95, 1.04, 0.95], saturation: 0.92, contrast: 1.06 }, dust: 0xc8d8c0 }),
  graph: { width: 110, depth: 90, rooms: 36, minRoom: 7, maxRoom: 18, wallHeight: 2.9, locks: 2, lockStyles: ['key'], loops: 0.45, variants: 4, nests: 1, loot: 34, lootTable: [['battery', 3], ['almond_water', 2], ['cracker', 3], ['bandage', 2], ['paper', 2], ['marker_pen', 1], ['glowstick', 1]] },
  props: [{ kind: 'desk', w: 1.6, d: 0.8, h: 1.1, color: 0x6a6a60, count: 46 }, { kind: 'copier', w: 1.2, d: 0.8, h: 1.2, color: 0x8a8a84, count: 6 }],
  ecology: [{ entity: 'skinstealer', where: 'far' }],
  notes: ids('level4'), hides: 0.5,
  extra(plan, rng) {
    // real coworkers wander; one badge answer decides who is real
    const badge = String(rng.int(1000, 9999)); let wrong = String(rng.int(1000, 9999)); if (wrong === badge) wrong = String(Number(badge) + 11);
    plan.verify = { question: 'What is the badge number on the break room corkboard?', answer: badge, wrong };
    plan.noteText = { ...(plan.noteText ?? {}), l4_cork: { title: 'Corkboard flyer', text: `EMPLOYEE VERIFICATION\\nBadge number on this board: ${badge}\\nAsk anyone unfamiliar. Real staff know it.` } };
    const spots = plan.rooms.filter((r) => r.kind === 'room' && r.id !== plan.spawn.room && r.id !== plan.exit.room);
    for (let i = 0; i < 2 && spots.length; i++) { const r = rng.pick(spots); plan.entitySlots.push({ room: r.id, pos: { x: r.x + r.w / 2, z: r.z + r.d / 2 }, role: 'ambush', entity: 'coworker' }); }
  },
};

// ---------------- Level 5: Terror Hotel ----------------
const RULE_POOL: Omit<RuleDef, 'real' | 'id'>[] = [
  { kind: 'noRunning', text: 'NO RUNNING IN THE CORRIDORS.' },
  { kind: 'noLight', text: 'AFTER MIDNIGHT, NO FLASHLIGHTS IN THE CORRIDORS.' },
  { kind: 'noNoise', text: 'GUESTS ARE KINDLY REQUESTED TO BE QUIET.' },
  { kind: 'noKnock', text: 'ALWAYS KNOCK BEFORE ENTERING A ROOM.' },
];
const level5: LevelSpec = {
  id: 'level5', name: 'Level 5: Terror Hotel', act: 1, tier: 'tense', door: { color: '#8a2a3a', icon: '5' }, intensity: 0.5, targetSeconds: [90, 2200],
  look: look({ walls: [['wallpaper', 2], ['wallpaper', 2], ['wallpaper', 0], ['concrete', 0]], floor: ['carpet', 1], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x120808, fogDensity: 0.04, ambient: 0x3a1c20, ambientIntensity: 0.4, lampColor: 0xffc890, grade: { tint: [1.1, 0.92, 0.88], saturation: 1.08, contrast: 1.1 }, dust: 0xd8a890 }),
  graph: { width: 130, depth: 56, rooms: 36, minRoom: 5, maxRoom: 28, wallHeight: 3, locks: 2, lockStyles: ['key'], loops: 0.35, variants: 4, nests: 1, loot: 32 },
  props: [{ kind: 'cart', w: 1.3, d: 0.7, h: 1.1, color: 0x6a5a3a, count: 14 }],
  hallAspect: 1.6,
  ecology: [{ entity: 'hound', where: 'far' }],
  notes: ids('level5').filter((i) => i === 'l5_welcome' || i === 'l5_bell'), hides: 0.35,
  extra(plan, rng) {
    // 4 posted rules: exactly 2 are enforced. Guest register scraps let you deduce which.
    const chosen = rng.shuffle([...RULE_POOL.keys()]);
    const realKinds = new Set<string>(['noKnock'].includes(RULE_POOL[chosen[0]].kind) ? [] : [RULE_POOL[chosen[0]].kind]);
    const enforceable = chosen.filter((i) => RULE_POOL[i].kind !== 'noKnock');
    realKinds.add(RULE_POOL[enforceable[0]].kind); realKinds.add(RULE_POOL[enforceable[1]].kind);
    const rules: RuleDef[] = RULE_POOL.map((r, i) => ({ ...r, id: `rule${i}`, real: realKinds.has(r.kind) }));
    plan.rules = rules;
    plan.noteText = plan.noteText ?? {};
    const clue = { noRunning: ['l5_guest1', 'The man in 214 ran down the hall to catch the ice machine. We found his shoes.'], noLight: ['l5_guest2', 'A woman in 307 walked the corridors all night with a flashlight and nothing happened.'], noNoise: ['l5_guest3', 'The couple in 119 were loud all night. Nothing happened. We should have expected that.'] } as const;
    const realClues: Record<string, string> = { noRunning: 'The man in 214 ran down the hall to catch the ice machine. We found his shoes.', noLight: 'A man in 308 flashed his light down the corridor after midnight. The bell rang for him.', noNoise: 'The couple in 119 shouted down the hall. The bell rang, and rang.' };
    const falseClues: Record<string, string> = { noRunning: 'The woman in 214 ran the whole corridor for her morning exercise. Nothing happened.', noLight: 'A woman in 307 walked the corridors all night with a flashlight. The desk stayed silent.', noNoise: 'The couple in 119 were loud all night. Nothing happened.', noKnock: 'Nobody has ever knocked in this hotel. Nothing has ever answered.' };
    const spots = rng.shuffle(plan.rooms.filter((r) => r.kind !== 'exit' && r.kind !== 'nest'));
    rules.forEach((r, i) => {
      const room = spots[i % spots.length];
      const nid = `rule_post${i}`, cid = `rule_clue${i}`;
      plan.noteText![nid] = { title: `Posted rule ${i + 1}`, text: r.text };
      plan.noteText![cid] = { title: 'Guest register scrap', text: r.real ? realClues[r.kind] ?? falseClues[r.kind] : falseClues[r.kind] };
      for (const [id, off] of [[nid, 0], [cid, 1.2]] as const) plan.items.push({ id: `note${plan.items.length}`, item: id, kind: 'note', room: room.id, pos: { x: room.x + 1.6 + (off as number) + rng.next() * Math.max(0.1, room.w - 4), z: room.z + 1.6 + rng.next() * Math.max(0.1, room.d - 3.2) } });
    });
    void clue;
  },
};

// ---------------- Schoolhouse ----------------
const schoolhouse: LevelSpec = {
  id: 'schoolhouse', name: 'Schoolhouse', act: 1, tier: 'uneasy', door: { color: '#7a9a6a', icon: 'S' }, intensity: 0.35, targetSeconds: [90, 2000],
  look: look({ walls: [['wallpaper', 3], ['wallpaper', 1], ['concrete', 0], ['wallpaper', 3]], floor: ['tile', 0], ceiling: ['ceiling', 0], trim: ['metal', 0], fogColor: 0x0d110c, fogDensity: 0.026, ambient: 0x3c4a38, ambientIntensity: 0.46, lampColor: 0xf4ffd8, grade: { tint: [0.96, 1.04, 0.94], saturation: 0.95, contrast: 1.05 }, dust: 0xc8d0b8 }),
  graph: { width: 110, depth: 90, rooms: 34, minRoom: 7, maxRoom: 20, wallHeight: 3.2, locks: 1, lockStyles: ['key'], loops: 0.4, variants: 4, nests: 0, loot: 30, lootTable: [['battery', 2], ['almond_water', 3], ['cracker', 3], ['bandage', 2], ['paper', 3], ['marker_pen', 1], ['glowstick', 1]] },
  props: [{ kind: 'desk', w: 1.2, d: 0.6, h: 0.8, color: 0x7a6a4a, count: 36 }, { kind: 'locker_row', w: 3, d: 0.5, h: 1.9, color: 0x4a6a58, count: 12 }],
  ecology: [{ entity: 'monitor', where: 'path', index: 0 }, { entity: 'monitor', where: 'path', index: 2 }],
  notes: ids('schoolhouse'), hides: 0.45,
  guaranteed: [{ item: 'hall_pass', count: 1, where: 'deadend' }, { item: 'paper', count: 1, where: 'any' }, { item: 'marker_pen', count: 1, where: 'any' }],
};

export const ACT1: LevelSpec[] = [level1, level2, level3, level4, level5, schoolhouse];
export const act1Levels = ACT1.map(makeLevel);
export type { LevelPlan };
