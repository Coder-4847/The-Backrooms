/**
 * Autopilot bot (spec 0.3 #4). Walks the level's nav graph through the real LevelSim: fetch the
 * next needed key, unlock doors, reach the exit. It proves completability and measures time;
 * it does not try to play well. Runs headless at accelerated simulated time.
 */
import { LevelSim } from './sim';
import { emptyFrame } from '../core/input/logic';
import { STEP } from '../core/loop';
import type { LevelPlan, Vec2 } from '../gen/types';
import type { DifficultyId } from '../core/difficulty';

interface Step { to: Vec2; /** interact when arrived (door/key/exit) */ act?: boolean }


/** Dijkstra over the nav graph avoiding still-locked doors. Returns node ids. */
function route(plan: LevelPlan, from: Vec2, to: Vec2, openLocks: Set<string>, isOpen: (connId: number) => boolean): Step[] | null {
  const N = plan.nav.nodes;
  const roomOf = (p: Vec2) => plan.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.z >= r.z && p.z <= r.z + r.d)!;
  const centerNode = (room: number) => N.findIndex((n) => n.id === room); // first N nodes are room centres, id == room id
  const adj = N.map(() => [] as { to: number; cost: number }[]);
  for (const e of plan.nav.edges) {
    const c = e.connection !== undefined ? plan.connections[e.connection] : null;
    if (c?.lock && !openLocks.has(c.lock)) continue;
    adj[e.a].push({ to: e.b, cost: e.cost }); adj[e.b].push({ to: e.a, cost: e.cost });
  }
  const start = centerNode(roomOf(from).id), goal = centerNode(roomOf(to).id);
  const dist = new Array(N.length).fill(Infinity), prev = new Array(N.length).fill(-1);
  dist[start] = 0;
  const open = new Set<number>([start]);
  while (open.size) {
    let u = -1;
    for (const n of open) if (u < 0 || dist[n] < dist[u]) u = n;
    open.delete(u);
    if (u === goal) break;
    for (const { to: v, cost } of adj[u]) if (dist[u] + cost < dist[v]) { dist[v] = dist[u] + cost; prev[v] = u; open.add(v); }
  }
  if (!isFinite(dist[goal])) return null;
  const nodes: number[] = [];
  for (let n = goal; n !== -1; n = prev[n]) nodes.unshift(n);
  // door nodes of still-closed locked doors need an interaction (nav mouths already make the approach perpendicular)
  const path: Step[] = nodes.map((n) => {
    const conn = N[n].kind === 'door' ? plan.connections[N[n].connection!] : null;
    return { to: N[n].pos, act: !!(conn?.lock && !isOpen(conn.id)) };
  });
  return [...path.slice(1), { to }];
}

export interface BotResult { completed: boolean; seconds: number; reason?: string; keysUsed: number; waypointsVisited: number }

export function runBot(plan: LevelPlan, opts: { difficulty?: DifficultyId; maxSeconds?: number; visitWaypoints?: boolean; /** entities observe only (default) or act */ mode?: 'active' | 'observe' } = {}): BotResult {
  const sim = new LevelSim(plan, opts.difficulty ?? 'normal', { mode: opts.mode ?? 'observe' });
  const frame = emptyFrame();
  const maxSteps = Math.round((opts.maxSeconds ?? 2400) / STEP);
  const p = sim.player;
  let queue: Step[] = [];
  let stuck = 0;
  let last = { x: p.x, z: p.z };
  const isOpen = (id: number) => sim.doors.get(id)?.open ?? true;

  const plan2 = (): Step[] => {
    // objectives in order: needed key (nearest to us whose lock blocks the exit), else exit
    const open = new Set<string>(sim.keys);
    const here = { x: p.x, z: p.z };
    const toExit = route(plan, here, plan.exit.pos, open, isOpen);
    if (toExit) {
      if (opts.visitWaypoints) for (let i = 0; i < sim.waypoints.length; i++) if (!sim.activatedWaypoints.has(i)) {
        const w = sim.waypoints[i].pos;
        const r = route(plan, here, w, open, isOpen);
        if (r) return [...r.slice(0, -1), { to: w, act: true }];
      }
      return [...toExit.slice(0, -1), { to: plan.exit.pos, act: true }];
    }
    // exit blocked: fetch the nearest reachable uncollected key
    let best: { it: (typeof plan.items)[number]; r: Step[]; len: number } | null = null;
    for (const it of plan.items) {
      if (it.kind !== 'key' || sim.collected.has(it.id)) continue;
      const r = route(plan, here, it.pos, open, isOpen);
      if (!r) continue;
      const len = r.reduce((s, q, i) => s + Math.hypot(q.to.x - (i ? r[i - 1].to.x : here.x), q.to.z - (i ? r[i - 1].to.z : here.z)), 0);
      if (!best || len < best.len) best = { it, r, len };
    }
    if (best) return [...best.r.slice(0, -1), { to: best.it.pos, act: true }];
    return [];
  };

  for (let s = 0; s < maxSteps; s++) {
    if (sim.finished) return { completed: true, seconds: sim.time, keysUsed: sim.keys.size, waypointsVisited: sim.activatedWaypoints.size };
    if (!queue.length) {
      queue = plan2();
      if (!queue.length) return { completed: false, seconds: sim.time, reason: 'no route', keysUsed: sim.keys.size, waypointsVisited: sim.activatedWaypoints.size };
    }
    const tgt = queue[0];
    const dx = tgt.to.x - p.x, dz = tgt.to.z - p.z;
    const d = Math.hypot(dx, dz);
    const arrive = tgt.act ? 0.9 : 0.35;
    if (d < arrive) {
      if (tgt.act) {
        frame.pressed.Interact = true;
        sim.step(frame); frame.pressed.Interact = false;
        queue.shift();
        continue;
      }
      queue.shift();
      continue;
    }
    // steer: face the target and walk forward (bot may set yaw directly)
    p.yaw = Math.atan2(-dx, -dz);
    frame.moveX = 0; frame.moveY = 1;
    frame.down.Sprint = false;
    sim.step(frame);
    // stuck detection: if we barely moved for 3 s, replan
    if (s % 180 === 0) {
      if (Math.hypot(p.x - last.x, p.z - last.z) < 0.3) { stuck++; queue = []; if (stuck > 8) return { completed: false, seconds: sim.time, reason: 'stuck', keysUsed: sim.keys.size, waypointsVisited: sim.activatedWaypoints.size }; }
      last = { x: p.x, z: p.z };
    }
  }
  return { completed: false, seconds: sim.time, reason: 'timeout', keysUsed: sim.keys.size, waypointsVisited: sim.activatedWaypoints.size };
}
