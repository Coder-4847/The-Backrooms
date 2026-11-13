/**
 * Level 0, The Lobby (Uneasy). Endless damp-carpet yellow rooms, buzzing fluorescents, wallpaper
 * variants. Signature entity: Stick. Late cameo: Hounds. Mechanic: learn the basics, find the humming
 * wrong wall. Built on the shared graph generator plus Level 0 dressing: lockers to hide in, notes,
 * a seeded ecology (stick near the start of the route, hound pack in the farthest nest).
 */
import { generateGraphLevel } from '../gen/graph';
import { addAnchor } from './factory';
import { Rng, deriveSeed } from '../gen/rng';
import { LEVEL_NOTES } from '../story/notes';
import type { HideSpot, ItemSpawn, LevelDef, LevelPlan } from '../gen/types';

const NOTE_COUNT = 4; // a handful of story notes pinned to walls, not litter on every floor

function dress(plan: LevelPlan): LevelPlan {
  const rng = new Rng(deriveSeed(plan.seed, 'level0:dress'));
  const rooms = plan.rooms;
  for (const r of rooms) if (r.kind === 'room' && Math.max(r.w / r.d, r.d / r.w) > 2.2) r.kind = 'hall';

  // lockers in room corners, away from doors, waypoints and items so they never block anything
  const hides: HideSpot[] = [];
  for (const r of rooms) {
    if (r.kind === 'start' || r.kind === 'exit' || r.w * r.d < 40 || !rng.chance(0.45)) continue;
    const corners = rng.shuffle([[r.x + 0.6, r.z + 0.6], [r.x + r.w - 0.6, r.z + 0.6], [r.x + 0.6, r.z + r.d - 0.6], [r.x + r.w - 0.6, r.z + r.d - 0.6]]);
    const ok = (cx: number, cz: number) =>
      plan.connections.every((c) => Math.hypot(c.door.x - cx, c.door.z - cz) > 2.4) &&
      plan.waypoints.every((w) => Math.hypot(w.pos.x - cx, w.pos.z - cz) > 2.2) &&
      plan.items.every((i) => Math.hypot(i.pos.x - cx, i.pos.z - cz) > 1.4) &&
      plan.entitySlots.every((s) => Math.hypot(s.pos.x - cx, s.pos.z - cz) > 1.5);
    const c = corners.find(([cx, cz]) => ok(cx, cz));
    if (!c) continue;
    const mx = r.x + r.w / 2, mz = r.z + r.d / 2;
    hides.push({ id: `hide${hides.length}`, room: r.id, pos: { x: c[0], z: c[1] }, kind: rng.chance(0.7) ? 'locker' : 'desk', yaw: Math.atan2(-(mx - c[0]), -(mz - c[1])) });
  }
  plan.hides = hides;

  // notes: one near the start, the rest scattered (never in nests)
  const noteIds = LEVEL_NOTES('level0').map((n) => n.id);
  const spots = rng.shuffle(rooms.filter((r) => r.kind !== 'nest' && r.kind !== 'exit'));
  const first = rooms[plan.spawn.room];
  const notes: ItemSpawn[] = [];
  for (let i = 0; i < Math.min(NOTE_COUNT, noteIds.length); i++) {
    const r = i === 0 ? first : spots[i];
    const pos = { x: r.x + 1.5 + rng.next() * Math.max(0.1, r.w - 3), z: r.z + 1.5 + rng.next() * Math.max(0.1, r.d - 3) };
    notes.push({ id: `note${i}`, item: noteIds[i], kind: 'note', room: r.id, pos });
  }
  plan.items.push(...notes);
  addAnchor(plan, rng, 1);
  plan.items.push({ id: `note${plan.items.length}`, item: 'l0_secret', kind: 'note', room: first.id, pos: { x: first.x + 2 + rng.next() * Math.max(0.1, first.w - 4), z: first.z + 2 + rng.next() * Math.max(0.1, first.d - 4) } });

  // ecology: the nearer nest holds the Stick, the farthest holds the hound pack (late cameo)
  const nests = plan.entitySlots.filter((s) => s.role === 'nest');
  const dFrom = (s: { pos: { x: number; z: number } }) => Math.hypot(s.pos.x - plan.spawn.pos.x, s.pos.z - plan.spawn.pos.z);
  nests.sort((a, b) => dFrom(a) - dFrom(b));
  if (nests[0]) nests[0].entity = 'stick';
  if (nests.length > 1) nests[nests.length - 1].entity = 'hound';
  // keep patrol slots data-only for later levels; drop ones without an entity to keep the plan tidy
  plan.entitySlots = plan.entitySlots.filter((s) => s.entity);
  return plan;
}

export const level0: LevelDef = {
  id: 'level0',
  name: 'Level 0: The Lobby',
  act: 1,
  tier: 'uneasy',
  door: { color: '#d8c43c', icon: '0' },
  targetSeconds: [90, 1500],
  intensity: 0.35,
  look: { // mono-yellow wallpaper everywhere: the Lobby's signature
    walls: [['wallpaper', 0], ['wallpaper', 1], ['wallpaper', 2], ['wallpaper', 0]], floor: ['carpet', 0], ceiling: ['ceiling', 0], trim: ['concrete', 1],
    fogColor: 0x1b1708, fogDensity: 0.03, ambient: 0x4a4218, ambientIntensity: 0.42, lampColor: 0xfff0b8,
    grade: { tint: [1.1, 1.03, 0.74], saturation: 1.22, contrast: 1.06 }, dust: 0xd8c890,
  },
  generate(seed) {
    return dress(generateGraphLevel(seed, {
      // the tutorial level: smaller than it used to be (44 rooms -> 30), with the key kept near the route
      levelId: 'level0', tier: 'uneasy', width: 100, depth: 84, rooms: 30, minRoom: 6, maxRoom: 16,
      wallHeight: 3, locks: 1, loops: 0.35, variants: 4, nests: 2, loot: 26, keyBias: 'near',
    }));
  },
};
