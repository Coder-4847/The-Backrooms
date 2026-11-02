/**
 * Level factory: a level is a data spec (size, look, locks, props, ecology, notes, guaranteed
 * items) turned into a LevelDef on top of the shared graph generator. Props, hides, notes and
 * entity slots are placed with order-independent seeded RNG and never block doors or nav nodes.
 */
import { generateGraphLevel, type GraphOptions } from '../gen/graph';
import { Rng, deriveSeed } from '../gen/rng';
import type { HideSpot, ItemSpawn, LevelDef, LevelLook, LevelPlan, PropDef, Room, Vec2 } from '../gen/types';

export interface PropSpec { kind: string; w: number; d: number; h: number; color: number; count: number }
export interface Ecology { entity: string; where: 'near' | 'far' | 'path'; /** which path slot (0-based) when where = 'path' */ index?: number }
export interface Guaranteed { item: string; count: number; where: 'supply' | 'any' | 'far' | 'deadend'; kind?: ItemSpawn['kind'] }

export interface LevelSpec {
  id: string; name: string; act: 1 | 2 | 3; tier: LevelPlan['tier'];
  door: { color: string; icon: string };
  intensity: number; targetSeconds: [number, number];
  look: LevelLook;
  graph: Omit<GraphOptions, 'levelId' | 'tier'>;
  props?: PropSpec[];
  ecology?: Ecology[];
  /** Static note ids (story/notes.ts) scattered through the level; the first goes near the start. */
  notes?: string[];
  hides?: number;
  acoustics?: { damping: number };
  extra?: (plan: LevelPlan, rng: Rng) => void;
  guaranteed?: Guaranteed[];
  /** Rooms longer than this aspect ratio count as corridors/halls (rules, patrols). Default 2.2. */
  hallAspect?: number;
}

const cen = (r: Room): Vec2 => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
const randIn = (r: Room, rng: Rng, m = 1.5): Vec2 => ({ x: r.x + m + rng.next() * Math.max(0.1, r.w - 2 * m), z: r.z + m + rng.next() * Math.max(0.1, r.d - 2 * m) });

/** Points of interest props must stay clear of. */
function keepClear(plan: LevelPlan): { p: Vec2; r: number }[] {
  const out: { p: Vec2; r: number }[] = [];
  for (const c of plan.connections) out.push({ p: c.door, r: 2.8 });
  for (const n of plan.nav.nodes) out.push({ p: n.pos, r: 1.7 });
  for (const w of plan.waypoints) out.push({ p: w.pos, r: 2 });
  for (const i of plan.items) out.push({ p: i.pos, r: 1.3 });
  for (const s of plan.entitySlots) out.push({ p: s.pos, r: 1.5 });
  for (const pz of plan.puzzles ?? []) for (const pt of pz.parts) out.push({ p: pt.pos, r: 1.6 });
  out.push({ p: plan.spawn.pos, r: 2 }, { p: plan.exit.pos, r: 2 });
  return out;
}

const segDist = (px: number, pz: number, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
};

/** Straight paths that must stay open: nav edges and the walks from each room centre to things you can interact with. */
function keepOpen(plan: LevelPlan): [Vec2, Vec2][] {
  const segs: [Vec2, Vec2][] = plan.nav.edges.map((e) => [plan.nav.nodes[e.a].pos, plan.nav.nodes[e.b].pos]);
  const pois: { room: number; pos: Vec2 }[] = [...plan.items.map((i) => ({ room: i.room, pos: i.pos })), ...plan.waypoints.map((w) => ({ room: w.room, pos: w.pos })), ...plan.entitySlots.map((e) => ({ room: e.room, pos: e.pos })),
    ...(plan.puzzles ?? []).flatMap((pz) => pz.parts.map((pt) => ({ room: pt.room, pos: pt.pos }))), { room: plan.exit.room, pos: plan.exit.pos }];
  // the bot (and entities) may walk to a point straight from any nav node in the same room
  for (const q of pois) for (const n of plan.nav.nodes) if (n.room === q.room) segs.push([n.pos, q.pos]);
  return segs;
}

export function addProps(plan: LevelPlan, rng: Rng, specs: PropSpec[]): void {
  const props: PropDef[] = plan.props ?? [];
  const clear = keepClear(plan);
  const open = keepOpen(plan);
  for (const s of specs) {
    let placed = 0, tries = 0;
    while (placed < s.count && tries++ < s.count * 30) {
      const r = rng.pick(plan.rooms);
      if (r.w * r.d < 30 || r.kind === 'start' || r.kind === 'exit') continue;
      // hug a wall: pick a side, position along it
      const side = rng.int(0, 3);
      const along = rng.range(1.2, (side < 2 ? r.w : r.d) - 1.2);
      const gap = 0.2 + 0.12 + s.d / 2;
      let x = 0, z = 0, w = s.w, d = s.d;
      if (side === 0) { x = r.x + along; z = r.z + gap; } else if (side === 1) { x = r.x + along; z = r.z + r.d - gap; }
      else { w = s.d; d = s.w; x = r.x + gap; z = r.z + along; if (side === 3) x = r.x + r.w - gap; }
      if (x - w / 2 < r.x + 0.3 || x + w / 2 > r.x + r.w - 0.3 || z - d / 2 < r.z + 0.3 || z + d / 2 > r.z + r.d - 0.3) continue;
      if (clear.some((c) => Math.hypot(c.p.x - x, c.p.z - z) < c.r + Math.max(w, d) / 2)) continue;
      if (open.some(([a, b]) => segDist(x, z, a, b) < 1.0 + Math.max(w, d) / 2)) continue;
      if (props.some((q) => Math.abs(q.x - x) < (q.w + w) / 2 + 0.5 && Math.abs(q.z - z) < (q.d + d) / 2 + 0.5)) continue;
      props.push({ kind: s.kind, x, z, w, d, h: s.h, color: s.color });
      placed++;
    }
  }
  plan.props = props;
}

export function addHides(plan: LevelPlan, rng: Rng, prob: number): void {
  const hides: HideSpot[] = [];
  const clear = keepClear(plan);
  for (const r of plan.rooms) {
    if (r.kind === 'start' || r.kind === 'exit' || r.w * r.d < 40 || !rng.chance(prob)) continue;
    const corners = rng.shuffle([[r.x + 0.6, r.z + 0.6], [r.x + r.w - 0.6, r.z + 0.6], [r.x + 0.6, r.z + r.d - 0.6], [r.x + r.w - 0.6, r.z + r.d - 0.6]]);
    const ok = (cx: number, cz: number) =>
      clear.every((c) => c.p === plan.spawn.pos || Math.hypot(c.p.x - cx, c.p.z - cz) > Math.min(c.r, 2.4)) &&
      (plan.props ?? []).every((q) => Math.abs(q.x - cx) > q.w / 2 + 0.9 && Math.abs(q.z - cz) > q.d / 2 + 0.9);
    const c = corners.find(([cx, cz]) => ok(cx, cz));
    if (!c) continue;
    const m = cen(r);
    hides.push({ id: `hide${hides.length}`, room: r.id, pos: { x: c[0], z: c[1] }, kind: rng.chance(0.7) ? 'locker' : 'desk', yaw: Math.atan2(-(m.x - c[0]), -(m.z - c[1])) });
  }
  plan.hides = hides;
}

export function addNotes(plan: LevelPlan, rng: Rng, ids: string[]): void {
  const spots = rng.shuffle(plan.rooms.filter((r) => r.kind !== 'nest' && r.kind !== 'exit'));
  ids.forEach((id, i) => {
    const r = i === 0 ? plan.rooms[plan.spawn.room] : spots[i % spots.length];
    plan.items.push({ id: `note${plan.items.length}`, item: id, kind: 'note', room: r.id, pos: randIn(r, rng) });
  });
}

export function addGuaranteed(plan: LevelPlan, rng: Rng, list: Guaranteed[]): void {
  const dSpawn = (r: Room) => Math.hypot(cen(r).x - plan.spawn.pos.x, cen(r).z - plan.spawn.pos.z);
  for (const g of list) for (let i = 0; i < g.count; i++) {
    const pool = plan.rooms.filter((r) => r.kind !== 'exit');
    let room: Room;
    if (g.where === 'supply') room = plan.rooms.find((r) => r.kind === 'supply') ?? plan.rooms[plan.spawn.room];
    else if (g.where === 'far') room = [...pool].sort((a, b) => dSpawn(b) - dSpawn(a))[rng.int(0, 2)];
    else if (g.where === 'deadend') room = rng.pick(pool.filter((r) => r.kind === 'dead').length ? pool.filter((r) => r.kind === 'dead') : pool);
    else room = rng.pick(pool);
    plan.items.push({ id: `item${plan.items.length}`, item: g.item, kind: g.kind ?? 'tool', room: room.id, pos: randIn(room, rng, 1.6) });
  }
}

export function assignEcology(plan: LevelPlan, eco: Ecology[]): void {
  const d = (s: { pos: Vec2 }) => Math.hypot(s.pos.x - plan.spawn.pos.x, s.pos.z - plan.spawn.pos.z);
  const nests = plan.entitySlots.filter((s) => s.role === 'nest').sort((a, b) => d(a) - d(b));
  const patrols = plan.entitySlots.filter((s) => s.role === 'patrol');
  const usedNest = new Set<number>();
  for (const e of eco) {
    if (e.where === 'path') { const s = patrols[e.index ?? 0] ?? patrols[0]; if (s) s.entity = e.entity; continue; }
    const order = e.where === 'near' ? nests : [...nests].reverse();
    const slot = order.find((s) => !usedNest.has(s.room)) ?? order[0];
    if (slot) { slot.entity = e.entity; usedNest.add(slot.room); }
  }
  plan.entitySlots = plan.entitySlots.filter((s) => s.entity);
}

export function makeLevel(spec: LevelSpec): LevelDef {
  return {
    id: spec.id, name: spec.name, act: spec.act, tier: spec.tier, door: spec.door, targetSeconds: spec.targetSeconds, intensity: spec.intensity, look: spec.look,
    generate(seed) {
      const plan = generateGraphLevel(seed, { ...spec.graph, levelId: spec.id, tier: spec.tier });
      const rng = new Rng(deriveSeed(seed, `${spec.id}:dress`));
      for (const r of plan.rooms) if (r.kind === 'room' && Math.max(r.w / r.d, r.d / r.w) > (spec.hallAspect ?? 2.2)) r.kind = 'hall';
      if (spec.acoustics) plan.acoustics = spec.acoustics;
      if (spec.notes) addNotes(plan, rng, spec.notes);
      if (spec.guaranteed) addGuaranteed(plan, rng, spec.guaranteed);
      if (spec.ecology) assignEcology(plan, spec.ecology); else plan.entitySlots = plan.entitySlots.filter((s) => s.entity);
      spec.extra?.(plan, rng); // before props/hides so they steer clear of anything extra placed
      if (spec.props) addProps(plan, rng, spec.props);
      if (spec.hides) addHides(plan, rng, spec.hides);
      return plan;
    },
  };
}
