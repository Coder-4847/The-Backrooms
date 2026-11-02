/**
 * Graph-first level generator shared by levels. Steps (spec 4.2):
 *  1. BSP-tile a rectangle into rooms (no overlaps/gaps by construction).
 *  2. Build adjacency (rooms sharing a wall long enough for a door) and a spanning tree.
 *  3. Pick spawn/exit far apart; the tree path between them is the critical path.
 *  4. Dependency solver: put locks on critical-path doors, place each key in a side room
 *     reachable *before* that lock (never behind it).
 *  5. Add loop doors only inside a lock "side" so loops can never bypass a lock.
 *  6. Waypoint candidates (off-route, mid-path), nests, loot, nav graph, time estimate.
 */
import { Rng } from './rng';
import type { Connection, EntitySlot, ItemSpawn, LevelPlan, NavEdge, NavNode, Room, Vec2, Waypoint } from './types';

export interface GraphOptions {
  levelId: string;
  tier: LevelPlan['tier'];
  /** Footprint in metres. */
  width: number; depth: number;
  /** Target room count (approximate) and size limits in metres. */
  rooms: number; minRoom: number; maxRoom: number;
  wallHeight: number;
  locks: number;
  /** Extra loop doors as a fraction of rooms. */
  loops: number;
  variants: number;
  nests: number;
  loot: number;
  doorWidth?: number;
}

const WALK_SPEED = 2.4; // m/s average including looking around
const PUZZLE_SECONDS = 25;

interface Rect { x: number; z: number; w: number; d: number }

function bsp(rng: Rng, root: Rect, target: number, min: number, max: number): Rect[] {
  const open: Rect[] = [root];
  const done: Rect[] = []; // leaves that cannot be split further
  while (open.length) {
    open.sort((a, b) => b.w * b.d - a.w * a.d);
    const big = open[0];
    const tooBig = big.w > max || big.d > max;
    if (open.length + done.length >= target && !tooBig) break;
    // split along the longer side
    const splitX = big.w >= big.d;
    const len = splitX ? big.w : big.d;
    open.shift();
    if (len < min * 2) { done.push(big); continue; }
    const cut = Math.round((min + rng.next() * (len - min * 2)) * 2) / 2; // 0.5 m grid
    if (splitX) open.push({ x: big.x, z: big.z, w: cut, d: big.d }, { x: big.x + cut, z: big.z, w: big.w - cut, d: big.d });
    else open.push({ x: big.x, z: big.z, w: big.w, d: cut }, { x: big.x, z: big.z + cut, w: big.w, d: big.d - cut });
  }
  return [...done, ...open];
}

interface Adj { a: number; b: number; door: Vec2; axis: 'x' | 'z'; span: number }

/** Find a shared wall segment between two rects (touching edges with overlap >= minSpan). */
function sharedWall(a: Rect, b: Rect, minSpan: number): { door: Vec2; axis: 'x' | 'z'; span: number; lo: number; hi: number } | null {
  const eps = 1e-6;
  // vertical wall (x = const): runs along z
  if (Math.abs(a.x + a.w - b.x) < eps || Math.abs(b.x + b.w - a.x) < eps) {
    const lo = Math.max(a.z, b.z), hi = Math.min(a.z + a.d, b.z + b.d);
    if (hi - lo >= minSpan) {
      const x = Math.abs(a.x + a.w - b.x) < eps ? b.x : a.x;
      return { door: { x, z: (lo + hi) / 2 }, axis: 'z', span: hi - lo, lo, hi };
    }
  }
  if (Math.abs(a.z + a.d - b.z) < eps || Math.abs(b.z + b.d - a.z) < eps) {
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo >= minSpan) {
      const z = Math.abs(a.z + a.d - b.z) < eps ? b.z : a.z;
      return { door: { x: (lo + hi) / 2, z }, axis: 'x', span: hi - lo, lo, hi };
    }
  }
  return null;
}

export function generateGraphLevel(seed: number, o: GraphOptions): LevelPlan {
  const rng = new Rng(seed);
  const rRooms = rng.fork('rooms');
  const rLayout = rng.fork('layout');
  const rItems = rng.fork('items');
  const doorW = o.doorWidth ?? 1.4;

  // 1. rooms
  const rects = bsp(rRooms, { x: 0, z: 0, w: o.width, d: o.depth }, o.rooms, o.minRoom, o.maxRoom);
  rects.sort((a, b) => a.x - b.x || a.z - b.z); // stable ids independent of split order
  const rooms: Room[] = rects.map((r, id) => ({ id, ...r, kind: 'room', height: o.wallHeight, variant: rRooms.int(0, o.variants - 1) }));

  // 2. adjacency + spanning tree (randomised Prim)
  const adj: Adj[] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const w = sharedWall(rooms[i], rooms[j], doorW + 0.6);
    if (w) adj.push({ a: i, b: j, door: w.door, axis: w.axis, span: w.span });
  }
  const neighbors: number[][] = rooms.map(() => []);
  adj.forEach((e, k) => { neighbors[e.a].push(k); neighbors[e.b].push(k); });

  const inTree = new Set<number>([0]);
  const tree: number[] = [];
  const frontier = [...neighbors[0]];
  while (frontier.length && inTree.size < rooms.length) {
    const idx = rLayout.int(0, frontier.length - 1);
    const k = frontier.splice(idx, 1)[0];
    const e = adj[k];
    const outside = inTree.has(e.a) ? e.b : inTree.has(e.b) ? e.a : -1;
    if (outside < 0 || inTree.has(outside)) continue;
    inTree.add(outside);
    tree.push(k);
    for (const nk of neighbors[outside]) frontier.push(nk);
  }
  // Guard: BSP adjacency is connected, but if a room had no door-sized wall fall back to relaxed span.
  if (inTree.size < rooms.length) throw new Error(`graph disconnected: ${inTree.size}/${rooms.length} rooms (seed ${seed})`);

  const treeAdj: Map<number, { to: number; edge: number }[]> = new Map(rooms.map((r) => [r.id, []]));
  tree.forEach((k) => {
    treeAdj.get(adj[k].a)!.push({ to: adj[k].b, edge: k });
    treeAdj.get(adj[k].b)!.push({ to: adj[k].a, edge: k });
  });

  const bfs = (from: number, ban?: Set<number>) => {
    const dist = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, { room: number; edge: number }>();
    const q = [from];
    while (q.length) {
      const u = q.shift()!;
      for (const { to, edge } of treeAdj.get(u)!) {
        if (ban?.has(edge) || dist.has(to)) continue;
        dist.set(to, dist.get(u)! + 1);
        prev.set(to, { room: u, edge });
        q.push(to);
      }
    }
    return { dist, prev };
  };

  // 3. spawn / exit: the tree diameter, so the critical path is as long as possible
  const far = (from: number) => { const { dist } = bfs(from); let best = from; for (const [r, d] of dist) if (d > dist.get(best)!) best = r; return best; };
  const a = far(far(0));
  const b = far(a);
  const spawnRoom = rLayout.chance(0.5) ? a : b;
  const exitRoom = spawnRoom === a ? b : a;
  const { prev } = bfs(spawnRoom);
  const criticalPath: number[] = [exitRoom];
  const critEdges: number[] = [];
  for (let c = exitRoom; c !== spawnRoom;) { const p = prev.get(c)!; critEdges.unshift(p.edge); criticalPath.unshift(p.room); c = p.room; }

  rooms[spawnRoom].kind = 'start';
  rooms[exitRoom].kind = 'exit';

  // 4. connections (tree first), locks along the critical path
  const connections: Connection[] = tree.map((k, id) => ({ id, a: adj[k].a, b: adj[k].b, door: adj[k].door, axis: adj[k].axis, width: doorW, lock: null }));
  const connByAdj = new Map<number, Connection>(tree.map((k, i) => [k, connections[i]]));

  const lockCount = Math.min(o.locks, Math.max(0, critEdges.length - 3));
  const lockEdgeIdx: number[] = [];
  for (let i = 0; i < lockCount; i++) {
    // spread locks at roughly (i+1)/(n+1) of the path with jitter, never the very first or last door
    const t = (i + 1) / (lockCount + 1);
    const idx = Math.min(critEdges.length - 2, Math.max(1, Math.round(t * critEdges.length + rLayout.range(-1, 1))));
    if (!lockEdgeIdx.includes(idx)) lockEdgeIdx.push(idx);
  }
  lockEdgeIdx.sort((x, y) => x - y);
  const locks: { id: string; edge: number; pathIdx: number }[] = lockEdgeIdx.map((pathIdx, i) => ({ id: `key${i + 1}`, edge: critEdges[pathIdx], pathIdx }));
  locks.forEach((l) => { connByAdj.get(l.edge)!.lock = l.id; });

  // keys: place in a room reachable from spawn without crossing lock i or any later lock; prefer off-path rooms
  const items: ItemSpawn[] = [];
  let itemN = 0;
  const lockEdges = new Set(locks.map((l) => l.edge));
  const roomCenter = (r: Room): Vec2 => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
  const randIn = (r: Room, rg: Rng, margin = 1.2): Vec2 => ({ x: r.x + margin + rg.next() * Math.max(0.1, r.w - margin * 2), z: r.z + margin + rg.next() * Math.max(0.1, r.d - margin * 2) });
  locks.forEach((l, i) => {
    const banned = new Set(locks.slice(i).map((x) => x.edge));
    const { dist } = bfs(spawnRoom, banned);
    const onPath = new Set(criticalPath);
    const cands = [...dist.keys()].filter((r) => r !== spawnRoom && r !== exitRoom);
    const side = cands.filter((r) => !onPath.has(r));
    const pool = side.length ? side : cands.length ? cands : [spawnRoom];
    // farthest-ish rooms make the detour meaningful: weight by distance
    const room = rItems.weighted(pool.map((r) => [r, 1 + (dist.get(r) ?? 0)] as const));
    items.push({ id: `item${itemN++}`, item: l.id, kind: 'key', room, pos: randIn(rooms[room], rItems), unlocks: l.id });
  });

  // 5. loops that cannot bypass a lock: only join rooms in the same component of (tree minus locked edges)
  const comp = new Map<number, number>();
  let cid = 0;
  for (const r of rooms) {
    if (comp.has(r.id)) continue;
    const q = [r.id]; comp.set(r.id, cid);
    while (q.length) {
      const u = q.shift()!;
      for (const { to, edge } of treeAdj.get(u)!) if (!lockEdges.has(edge) && !comp.has(to)) { comp.set(to, cid); q.push(to); }
    }
    cid++;
  }
  const treeSet = new Set(tree);
  const loopCands = adj.map((_e, k) => k).filter((k) => !treeSet.has(k) && comp.get(adj[k].a) === comp.get(adj[k].b));
  rLayout.shuffle(loopCands);
  const loopCount = Math.min(loopCands.length, Math.round(rooms.length * o.loops));
  for (let i = 0; i < loopCount; i++) {
    const e = adj[loopCands[i]];
    connections.push({ id: connections.length, a: e.a, b: e.b, door: e.door, axis: e.axis, width: doorW, lock: null });
  }

  // kinds: supply room near the start, nests far from spawn (never on the first stretch / critical path ends), dead ends
  const degree = new Map<number, number>(rooms.map((r) => [r.id, 0]));
  connections.forEach((c) => { degree.set(c.a, degree.get(c.a)! + 1); degree.set(c.b, degree.get(c.b)! + 1); });
  const { dist: fromSpawn } = bfs(spawnRoom);
  const onPathSet = new Set(criticalPath);
  const nonPath = rooms.filter((r) => !onPathSet.has(r.id));
  const supply = [...nonPath].filter((r) => (fromSpawn.get(r.id) ?? 99) <= 3).sort((p, q) => (fromSpawn.get(p.id)! - fromSpawn.get(q.id)!))[0];
  if (supply) supply.kind = 'supply';
  const nestCands = nonPath.filter((r) => r.kind === 'room' && (fromSpawn.get(r.id) ?? 0) >= 3);
  rLayout.shuffle(nestCands);
  const entitySlots: EntitySlot[] = [];
  for (const r of nestCands.slice(0, o.nests)) { r.kind = 'nest'; entitySlots.push({ room: r.id, pos: roomCenter(r), role: 'nest' }); }
  rooms.forEach((r) => { if (r.kind === 'room' && degree.get(r.id) === 1) r.kind = 'dead'; });
  // a few patrol slots on the critical path (not the first two rooms)
  criticalPath.slice(2, -1).forEach((id, i) => { if (i % 2 === 0) entitySlots.push({ room: id, pos: roomCenter(rooms[id]), role: 'patrol' }); });

  // 6. waypoints: candidates near 1/3, 2/3 and ~0.85 of the critical path (seeded jitter), tucked into
  // off-route side rooms where possible. Greedy search keeps them spread out and away from nests.
  const waypoints: Waypoint[] = [];
  const rWp = rng.fork('waypoints');
  const pathLen = criticalPath.length;
  const tTargets = pathLen >= 7 ? [1 / 3, 2 / 3, 0.85] : [0.4, 0.72];
  const used = new Set<number>();
  const nestSlots = entitySlots.filter((s) => s.role === 'nest');
  const awayFromNests = (p: Vec2) => nestSlots.every((s) => Math.hypot(s.pos.x - p.x, s.pos.z - p.z) >= 10);
  for (const t0 of tTargets) {
    const want = t0 + rWp.range(-0.04, 0.04);
    const idxs = Array.from({ length: pathLen }, (_, i) => i)
      .filter((i) => i / (pathLen - 1) >= 0.12 && i / (pathLen - 1) <= 0.9)
      .sort((p, q) => Math.abs(p / (pathLen - 1) - want) - Math.abs(q / (pathLen - 1) - want));
    let placed = false;
    for (const idx of idxs) {
      const t = idx / (pathLen - 1);
      if (waypoints.some((w) => Math.abs(w.t - t) < 0.18)) continue;
      const anchor = criticalPath[idx];
      const near = connections.filter((c) => c.a === anchor || c.b === anchor).map((c) => (c.a === anchor ? c.b : c.a)).filter((r) => !onPathSet.has(r));
      const options = [...rWp.shuffle(near), anchor];
      for (const room of options) {
        const r = rooms[room];
        if (used.has(room) || r.kind === 'nest' || r.kind === 'supply' || r.kind === 'start' || r.kind === 'exit') continue;
        const corners: Vec2[] = [{ x: r.x + 1, z: r.z + 1 }, { x: r.x + r.w - 1, z: r.z + 1 }, { x: r.x + 1, z: r.z + r.d - 1 }, { x: r.x + r.w - 1, z: r.z + r.d - 1 }];
        const pos = rWp.shuffle(corners).find(awayFromNests);
        if (!pos) continue;
        used.add(room);
        waypoints.push({ room, pos, t });
        placed = true;
        break;
      }
      if (placed) break;
    }
  }
  waypoints.sort((p, q) => p.t - q.t);

  // loot
  const lootN = o.loot;
  for (let i = 0; i < lootN; i++) {
    const r = rItems.pick(rooms.filter((x) => x.kind !== 'exit'));
    items.push({ id: `item${itemN++}`, item: rItems.weighted([['battery', 3], ['almond_water', 3], ['bandage', 2], ['cracker', 2], ['glowstick', 1]]), kind: 'loot', room: r.id, pos: randIn(r, rItems), });
  }
  // extra supplies in the supply room
  if (supply) for (let i = 0; i < 3; i++) items.push({ id: `item${itemN++}`, item: i === 0 ? 'battery' : i === 1 ? 'almond_water' : 'bandage', kind: 'loot', room: supply.id, pos: randIn(supply, rItems) });

  // nav graph: room centres + door nodes
  const nodes: NavNode[] = [];
  const edges: NavEdge[] = [];
  const centerNode = new Map<number, number>();
  for (const r of rooms) { centerNode.set(r.id, nodes.length); nodes.push({ id: nodes.length, pos: roomCenter(r), room: r.id }); }
  const dist2 = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.z - q.z);
  for (const c of connections) {
    const dn = nodes.length;
    nodes.push({ id: dn, pos: c.door, room: c.a });
    for (const rid of [c.a, c.b]) {
      const cn = centerNode.get(rid)!;
      edges.push({ a: cn, b: dn, cost: dist2(nodes[cn].pos, c.door), connection: c.id });
    }
  }

  // time estimate: path walk + key detours + puzzle time
  let pathMeters = 0;
  for (let i = 0; i + 1 < criticalPath.length; i++) pathMeters += dist2(roomCenter(rooms[criticalPath[i]]), roomCenter(rooms[criticalPath[i + 1]]));
  let detour = 0;
  for (const it of items.filter((x) => x.kind === 'key')) {
    const lock = locks.find((l) => l.id === it.item)!;
    const lockRoom = criticalPath[lock.pathIdx];
    detour += 2 * dist2(roomCenter(rooms[it.room]), roomCenter(rooms[lockRoom])) * 1.3;
  }
  const estSeconds = (pathMeters * 1.25 + detour) / WALK_SPEED + locks.length * PUZZLE_SECONDS;

  const spawnR = rooms[spawnRoom];
  return {
    levelId: o.levelId, seed, tier: o.tier,
    bounds: { x0: 0, z0: 0, x1: o.width, z1: o.depth },
    rooms, connections,
    spawn: { room: spawnRoom, pos: roomCenter(spawnR) },
    exit: { room: exitRoom, pos: roomCenter(rooms[exitRoom]) },
    criticalPath, waypoints, items, entitySlots,
    nav: { nodes, edges },
    estSeconds,
    size: Math.min(1, pathLen / 10),
  };
}
