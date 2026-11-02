/**
 * Level factory: a level is a data spec (size, look, locks, props, ecology, notes, guaranteed
 * items) turned into a LevelDef on top of the shared graph generator. Props, hides, notes and
 * entity slots are placed with order-independent seeded RNG and never block doors or nav nodes.
 */
import { generateGraphLevel, type GraphOptions } from '../gen/graph';
import { Rng, deriveSeed } from '../gen/rng';
import type { HideSpot, ItemSpawn, LevelDef, LevelLook, LevelPlan, PropDef, Room, Vec2 } from '../gen/types';

export interface PropSpec { kind: string; w: number; d: number; h: number; color: number; count: number; /** scatter anywhere, no collision (wheat, snow drifts) */ soft?: boolean }
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
  /** Water: fractions of eligible rooms that are wade / swim (flooded only for off-path side rooms). */
  water?: { wade: number; swim: number; flooded: number; sludge?: boolean };
  /** Fully dark level (Lights Out) or light sections restored by breakers (Garage). */
  lights?: 'dark' | 'sections';
  flicker?: number;
  beacons?: boolean;
  /** Fraction of ordinary rooms that are outdoors (floor only). 1 = a field. */
  open?: number;
  cold?: { rate: number; /** extra heated shelters along the route */ shelters: number };
  schedule?: { period: number; window: number; offset: number };
  portraits?: { count: number; wrong: number };
  ruleEntity?: 'concierge' | 'partygoers';
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
    if (s.soft) {
      const pool = plan.rooms.filter((r) => r.open);
      for (let i = 0; i < s.count && pool.length; i++) { const r = rng.pick(pool); props.push({ kind: s.kind, x: r.x + 1 + rng.next() * (r.w - 2), z: r.z + 1 + rng.next() * (r.d - 2), w: s.w, d: s.d, h: s.h * (0.8 + rng.next() * 0.4), color: s.color, soft: true }); }
      continue;
    }
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

/** Water rooms: never in the start, supply, exit or waypoint rooms; flooded rooms are off-path dead ends only. */
export function addWater(plan: LevelPlan, rng: Rng, o: NonNullable<LevelSpec['water']>): void {
  const wp = new Set(plan.waypoints.map((w) => w.room));
  const onPath = new Set(plan.criticalPath);
  const out: NonNullable<LevelPlan['water']> = [];
  for (const r of rng.shuffle([...plan.rooms])) {
    if (r.kind === 'start' || r.kind === 'supply' || r.kind === 'exit' || wp.has(r.id)) continue;
    const roll = rng.next();
    if (!onPath.has(r.id) && r.kind === 'dead' && roll < o.flooded) out.push({ room: r.id, depth: 'flooded', sludge: o.sludge });
    else if (roll < o.flooded + o.swim) out.push({ room: r.id, depth: 'swim', sludge: o.sludge });
    else if (roll < o.flooded + o.swim + o.wade) out.push({ room: r.id, depth: 'wade', sludge: o.sludge });
  }
  plan.water = out;
}

/** Lights: 'dark' = everything but the start/supply rooms is unlit and beacons guide by sound; 'sections' = breakers restore path segments. */
export function addLights(plan: LevelPlan, mode: 'dark' | 'sections'): void {
  const keep = new Set(plan.rooms.filter((r) => r.kind === 'start' || r.kind === 'supply').map((r) => r.id));
  if (mode === 'dark') { plan.dark = true; plan.unlit = plan.rooms.filter((r) => !keep.has(r.id)).map((r) => r.id); return; }
  // sections: assign every room to its nearest critical-path index; segment k lies between lock k and lock k+1
  const locks = plan.connections.filter((c) => c.lock && plan.puzzles?.some((p) => p.lock === c.lock && p.kind === 'breaker'))
    .map((c) => ({ lock: c.lock!, pos: Math.max(plan.criticalPath.indexOf(c.a), plan.criticalPath.indexOf(c.b)) })).sort((a, b) => a.pos - b.pos);
  const cx = (id: number) => plan.rooms[id].x + plan.rooms[id].w / 2, cz = (id: number) => plan.rooms[id].z + plan.rooms[id].d / 2;
  const nearest = (r: number) => { let best = 0, bd = Infinity; plan.criticalPath.forEach((pid, i) => { const d = Math.hypot(cx(pid) - cx(r), cz(pid) - cz(r)); if (d < bd) { bd = d; best = i; } }); return best; };
  const seg = (r: number) => locks.filter((l) => nearest(r) >= l.pos).length; // 0 = before the first breaker gate
  plan.sections = locks.map((l, i) => ({ lock: l.lock, rooms: plan.rooms.filter((r) => seg(r.id) === i + 1 && !keep.has(r.id)).map((r) => r.id) }));
  plan.unlit = plan.rooms.filter((r) => seg(r.id) > 0 && !keep.has(r.id)).map((r) => r.id);
}

export function addOpen(plan: LevelPlan, rng: Rng, frac: number): void {
  for (const r of plan.rooms) if ((r.kind === 'room' || r.kind === 'hall' || r.kind === 'dead' || r.kind === 'start') && rng.chance(frac)) r.open = true;
  plan.open = true;
}

export function addPortraits(plan: LevelPlan, rng: Rng, o: { count: number; wrong: number }): void {
  const out: NonNullable<LevelPlan['portraits']> = [];
  const clear = keepClear(plan);
  let tries = 0;
  while (out.length < o.count && tries++ < o.count * 40) {
    const r = rng.pick(plan.rooms.filter((q) => !q.open && q.kind !== 'start'));
    const side = rng.int(0, 3), along = rng.range(1.5, (side < 2 ? r.w : r.d) - 1.5);
    const pos = side === 0 ? { x: r.x + along, z: r.z + 0.3 } : side === 1 ? { x: r.x + along, z: r.z + r.d - 0.3 } : side === 2 ? { x: r.x + 0.3, z: r.z + along } : { x: r.x + r.w - 0.3, z: r.z + along };
    if (clear.some((c) => Math.hypot(c.p.x - pos.x, c.p.z - pos.z) < Math.min(c.r, 2.2)) || out.some((q) => Math.hypot(q.x - pos.x, q.z - pos.z) < 2)) continue;
    const yaw = side === 0 ? Math.PI : side === 1 ? 0 : side === 2 ? -Math.PI / 2 : Math.PI / 2; // facing direction = (-sin yaw, -cos yaw), into the room
    out.push({ ...pos, yaw, wrong: rng.chance(o.wrong) });
  }
  plan.portraits = out;
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
      if (spec.flicker !== undefined) plan.flicker = spec.flicker;
      if (spec.water) addWater(plan, rng, spec.water);
      if (spec.lights) addLights(plan, spec.lights);
      if (spec.ruleEntity) plan.ruleEntity = spec.ruleEntity;
      if (spec.schedule) plan.schedule = spec.schedule;
      if (spec.open) addOpen(plan, rng, spec.open);
      if (spec.cold) {
        // heated shelters along the route + the supply rooms; everything else is freezing
        const path = plan.criticalPath;
        for (let i = 1; i <= spec.cold.shelters; i++) { const room = plan.rooms[path[Math.floor((i / (spec.cold.shelters + 1)) * (path.length - 1))]]; if (room.kind === 'room' || room.kind === 'hall') room.kind = 'supply'; }
        plan.cold = { rate: spec.cold.rate, warm: plan.rooms.filter((r) => r.kind === 'supply' || r.kind === 'start').map((r) => r.id) };
      }
      if (spec.beacons) plan.beacons = [plan.exit.pos, ...plan.waypoints.map((w) => w.pos)];
      spec.extra?.(plan, rng); // before props/hides so they steer clear of anything extra placed
      if (spec.props) addProps(plan, rng, spec.props);
      if (spec.portraits) addPortraits(plan, rng, spec.portraits);
      if (spec.hides) addHides(plan, rng, spec.hides);
      return plan;
    },
  };
}
