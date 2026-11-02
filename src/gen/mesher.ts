/**
 * Pure chunk mesher: LevelPlan + chunk key -> typed-array geometry, colliders and light defs.
 * No THREE dependency, so it runs in a Web Worker (transferable buffers), inline, or in Node tests.
 * A room belongs to the chunk containing its centre; walls are 0.2 m thick (each room draws its
 * own inward faces, door reveals/lintels are drawn once by the lower-id room).
 */
import { cellRng } from './rng';
import type { Connection, LevelPlan, Room } from './types';

export const CHUNK_SIZE = 24;
export const WALL_HALF = 0.1;
export const DOOR_HEIGHT = 2.2;

export type MatKey = 'wall0' | 'wall1' | 'wall2' | 'wall3' | 'floor' | 'floorTile' | 'ceiling' | 'trim' | 'decal' | 'tbar';
/** Suspended-ceiling grid pitch (3 tiles per 2 m texture tile, so the T-bars line up with the texture). */
export const CEIL_GRID = 2 / 3;
/** Light fixture (2x4 troffer) panel size: spans 2x1 grid cells. */
export const LAMP_W = CEIL_GRID * 2 - 0.03, LAMP_D = CEIL_GRID - 0.03;

export interface MeshData { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array }
export interface Box2 { x0: number; z0: number; x1: number; z1: number }
export interface LightDef { x: number; y: number; z: number; room: number; flicker: boolean; broken: boolean; color: number; intensity: number }
export interface ChunkData {
  key: string; cx: number; cz: number;
  rooms: number[];
  bounds: { x0: number; z0: number; x1: number; z1: number; y1: number };
  meshes: Partial<Record<MatKey, MeshData>>;
  colliders: Box2[];
  lights: LightDef[];
}

export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

/** Chunk index: which rooms live in which chunk, with bounds. Cheap; built once per plan. */
export function indexChunks(plan: LevelPlan): Map<string, { cx: number; cz: number; rooms: number[]; bounds: ChunkData['bounds'] }> {
  const out = new Map<string, { cx: number; cz: number; rooms: number[]; bounds: ChunkData['bounds'] }>();
  for (const r of plan.rooms) {
    const cx = Math.floor((r.x + r.w / 2) / CHUNK_SIZE), cz = Math.floor((r.z + r.d / 2) / CHUNK_SIZE);
    const key = chunkKey(cx, cz);
    let c = out.get(key);
    if (!c) out.set(key, (c = { cx, cz, rooms: [], bounds: { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, y1: 0 } }));
    c.rooms.push(r.id);
    c.bounds.x0 = Math.min(c.bounds.x0, r.x); c.bounds.z0 = Math.min(c.bounds.z0, r.z);
    c.bounds.x1 = Math.max(c.bounds.x1, r.x + r.w); c.bounds.z1 = Math.max(c.bounds.z1, r.z + r.d);
    c.bounds.y1 = Math.max(c.bounds.y1, r.height);
  }
  return out;
}

class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; idx: number[] = [];
  /** Quad with corners a,b,c,d counter-clockwise seen from the normal side. UVs in world metres / 2. */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], ua: number[], ub: number[], uc: number[], ud: number[]): void {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nor.push(n[0], n[1], n[2]);
    for (const u of [ua, ub, uc, ud]) this.uv.push(u[0], u[1]);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  done(): MeshData | undefined {
    if (!this.idx.length) return undefined;
    return { positions: new Float32Array(this.pos), normals: new Float32Array(this.nor), uvs: new Float32Array(this.uv), indices: new Uint32Array(this.idx) };
  }
}

const S = 0.5; // uv scale: 1 uv unit = 2 m

/** Vertical wall quad between (x0,z0)-(x1,z1) from y0..y1 facing normal (nx,nz). */
function wallQuad(b: Builder, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nx: number, nz: number): void {
  if (Math.hypot(x1 - x0, z1 - z0) < 1e-4 || y1 - y0 < 1e-4) return;
  // ordering so the face is counter-clockwise when viewed from (nx,nz)
  const flip = (x1 - x0) * nz - (z1 - z0) * nx > 0 ? false : true;
  const ax = flip ? x1 : x0, az = flip ? z1 : z0, bx = flip ? x0 : x1, bz = flip ? z0 : z1;
  const len = Math.hypot(bx - ax, bz - az);
  const u0 = (ax * Math.abs(nz) + az * Math.abs(nx)) * S;
  const u1 = u0 + (Math.sign((bx - ax) * Math.abs(nz) + (bz - az) * Math.abs(nx)) || 1) * len * S;
  b.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], [nx, 0, nz], [u0, y0 * S], [u1, y0 * S], [u1, y1 * S], [u0, y1 * S]);
}

/** Axis-aligned box with only the listed faces ('+x','-x','+y','-y','+z','-z'); uv in world metres / 2. */
function box(b: Builder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, faces: string): void {
  if (faces.includes('+y')) b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 * S, z1 * S], [x1 * S, z1 * S], [x1 * S, z0 * S], [x0 * S, z0 * S]);
  if (faces.includes('-y')) b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 * S, z0 * S], [x1 * S, z0 * S], [x1 * S, z1 * S], [x0 * S, z1 * S]);
  if (faces.includes('+x')) wallQuad(b, x1, z0, x1, z1, y0, y1, 1, 0);
  if (faces.includes('-x')) wallQuad(b, x0, z0, x0, z1, y0, y1, -1, 0);
  if (faces.includes('+z')) wallQuad(b, x0, z1, x1, z1, y0, y1, 0, 1);
  if (faces.includes('-z')) wallQuad(b, x0, z0, x1, z0, y0, y1, 0, -1);
}

/** Ceiling lights of one room: a ~5 m grid snapped to the T-bar grid (2x4 troffers along x). Seeded flicker/broken. */
export function roomLights(plan: LevelPlan, r: Room, rng: { next(): number }): LightDef[] {
  const out: LightDef[] = [];
  if (r.open) return out;
  const G = CEIL_GRID, H = r.height;
  const nxL = Math.max(1, Math.round(r.w / 5)), nzL = Math.max(1, Math.round(r.d / 5));
  for (let i = 0; i < nxL; i++) for (let j = 0; j < nzL; j++) {
    const roll = rng.next();
    let x = Math.round((r.x + ((i + 0.5) / nxL) * r.w) / G) * G;
    let z = (Math.floor((r.z + ((j + 0.5) / nzL) * r.d) / G) + 0.5) * G;
    x = Math.min(r.x + r.w - 0.9, Math.max(r.x + 0.9, x)); z = Math.min(r.z + r.d - 0.6, Math.max(r.z + 0.6, z));
    out.push({
      x, y: H - 0.06, z, room: r.id,
      flicker: roll < (plan.flicker ?? 0.18), broken: roll > 0.94 || (plan.unlit?.includes(r.id) ?? false), color: r.kind === 'supply' ? 0xfff0d0 : 0xfff2c0, intensity: 0.9 + rng.next() * 0.2,
    });
  }
  return out;
}

/** Every ceiling light of the level (same values the chunk mesher produces). Used for light baking. */
export function levelLights(plan: LevelPlan): LightDef[] {
  const out: LightDef[] = [];
  for (const c of indexChunks(plan).values()) {
    const rng = cellRng(plan.seed, c.cx, c.cz, 17);
    for (const rid of c.rooms) out.push(...roomLights(plan, plan.rooms[rid], rng));
  }
  return out;
}

interface WallSide { axis: 'x' | 'z'; fixed: number; lo: number; hi: number; nx: number; nz: number; doors: Connection[]; plane: number }

function doorsOnSide(plan: LevelPlan, room: Room, side: 'N' | 'S' | 'W' | 'E'): Connection[] {
  const e = 1e-3;
  return plan.connections.filter((c) => {
    if (c.a !== room.id && c.b !== room.id) return false;
    if (side === 'N') return c.axis === 'x' && Math.abs(c.door.z - room.z) < e;
    if (side === 'S') return c.axis === 'x' && Math.abs(c.door.z - (room.z + room.d)) < e;
    if (side === 'W') return c.axis === 'z' && Math.abs(c.door.x - room.x) < e;
    return c.axis === 'z' && Math.abs(c.door.x - (room.x + room.w)) < e;
  });
}

export interface MeshQuality { /** 0 potato .. 4 ultra */ level: number }

export function meshChunk(plan: LevelPlan, cx: number, cz: number, q: MeshQuality): ChunkData {
  const index = indexChunks(plan).get(chunkKey(cx, cz));
  const key = chunkKey(cx, cz);
  const empty: ChunkData = { key, cx, cz, rooms: [], bounds: { x0: 0, z0: 0, x1: 0, z1: 0, y1: 0 }, meshes: {}, colliders: [], lights: [] };
  if (!index) return empty;

  const builders: Partial<Record<MatKey, Builder>> = {};
  const B = (k: MatKey) => (builders[k] ??= new Builder());
  const colliders: Box2[] = [];
  const seen = new Set<string>();
  const lights: LightDef[] = [];
  const rng = cellRng(plan.seed, cx, cz, 17);
  const drng = cellRng(plan.seed, cx, cz, 18);
  const t = WALL_HALF;

  for (const rid of index.rooms) {
    const r = plan.rooms[rid];
    const H = r.height;
    const wallMat = (`wall${r.variant % 4}`) as MatKey;
    const floorMat: MatKey = r.kind === 'supply' ? 'floorTile' : 'floor';
    const x0 = r.x, x1 = r.x + r.w, z0 = r.z, z1 = r.z + r.d;

    if (r.open) {
      B(floorMat).quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [x0 * S, z1 * S], [x1 * S, z1 * S], [x1 * S, z0 * S], [x0 * S, z0 * S]);
      continue; // outdoors: no walls, ceiling or lamps
    }
    // floor + ceiling (full rect, so no gaps under thick walls)
    B(floorMat).quad([x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [x0, 0, z0], [0, 1, 0], [x0 * S, z1 * S], [x1 * S, z1 * S], [x1 * S, z0 * S], [x0 * S, z0 * S]);
    B('ceiling').quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], [0, -1, 0], [x0 * S, z0 * S], [x1 * S, z0 * S], [x1 * S, z1 * S], [x0 * S, z1 * S]);

    // walls on each side, split around doors
    const sides: WallSide[] = [
      { axis: 'x', fixed: z0 + t, plane: z0, lo: x0 + t, hi: x1 - t, nx: 0, nz: 1, doors: doorsOnSide(plan, r, 'N') },
      { axis: 'x', fixed: z1 - t, plane: z1, lo: x0 + t, hi: x1 - t, nx: 0, nz: -1, doors: doorsOnSide(plan, r, 'S') },
      { axis: 'z', fixed: x0 + t, plane: x0, lo: z0 + t, hi: z1 - t, nx: 1, nz: 0, doors: doorsOnSide(plan, r, 'W') },
      { axis: 'z', fixed: x1 - t, plane: x1, lo: z0 + t, hi: z1 - t, nx: -1, nz: 0, doors: doorsOnSide(plan, r, 'E') },
    ];
    const wb = B(wallMat);
    for (const s of sides) {
      const gaps = s.doors.map((c) => {
        const mid = s.axis === 'x' ? c.door.x : c.door.z;
        return { c, a: Math.max(s.lo, mid - c.width / 2), b: Math.min(s.hi, mid + c.width / 2) };
      }).sort((p, q2) => p.a - q2.a);
      const seg = (a: number, b: number, y0: number, y1: number) => {
        if (b - a < 1e-4) return;
        if (s.axis === 'x') wallQuad(wb, a, s.fixed, b, s.fixed, y0, y1, s.nx, s.nz);
        else wallQuad(wb, s.fixed, a, s.fixed, b, y0, y1, s.nx, s.nz);
      };
      let cursor = s.lo;
      for (const g of gaps) {
        seg(cursor, g.a, 0, H);
        seg(g.a, g.b, DOOR_HEIGHT, H); // lintel
        cursor = g.b;
        // reveals (jambs + head) drawn once by the lower id room, spanning both wall planes
        const other = g.c.a === r.id ? g.c.b : g.c.a;
        if (r.id < other) {
          const out = s.axis === 'x' ? (s.nz > 0 ? -1 : 1) : (s.nx > 0 ? -1 : 1); // direction through the wall toward the neighbour
          const p0 = s.fixed, p1 = s.fixed + out * 2 * t;
          const jamb = (pos: number, towards: number) => {
            if (s.axis === 'x') wallQuad(wb, pos, p0, pos, p1, 0, DOOR_HEIGHT, towards, 0);
            else wallQuad(wb, p0, pos, p1, pos, 0, DOOR_HEIGHT, 0, towards);
          };
          jamb(g.a, 1); jamb(g.b, -1);
          const hb = B('trim');
          const lo = Math.min(p0, p1), hi = Math.max(p0, p1);
          if (s.axis === 'x') hb.quad([g.a, DOOR_HEIGHT, lo], [g.b, DOOR_HEIGHT, lo], [g.b, DOOR_HEIGHT, hi], [g.a, DOOR_HEIGHT, hi], [0, -1, 0], [g.a * S, lo * S], [g.b * S, lo * S], [g.b * S, hi * S], [g.a * S, hi * S]);
          else hb.quad([lo, DOOR_HEIGHT, g.b], [lo, DOOR_HEIGHT, g.a], [hi, DOOR_HEIGHT, g.a], [hi, DOOR_HEIGHT, g.b], [0, -1, 0], [lo * S, g.b * S], [lo * S, g.a * S], [hi * S, g.a * S], [hi * S, g.b * S]);
        }
        // door casing on this room's face: two jamb strips + a head strip, proud of the wall
        if (q.level >= 1) {
          const cb = B('trim'), cw = 0.07, cd = 0.018;
          const f0 = s.fixed, f1 = s.fixed + (s.axis === 'x' ? s.nz : s.nx) * cd;
          const lo = Math.min(f0, f1), hi = Math.max(f0, f1);
          const front = s.axis === 'x' ? (s.nz > 0 ? '+z' : '-z') : (s.nx > 0 ? '+x' : '-x');
          const along = s.axis === 'x' ? ['-x', '+x'] : ['-z', '+z'];
          const strip = (a: number, b: number, y0: number, y1: number, faces: string) => {
            if (s.axis === 'x') box(cb, a, y0, lo, b, y1, hi, faces); else box(cb, lo, y0, a, hi, y1, b, faces);
          };
          if (g.a - cw > s.lo) strip(g.a - cw, g.a, 0, DOOR_HEIGHT + cw, `${front}${along[0]}${along[1]}`);
          if (g.b + cw < s.hi) strip(g.b, g.b + cw, 0, DOOR_HEIGHT + cw, `${front}${along[0]}${along[1]}`);
          strip(Math.max(s.lo, g.a - cw), Math.min(s.hi, g.b + cw), DOOR_HEIGHT, DOOR_HEIGHT + cw, `${front}+y-y`);
        }
      }
      seg(cursor, s.hi, 0, H);

      // colliders (deduped by rounded coords): wall segments between gaps, centred on the room boundary
      const colSeg = (a: number, b: number) => {
        if (b - a < 0.05) return;
        const box: Box2 = s.axis === 'x' ? { x0: a - t, z0: s.plane - t, x1: b + t, z1: s.plane + t } : { x0: s.plane - t, z0: a - t, x1: s.plane + t, z1: b + t };
        const k = `${box.x0.toFixed(2)},${box.z0.toFixed(2)},${box.x1.toFixed(2)},${box.z1.toFixed(2)}`;
        if (seen.has(k)) return;
        seen.add(k); colliders.push(box);
      };
      let c2 = s.lo - t;
      for (const g of gaps) { colSeg(c2, g.a); c2 = g.b; }
      colSeg(c2, s.hi + t);
    }

    // baseboard trim on higher quality (decor pass)
    if (q.level >= 1) {
      const tb = B('trim');
      const bh = 0.1, bd = 0.016;
      // solid baseboards (front + top) split around door gaps
      for (const s of sides) {
        const cuts = s.doors.map((c) => { const mid = s.axis === 'x' ? c.door.x : c.door.z; return [mid - c.width / 2 - (q.level >= 1 ? 0.07 : 0), mid + c.width / 2 + (q.level >= 1 ? 0.07 : 0)]; }).sort((p, q2) => p[0] - q2[0]);
        let cur = s.lo;
        const run = (a: number, b: number) => {
          if (b - a < 0.02) return;
          const f0 = s.fixed, f1 = s.fixed + (s.axis === 'x' ? s.nz : s.nx) * bd, lo = Math.min(f0, f1), hi = Math.max(f0, f1);
          const front = s.axis === 'x' ? (s.nz > 0 ? '+z' : '-z') : (s.nx > 0 ? '+x' : '-x');
          if (s.axis === 'x') box(tb, a, 0, lo, b, bh, hi, `${front}+y`); else box(tb, lo, 0, a, hi, bh, b, `${front}+y`);
        };
        for (const [a, b] of cuts) { run(cur, Math.max(cur, a)); cur = Math.max(cur, b); }
        run(cur, s.hi);
      }
    }

    // ceiling lights: grid spacing ~5 m snapped to the T-bar grid, seeded flicker/broken
    const roomL = roomLights(plan, r, rng);
    lights.push(...roomL);

    // suspended-ceiling T-bar grid: thin painted-steel strips every CEIL_GRID metres (flush with the tile edges)
    {
      const G = CEIL_GRID, tw = 0.012, td = 0.014, bb = B('tbar');
      const xa = x0 + t, xb = x1 - t, za = z0 + t, zb = z1 - t;
      for (let k = Math.ceil(xa / G); k * G < xb; k++) { const x = k * G; if (x - xa < 0.05 || xb - x < 0.05) continue; box(bb, x - tw, H - td, za, x + tw, H, zb, '-y+x-x'); }
      for (let k = Math.ceil(za / G); k * G < zb; k++) { const z = k * G; if (z - za < 0.05 || zb - z < 0.05) continue; box(bb, xa, H - td - 0.001, z - tw, xb, H, z + tw, '-y+z-z'); }
      // wall angle: L-trim around the perimeter
      box(bb, xa, H - td, za, xb, H, za + 0.02, '-y+z'); box(bb, xa, H - td, zb - 0.02, xb, H, zb, '-y-z');
      box(bb, xa, H - td, za, xa + 0.02, H, zb, '-y+x'); box(bb, xb - 0.02, H - td, za, xb, H, zb, '-y-x');
    }

    // stain decals (quality scaled)
    const decals = q.level >= 2 ? Math.round(r.w * r.d / 60) : 0;
    for (let i = 0; i < decals; i++) {
      const rng = drng;
      const sx = r.x + 1 + rng.next() * (r.w - 2), sz = r.z + 1 + rng.next() * (r.d - 2), rad = 0.5 + rng.next() * 1.1;
      B('decal').quad([sx - rad, 0.004, sz + rad], [sx + rad, 0.004, sz + rad], [sx + rad, 0.004, sz - rad], [sx - rad, 0.004, sz - rad], [0, 1, 0], [0, 1], [1, 1], [1, 0], [0, 0]);
    }
  }

  const meshes: ChunkData['meshes'] = {};
  for (const k of Object.keys(builders) as MatKey[]) { const m = builders[k]!.done(); if (m) meshes[k] = m; }
  return { key, cx, cz, rooms: index.rooms, bounds: index.bounds, meshes, colliders, lights };
}

/** Transferable buffers of a chunk (for zero-copy postMessage). */
export function transferables(c: ChunkData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const m of Object.values(c.meshes)) if (m) out.push(m.positions.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer, m.uvs.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer);
  return out;
}

export function chunkTriangles(c: ChunkData): number {
  let n = 0;
  for (const m of Object.values(c.meshes)) if (m) n += m.indices.length / 3;
  return n;
}
