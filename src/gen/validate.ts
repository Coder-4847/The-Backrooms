/**
 * Headless level validators (spec 0.3 #3). Pure functions over a LevelPlan so they run in Node
 * with no rendering. `validatePlan` returns a list of human-readable failures (empty = pass).
 */
import { DIFFICULTY_ORDER } from '../core/difficulty';
import { waypointsFor } from './waypoints';
import type { LevelDef, LevelPlan, Room, Vec2 } from './types';

const EPS = 1e-3;
const inRoom = (r: Room, p: Vec2, margin = 0) => p.x >= r.x + margin - EPS && p.x <= r.x + r.w - margin + EPS && p.z >= r.z + margin - EPS && p.z <= r.z + r.d - margin + EPS;

export interface ValidateOptions { minWaypoints?: number; maxWaypoints?: number }

/** Rooms reachable from spawn, collecting keys as they become reachable (the solvability simulation). */
export function simulateReach(plan: LevelPlan): { rooms: Set<number>; keys: Set<string> } {
  const keys = new Set<string>();
  const reached = new Set<number>([plan.spawn.room]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of plan.connections) {
      if (c.lock && !keys.has(c.lock)) continue;
      if (reached.has(c.a) && !reached.has(c.b)) { reached.add(c.b); changed = true; }
      else if (reached.has(c.b) && !reached.has(c.a)) { reached.add(c.a); changed = true; }
    }
    for (const it of plan.items) if (it.kind === 'key' && it.unlocks && reached.has(it.room) && !keys.has(it.unlocks)) { keys.add(it.unlocks); changed = true; }
  }
  return { rooms: reached, keys };
}

export function validatePlan(def: Pick<LevelDef, 'targetSeconds'>, plan: LevelPlan, opt: ValidateOptions = {}): string[] {
  const errs: string[] = [];
  const fail = (m: string) => errs.push(m);
  const R = plan.rooms;
  const byId = new Map(R.map((r) => [r.id, r]));

  // geometry: inside bounds, no overlap
  for (const r of R) {
    if (r.x < plan.bounds.x0 - EPS || r.z < plan.bounds.z0 - EPS || r.x + r.w > plan.bounds.x1 + EPS || r.z + r.d > plan.bounds.z1 + EPS) fail(`room ${r.id} outside bounds`);
    if (r.w < 2 || r.d < 2) fail(`room ${r.id} too small`);
  }
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    if (a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS) fail(`rooms ${a.id} and ${b.id} overlap`);
  }

  // connections
  for (const c of plan.connections) {
    const a = byId.get(c.a), b = byId.get(c.b);
    if (!a || !b) { fail(`connection ${c.id} references a missing room`); continue; }
    const onEdge = (r: Room) => {
      const dx = Math.min(Math.abs(c.door.x - r.x), Math.abs(c.door.x - (r.x + r.w)));
      const dz = Math.min(Math.abs(c.door.z - r.z), Math.abs(c.door.z - (r.z + r.d)));
      return inRoom(r, c.door, -EPS) && (dx < EPS || dz < EPS);
    };
    if (!onEdge(a) || !onEdge(b)) fail(`connection ${c.id} door not on both rooms' walls`);
  }

  // connectivity ignoring locks
  const adj = new Map<number, number[]>(R.map((r) => [r.id, []]));
  plan.connections.forEach((c) => { adj.get(c.a)?.push(c.b); adj.get(c.b)?.push(c.a); });
  const seen = new Set<number>([plan.spawn.room]);
  const q = [plan.spawn.room];
  while (q.length) for (const n of adj.get(q.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); q.push(n); }
  if (seen.size !== R.length) fail(`graph not connected (${seen.size}/${R.length} rooms reachable)`);

  // solvability: keys reachable before their locks, exit reachable, nothing stranded
  const sim = simulateReach(plan);
  if (!sim.rooms.has(plan.exit.room)) fail('exit unreachable given key order');
  for (const c of plan.connections) if (c.lock) {
    if (!plan.items.some((i) => i.kind === 'key' && i.unlocks === c.lock)) fail(`lock ${c.lock} has no key`);
    if (!sim.keys.has(c.lock)) fail(`key for ${c.lock} unreachable before its lock`);
  }
  for (const it of plan.items) {
    const r = byId.get(it.room);
    if (!r) { fail(`item ${it.id} in missing room`); continue; }
    if (!inRoom(r, it.pos)) fail(`item ${it.id} outside its room`);
    if (!sim.rooms.has(it.room)) fail(`item ${it.id} unreachable`);
  }
  if (sim.rooms.size !== R.length) fail(`${R.length - sim.rooms.size} rooms unreachable even with all keys`);

  // spawn / exit / critical path
  const sr = byId.get(plan.spawn.room), er = byId.get(plan.exit.room);
  if (!sr || !inRoom(sr, plan.spawn.pos, 0.8)) fail('spawn point invalid');
  if (!er || !inRoom(er, plan.exit.pos, 0.8)) fail('exit point invalid');
  const cp = plan.criticalPath;
  if (cp[0] !== plan.spawn.room || cp[cp.length - 1] !== plan.exit.room) fail('critical path does not run spawn -> exit');
  if (new Set(cp).size !== cp.length) fail('critical path repeats a room');
  for (let i = 0; i + 1 < cp.length; i++) if (!plan.connections.some((c) => (c.a === cp[i] && c.b === cp[i + 1]) || (c.b === cp[i] && c.a === cp[i + 1]))) fail(`critical path step ${cp[i]}->${cp[i + 1]} not connected`);

  // entity slots
  for (const s of plan.entitySlots) {
    const r = byId.get(s.room);
    if (!r || !inRoom(r, s.pos)) fail('entity slot outside its room');
    if (s.room === plan.spawn.room) fail('entity slot in spawn room');
  }

  // hiding spots: inside their room, clear of doorways, waypoints and items (so they never block anything)
  for (const h of plan.hides ?? []) {
    const r = byId.get(h.room);
    if (!r || !inRoom(r, h.pos, 0.4)) fail(`hide ${h.id} outside its room`);
    if (plan.connections.some((c) => Math.hypot(c.door.x - h.pos.x, c.door.z - h.pos.z) < 2)) fail(`hide ${h.id} too close to a door`);
    if (plan.waypoints.some((w) => Math.hypot(w.pos.x - h.pos.x, w.pos.z - h.pos.z) < 1.5)) fail(`hide ${h.id} too close to a waypoint`);
    if (plan.items.some((i) => Math.hypot(i.pos.x - h.pos.x, i.pos.z - h.pos.z) < 1)) fail(`hide ${h.id} on top of an item`);
  }
  for (const s of plan.entitySlots) if (s.entity && s.role === 'nest' && (plan.criticalPath.slice(0, 2).includes(s.room))) fail('entity nest on the first stretch of the route');

  // nav graph
  const N = plan.nav.nodes;
  for (const e of plan.nav.edges) if (!N[e.a] || !N[e.b] || !(e.cost >= 0)) fail('nav edge invalid');
  const nadj = N.map(() => [] as number[]);
  plan.nav.edges.forEach((e) => { nadj[e.a]?.push(e.b); nadj[e.b]?.push(e.a); });
  const nseen = new Set<number>([0]);
  const nq = [0];
  while (nq.length) for (const n of nadj[nq.shift()!]) if (!nseen.has(n)) { nseen.add(n); nq.push(n); }
  if (nseen.size !== N.length) fail(`nav graph not connected (${nseen.size}/${N.length})`);
  for (const n of N) { const r = byId.get(n.room); if (!r || !inRoom(r, n.pos, -0.01)) fail(`nav node ${n.id} outside room`); }

  // waypoints (spec 5.8): count, spread, reachable, not in nests, not first/last stretch
  const wps = plan.waypoints;
  const minW = opt.minWaypoints ?? 2, maxW = opt.maxWaypoints ?? 3;
  if (wps.length < minW || wps.length > maxW) fail(`waypoint candidates ${wps.length} not in ${minW}-${maxW}`);
  wps.forEach((w, i) => {
    const r = byId.get(w.room);
    if (!r || !inRoom(r, w.pos, 0.5)) fail(`waypoint ${i} outside its room`);
    if (!sim.rooms.has(w.room)) fail(`waypoint ${i} unreachable`);
    if (r && (r.kind === 'nest' || r.kind === 'start' || r.kind === 'exit')) fail(`waypoint ${i} in a ${r.kind} room`);
    if (plan.entitySlots.some((s) => s.role === 'nest' && Math.hypot(s.pos.x - w.pos.x, s.pos.z - w.pos.z) < 8)) fail(`waypoint ${i} too close to an entity nest`);
    if (w.t < 0.1 || w.t > 0.92) fail(`waypoint ${i} on the first/last stretch (t=${w.t.toFixed(2)})`);
    if (i > 0 && w.t - wps[i - 1].t < 0.15) fail(`waypoints ${i - 1},${i} not spread out`);
  });
  for (const d of DIFFICULTY_ORDER) {
    const n = waypointsFor(plan, d).length;
    const expectMax = d === 'hardcore' ? 0 : 3;
    if (n > expectMax) fail(`difficulty ${d} has ${n} waypoints`);
    if (d !== 'hardcore' && wps.length >= 2 && n < 1) fail(`difficulty ${d} has no waypoints`);
  }

  // traversal time window
  const [lo, hi] = def.targetSeconds;
  if (plan.estSeconds < lo || plan.estSeconds > hi) fail(`estimated time ${Math.round(plan.estSeconds)}s outside [${lo}, ${hi}]`);

  return errs;
}

export interface LevelReport { levelId: string; seeds: number; failures: { seed: number; errors: string[] }[]; ms: number }

/** Run all validators over `seeds` seeds for a level (determinism + difficulty invariance included). */
export function validateLevel(def: LevelDef, seeds: number, opt: ValidateOptions = {}, baseSeed = 1000): LevelReport {
  const t0 = performance.now();
  const failures: LevelReport['failures'] = [];
  for (let i = 0; i < seeds; i++) {
    const seed = baseSeed + i * 7919;
    const errs: string[] = [];
    try {
      const plan = def.generate(seed);
      errs.push(...validatePlan(def, plan, opt));
      const again = JSON.stringify(def.generate(seed));
      if (again !== JSON.stringify(plan)) errs.push('generator not deterministic');
      for (const d of DIFFICULTY_ORDER) if (JSON.stringify(def.generate(seed, { difficulty: d })) !== again) { errs.push(`layout changes with difficulty ${d}`); break; }
    } catch (e) { errs.push(`generator threw: ${(e as Error).message}`); }
    if (errs.length) failures.push({ seed, errors: errs });
  }
  return { levelId: def.id, seeds, failures, ms: performance.now() - t0 };
}
