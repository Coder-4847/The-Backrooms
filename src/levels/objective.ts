/**
 * Objective: "what should I be doing right now" for the HUD, derived from the live sim. Pure (no DOM,
 * no THREE) so it can be unit-tested and used by tools. It answers three things:
 *  - `text`   one short imperative line ("Find a crowbar for the stuck door")
 *  - `target` where the next step is (a key, a valve, the next door on the way to the exit), used only
 *             for the "you seem lost" bearing hint, never drawn as a marker
 *  - `dist`   rooms left to the exit (BFS over the room graph), used to detect progress
 */
import type { LevelPlan, Vec2 } from '../gen/types';
import type { LevelSim } from './sim';

export interface Objective { text: string; sub?: string; target: Vec2 | null; dist: number; key: string }

const LOCK_TEXT: [string, string, string][] = [
  // prefix, what to do, short name
  ['fuse', 'Find a fuse for the dead transformer bay', 'fuse'],
  ['pry', 'Find a crowbar for the stuck door', 'crowbar'],
  ['rope', 'Find a grappling hook to cross the chasm', 'hook'],
  ['valves', 'Align the valves to open the sealed door', 'valves'],
  ['seq', 'Reboot the servers in the right order', 'servers'],
  ['breaker', 'Find the breaker and flip it to restore power', 'breaker'],
];
const lockText = (lock: string): string => LOCK_TEXT.find(([p]) => lock.startsWith(p))?.[1] ?? 'Find the key for the locked door';

/** Rooms from `from` to the exit room over every connection (locks ignored), as connection ids. */
export function routeToExit(plan: LevelPlan, from: number): { conns: number[]; rooms: number[] } | null {
  const to = plan.exit.room;
  if (from === to) return { conns: [], rooms: [from] };
  const prev = new Map<number, { room: number; conn: number }>();
  const q = [from];
  const seen = new Set<number>([from]);
  for (let i = 0; i < q.length; i++) {
    const r = q[i];
    for (const c of plan.connections) {
      const n = c.a === r ? c.b : c.b === r ? c.a : -1;
      if (n < 0 || seen.has(n)) continue;
      seen.add(n); prev.set(n, { room: r, conn: c.id }); q.push(n);
      if (n === to) {
        const conns: number[] = [], rooms: number[] = [n];
        for (let cur = n; cur !== from;) { const p = prev.get(cur)!; conns.unshift(p.conn); rooms.unshift(p.room); cur = p.room; }
        return { conns, rooms };
      }
    }
  }
  return null;
}

export function levelObjective(sim: LevelSim): Objective {
  const plan = sim.plan;
  const route = routeToExit(plan, sim.room);
  const dist = route ? route.rooms.length - 1 : 99;
  const next = (c: number): Vec2 => plan.connections[c].door;
  const exitPos = plan.exit.pos;
  if (!route) return { text: 'Find the way out', target: exitPos, dist, key: 'exit' };
  // the first locked door still in the way
  for (const cid of route.conns) {
    const door = sim.doors.get(cid);
    if (!door || door.open) continue;
    const lock = door.conn.lock;
    if (!lock) continue;
    if (sim.keys.has(lock)) return { text: 'Open the door you unlocked', target: next(cid), dist, key: `unlock:${cid}` };
    const text = lockText(lock);
    const puzzle = (plan.puzzles ?? []).find((p) => p.lock === lock);
    if (puzzle) {
      const part = (puzzle.kind === 'valves' ? puzzle.parts.find((p, i) => sim.x.valves.get(p.id) !== puzzle.solution[i]) : undefined) ?? puzzle.parts[0];
      return { text, sub: puzzle.hintNote ? 'The answer is written on a note somewhere on this level' : undefined, target: part.pos, dist, key: `lock:${lock}` };
    }
    const item = plan.items.find((i) => i.unlocks === lock && !sim.collected.has(i.id)) ?? plan.items.find((i) => i.kind === 'tool' && !sim.collected.has(i.id) && lock.startsWith(i.item));
    return { text, sub: 'Explore the side rooms: it is somewhere off the main route', target: item ? item.pos : next(cid), dist, key: `lock:${lock}` };
  }
  if (sim.room === plan.exit.room || dist === 0) return { text: 'The exit is right here. Leave.', target: exitPos, dist, key: 'exit-here' };
  if (plan.finale) return { text: 'Face the Architect', target: exitPos, dist, key: 'finale' };
  return { text: 'Find the exit', sub: dist <= 2 ? 'You are close' : undefined, target: next(route.conns[0]), dist, key: 'exit' };
}

/** Compass-style words for where `target` lies relative to where the player is looking. */
export function bearingWords(px: number, pz: number, yaw: number, target: Vec2): string {
  const dx = target.x - px, dz = target.z - pz;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);       // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);        // right
  const ahead = dx * fx + dz * fz, right = dx * rx + dz * rz;
  const a = Math.atan2(right, ahead);                    // 0 = dead ahead, +π/2 = right
  const deg = Math.abs(a) * 180 / Math.PI;
  const side = right >= 0 ? 'right' : 'left';
  if (deg < 25) return 'straight ahead';
  if (deg < 70) return `ahead and to your ${side}`;
  if (deg < 115) return `to your ${side}`;
  if (deg < 155) return `behind you, to the ${side}`;
  return 'behind you';
}

/**
 * Guide point for the HUD arrow: the next doorway on a walkable route (open doors only) from the player's room
 * to the room holding `target`, or the target itself once you are in its room. Pointing at the next door instead
 * of straight at the target means the arrow never tells you to walk into a wall.
 */
export function guidePoint(sim: LevelSim, target: Vec2): Vec2 {
  const plan = sim.plan;
  const goal = sim.ew.nav.roomAt(target.x, target.z);
  const from = sim.room;
  if (goal < 0 || goal === from) return target;
  const passable = (cid: number) => { const d = sim.doors.get(cid); return !d || d.open; };
  const prev = new Map<number, number>();
  const q = [from]; const seen = new Set([from]);
  for (let i = 0; i < q.length; i++) {
    const r = q[i];
    for (const c of plan.connections) {
      const n = c.a === r ? c.b : c.b === r ? c.a : -1;
      if (n < 0 || seen.has(n) || (!passable(c.id) && n !== goal)) continue;
      seen.add(n); prev.set(n, c.id); q.push(n);
      if (n === goal) {
        let cur = n, conn = c.id;
        while (true) { const cid = prev.get(cur)!; const cc = plan.connections[cid]; const back = cc.a === cur ? cc.b : cc.a; conn = cid; if (back === from) break; cur = back; }
        return plan.connections[conn].door;
      }
    }
  }
  return target;
}
