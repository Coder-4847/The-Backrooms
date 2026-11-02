/**
 * Scrawled clue notes: small scraps of paper left by previous wanderers, placed from what the level
 * actually contains (locked doors and what opens them, nearby entities, hiding spots, checkpoints,
 * water, the exit). Pure and seeded: same plan -> same clues. Rendering lives in levels/clueArt.ts.
 */
import { Rng } from './rng';
import type { LevelPlan, Room } from './types';

export type Doodle =
  | 'key' | 'tall' | 'dog' | 'ear' | 'smile' | 'shadow' | 'door' | 'locker' | 'camcorder' | 'waves'
  | 'fuse' | 'crowbar' | 'valve' | 'lever' | 'hook' | 'numbers' | 'eye' | 'monster' | 'face' | 'balloon' | 'bottle';

export interface Clue {
  id: string; room: number;
  x: number; y: number; z: number;
  /** Facing direction (radians about +Y) for wall notes; floor notes lie flat with this rotation. */
  yaw: number;
  wall: boolean;
  text: string;
  doodle: Doodle;
  seed: number;
}

const ENTITY_CLUES: Record<string, [string, Doodle]> = {
  stick: ["DON'T LET THE TALL ONE SEE YOU", 'tall'],
  wraith: ["DON'T LET THE TALL ONE SEE YOU", 'tall'],
  stalker: ['IF IT FOLLOWS, DONT TURN AROUND', 'tall'],
  hound: ['WALK. THEY HEAR YOU RUN', 'dog'],
  crawler: ['WALK. THEY HEAR YOU RUN', 'dog'],
  howler: ["IT'S BLIND. STAY QUIET", 'ear'],
  lurker: ["IT'S BLIND. STAY QUIET", 'ear'],
  smiler: ["DON'T STARE AT THE SMILE. KEEP LIGHTS ON", 'smile'],
  skinstealer: ['CHECK THEIR SHADOW', 'shadow'],
  partygoer: ["DON'T JOIN THE PARTY", 'balloon'],
  watcher: ["DON'T LOOK AT IT TOO LONG", 'eye'],
  windowman: ['STAY AWAY FROM THE WINDOWS', 'eye'],
  faceling: ['NO FACE = DONT TALK TO IT', 'face'],
  leech: ['GET OUT OF THE WATER FAST', 'waves'],
  leviathan: ['SOMETHING BIG IN THE WATER', 'waves'],
  drowned: ["DON'T STAY IN THE WATER", 'waves'],
  static: ['TURN THE CAMERA OFF', 'camcorder'],
  echo: ["IT COPIES YOU. DON'T ANSWER", 'ear'],
  concierge: ['READ THE RULES. OBEY THEM', 'numbers'],
  monitor: ['DO WHAT THE SASH MAN SAYS', 'face'],
  curator: ["DON'T STARE AT THE WRONG PAINTINGS", 'eye'],
  pursuer: ['RUN. DONT STOP', 'monster'],
};

function lockClue(lock: string): [string, Doodle] {
  if (lock.startsWith('fuse')) return ['FIND A FUSE FOR THE BAY', 'fuse'];
  if (lock.startsWith('pry')) return ['STUCK DOOR. GET A CROWBAR', 'crowbar'];
  if (lock.startsWith('valves')) return ['TURN ALL THE VALVES', 'valve'];
  if (lock.startsWith('rope')) return ['NEED A HOOK TO CROSS', 'hook'];
  if (lock.startsWith('seq')) return ['REBOOT IN ORDER. READ THE NOTES', 'numbers'];
  if (lock.startsWith('breaker')) return ['NO POWER? FLIP THE BREAKER', 'lever'];
  return ['FIND THE KEY', 'key'];
}

/** A spot on a wall of `r` away from its doors (or the floor of open rooms). */
function spotIn(plan: LevelPlan, r: Room, rng: Rng): { x: number; y: number; z: number; yaw: number; wall: boolean } {
  const doors = plan.connections.filter((c) => c.a === r.id || c.b === r.id).map((c) => c.door);
  if (r.open || r.w < 2.2 || r.d < 2.2) {
    return { x: r.x + r.w * (0.3 + rng.next() * 0.4), y: 0.012, z: r.z + r.d * (0.3 + rng.next() * 0.4), yaw: rng.next() * Math.PI * 2, wall: false };
  }
  for (let tries = 0; tries < 12; tries++) {
    const side = rng.int(0, 3);
    const t = 0.2 + rng.next() * 0.6;
    const inset = 0.105;
    // yaw: the note's front faces into the room
    const p = side === 0 ? { x: r.x + r.w * t, z: r.z + inset, yaw: 0 }
      : side === 1 ? { x: r.x + r.w * t, z: r.z + r.d - inset, yaw: Math.PI }
        : side === 2 ? { x: r.x + inset, z: r.z + r.d * t, yaw: Math.PI / 2 }
          : { x: r.x + r.w - inset, z: r.z + r.d * t, yaw: -Math.PI / 2 };
    if (doors.some((d) => Math.hypot(d.x - p.x, d.z - p.z) < 1.4)) continue;
    if ((plan.hides ?? []).some((h) => Math.hypot(h.pos.x - p.x, h.pos.z - p.z) < 1)) continue;
    if ((plan.props ?? []).some((q) => Math.abs(q.x - p.x) < q.w / 2 + 0.3 && Math.abs(q.z - p.z) < q.d / 2 + 0.3)) continue;
    // sometimes it fell off the wall and lies on the floor below
    if (rng.next() < 0.25) {
      const nx = side === 2 ? 1 : side === 3 ? -1 : 0, nz = side === 0 ? 1 : side === 1 ? -1 : 0;
      return { x: p.x + nx * 0.35, y: 0.012, z: p.z + nz * 0.35, yaw: p.yaw + (rng.next() - 0.5) * 1.2, wall: false };
    }
    return { x: p.x, y: 1.25 + rng.next() * 0.35, z: p.z, yaw: p.yaw, wall: true };
  }
  return { x: r.x + r.w / 2, y: 0.012, z: r.z + r.d / 2, yaw: rng.next() * 6.28, wall: false };
}

export function planClues(plan: LevelPlan, max = 8): Clue[] {
  if (plan.hub || plan.finale) return [];
  const rng = new Rng((plan.seed ^ 0x51c0de) >>> 0);
  const out: Clue[] = [];
  const used = new Set<number>();
  const path = plan.criticalPath;
  const pathIndex = (room: number) => { const i = path.indexOf(room); return i < 0 ? Infinity : i; };
  const neighbours = (room: number) => plan.connections.filter((c) => c.a === room || c.b === room).map((c) => (c.a === room ? c.b : c.a));
  const add = (room: number, text: string, doodle: Doodle) => {
    if (out.length >= max || used.has(room) || room === undefined || !plan.rooms[room]) return;
    used.add(room);
    const s = spotIn(plan, plan.rooms[room], rng);
    out.push({ id: `clue${out.length}`, room, ...s, text, doodle, seed: rng.u32() });
  };

  // the way out
  add(plan.spawn.room, plan.levelId === 'level0' ? 'THE WRONG WALL HUMS. LISTEN FOR IT' : 'FOLLOW THE HUM TO GET OUT', 'door');
  // what opens each locked door: left on the near side of the door
  for (const c of plan.connections.filter((q) => q.lock).sort((a, b) => Math.min(pathIndex(a.a), pathIndex(a.b)) - Math.min(pathIndex(b.a), pathIndex(b.b)))) {
    const near = pathIndex(c.a) <= pathIndex(c.b) ? c.a : c.b;
    const [t, d] = lockClue(c.lock!);
    add(used.has(near) ? neighbours(near).find((n) => !used.has(n) && pathIndex(n) <= pathIndex(near)) ?? near : near, t, d);
  }
  // warnings a room or two before what lives here
  const seen = new Set<string>();
  for (const s of plan.entitySlots) {
    const id = s.entity ?? (s.role === 'nest' ? 'hound' : 'stick');
    if (seen.has(id) || !ENTITY_CLUES[id]) continue;
    seen.add(id);
    const before = neighbours(s.room).sort((a, b) => pathIndex(a) - pathIndex(b))[0] ?? s.room;
    add(before, ...ENTITY_CLUES[id]);
  }
  if (plan.ruleEntity === 'concierge') add(path[1] ?? plan.spawn.room, ...ENTITY_CLUES.concierge);
  if (plan.ruleEntity === 'partygoers') add(path[1] ?? plan.spawn.room, ...ENTITY_CLUES.partygoer);
  // survival basics
  const hide = (plan.hides ?? [])[0];
  if (hide) add(hide.room, hide.kind === 'locker' ? 'HIDE IN THE LOCKERS' : 'GET UNDER THE DESKS', 'locker');
  if (plan.waypoints[0]) add(plan.waypoints[0].room, 'THE CAMERAS SAVE YOU', 'camcorder');
  const water = (plan.water ?? []).find((w) => w.depth !== 'wade');
  if (water) add(neighbours(water.room)[0] ?? water.room, 'HOLD YOUR BREATH. GO FAST', 'waves');
  if (plan.items.some((i) => i.item === 'almond_water')) add(path[Math.min(path.length - 1, 2)] ?? plan.spawn.room, 'DRINK THE ALMOND WATER', 'bottle');
  return out;
}
