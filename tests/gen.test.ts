import { describe, expect, it } from 'vitest';
import { LEVELS, levelById, campaignLevels } from '../src/levels/registry';
import { validateLevel, validatePlan, simulateReach } from '../src/gen/validate';
import { optionsFor } from '../tools/validate-config';
import { DIFFICULTY_ORDER } from '../src/core/difficulty';
import { waypointsFor } from '../src/gen/waypoints';
import { chunkKey, indexChunks, meshChunk, transferables, chunkTriangles } from '../src/gen/mesher';
import { ChunkStreamer } from '../src/gen/chunks';
import { synthTexture } from '../src/gen/textures';
import { makeImpulse, rt60For } from '../src/audio/reverb';
import { WorkerPool } from '../src/gen/pool';
import { StaticWorld } from '../src/core/collision';
import { Rng } from '../src/gen/rng';

describe('level validators', () => {
  for (const def of LEVELS) {
    it(`${def.id}: 60 seeds pass every validator`, () => {
      const r = validateLevel(def, 60, optionsFor(def.id));
      expect(r.failures.slice(0, 3)).toEqual([]);
    });
  }
  it('the registry is the single table (hub/bot/validators read it)', () => {
    expect(levelById('placeholder')).toBeDefined(); expect(levelById('testroom')).toBeDefined(); expect(levelById('nope')).toBeUndefined();
    expect(campaignLevels().every((l) => !l.dev)).toBe(true);
  });
  it('validators actually catch broken plans', () => {
    const def = levelById('placeholder')!;
    const good = def.generate(5);
    expect(validatePlan(def, good)).toEqual([]);
    const bad = JSON.parse(JSON.stringify(good));
    bad.items.filter((i: { kind: string }) => i.kind === 'key').forEach((i: { room: number }) => { i.room = bad.exit.room; }); // keys behind their own locks
    expect(validatePlan(def, bad).length).toBeGreaterThan(0);
    const overlap = JSON.parse(JSON.stringify(good)); overlap.rooms[1].x = overlap.rooms[0].x; overlap.rooms[1].z = overlap.rooms[0].z;
    expect(validatePlan(def, overlap).some((e) => e.includes('overlap'))).toBe(true);
    const wp = JSON.parse(JSON.stringify(good)); wp.waypoints[0].t = 0.02;
    expect(validatePlan(def, wp).some((e) => e.includes('first/last stretch'))).toBe(true);
    const nest = JSON.parse(JSON.stringify(good)); const nestRoom = nest.rooms.find((r: { kind: string }) => r.kind === 'nest');
    if (nestRoom) { nest.waypoints[0].room = nestRoom.id; expect(validatePlan(def, nest).some((e) => e.includes('nest'))).toBe(true); }
  });
  it('locks always matter: keys reachable only before their locks', () => {
    const def = levelById('placeholder')!;
    for (let s = 0; s < 40; s++) {
      const plan = def.generate(s * 13 + 1);
      const sim = simulateReach(plan);
      expect(sim.rooms.has(plan.exit.room)).toBe(true);
      // without any keys the exit must be unreachable when locks exist (locks cannot be bypassed by loops)
      if (plan.connections.some((c) => c.lock)) {
        const noKeys = { ...plan, items: plan.items.filter((i) => i.kind !== 'key') };
        expect(simulateReach(noKeys).rooms.has(plan.exit.room)).toBe(false);
      }
    }
  });
  it('waypoints: 2-3 candidates, spread, none for hardcore, layout same for all difficulties', () => {
    const def = levelById('placeholder')!;
    for (let s = 0; s < 40; s++) {
      const plan = def.generate(s * 31 + 2);
      expect(plan.waypoints.length).toBeGreaterThanOrEqual(2); expect(plan.waypoints.length).toBeLessThanOrEqual(3);
      expect(waypointsFor(plan, 'hardcore')).toHaveLength(0);
      expect(waypointsFor(plan, 'easy').length).toBe(plan.waypoints.length);
      expect(waypointsFor(plan, 'nightmare').length).toBeGreaterThanOrEqual(1);
      expect(waypointsFor(plan, 'hard').length).toBeLessThanOrEqual(2);
      const json = JSON.stringify(plan);
      for (const d of DIFFICULTY_ORDER) expect(JSON.stringify(def.generate(s * 31 + 2, { difficulty: d }))).toBe(json);
    }
  });
});

describe('chunk meshing and streaming', () => {
  const plan = levelById('placeholder')!.generate(77);
  it('meshes every chunk deterministically, independent of order', () => {
    const idx = [...indexChunks(plan).values()];
    const a = idx.map((c) => meshChunk(plan, c.cx, c.cz, { level: 3 }));
    const b = [...idx].reverse().map((c) => meshChunk(plan, c.cx, c.cz, { level: 3 })).reverse();
    expect(JSON.stringify(a.map((c) => [c.key, c.lights, c.colliders, chunkTriangles(c)]))).toBe(JSON.stringify(b.map((c) => [c.key, c.lights, c.colliders, chunkTriangles(c)])));
    expect(a.every((c) => chunkTriangles(c) > 0)).toBe(true);
    expect(a.flatMap((c) => c.rooms).sort((x, y) => x - y)).toEqual(plan.rooms.map((r) => r.id));
  });
  it('quality scales detail: potato has fewer triangles than ultra', () => {
    const tri = (lvl: number) => [...indexChunks(plan).values()].reduce((n, c) => n + chunkTriangles(meshChunk(plan, c.cx, c.cz, { level: lvl })), 0);
    expect(tri(0)).toBeLessThan(tri(4));
  });
  it('geometry arrays are well formed and transferable', () => {
    const c = indexChunks(plan).values().next().value!;
    const m = meshChunk(plan, c.cx, c.cz, { level: 4 });
    for (const mesh of Object.values(m.meshes)) {
      expect(mesh!.positions.length / 3).toBe(mesh!.normals.length / 3); expect(mesh!.positions.length / 3).toBe(mesh!.uvs.length / 2);
      expect(Math.max(...mesh!.indices)).toBeLessThan(mesh!.positions.length / 3);
      expect(mesh!.positions.every(Number.isFinite)).toBe(true);
    }
    expect(transferables(m).length).toBe(Object.keys(m.meshes).length * 4);
    expect(m.key).toBe(chunkKey(c.cx, c.cz));
  });
  it('spawn, items, waypoints and nav nodes are never inside collision walls', () => {
    for (const seed of [3, 4, 5, 6, 7]) {
      const p = levelById('placeholder')!.generate(seed);
      const w = new StaticWorld();
      for (const c of indexChunks(p).values()) w.add(`c${c.cx},${c.cz}`, meshChunk(p, c.cx, c.cz, { level: 0 }).colliders);
      expect(w.overlapsCircle(p.spawn.pos.x, p.spawn.pos.z, 0.3)).toBe(false);
      for (const wp of p.waypoints) expect(w.overlapsCircle(wp.pos.x, wp.pos.z, 0.3)).toBe(false);
      for (const it of p.items) expect(w.overlapsCircle(it.pos.x, it.pos.z, 0.25)).toBe(false);
      for (const n of p.nav.nodes) expect(w.overlapsCircle(n.pos.x, n.pos.z, 0.3), `nav node ${n.id}`).toBe(false);
    }
  });
  it('the streamer loads near chunks first, caps in-flight builds, and unloads with hysteresis', async () => {
    const loaded: string[] = [], unloaded: string[] = [];
    let inFlight = 0, maxInFlight = 0;
    const idx = indexChunks(plan);
    const s = new ChunkStreamer(plan, async (cx, cz) => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise((r) => setTimeout(r, 1)); inFlight--; return meshChunk(plan, cx, cz, { level: 0 }); },
      { loadRadius: 20, unloadMargin: 10, maxInFlight: 2, maxApplyPerFrame: 2 }, { onLoad: (c) => loaded.push(c.key), onUnload: (k) => unloaded.push(k) });
    const near = plan.spawn.pos;
    for (let i = 0; i < 60; i++) { s.update(near.x, near.z); await new Promise((r) => setTimeout(r, 2)); }
    expect(loaded.length).toBeGreaterThan(0); expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(loaded.length).toBeLessThan(idx.size + 1);
    // move far away: everything beyond radius+margin unloads
    for (let i = 0; i < 20; i++) { s.update(near.x + 500, near.z + 500); await new Promise((r) => setTimeout(r, 2)); }
    expect(s.loaded.size).toBe(0); expect(unloaded.length).toBe(loaded.length);
  });
  it('the worker pool falls back to inline execution in Node and produces identical chunks', async () => {
    const pool = new WorkerPool(1, true);
    const id = await pool.setPlan(plan);
    const c = indexChunks(plan).values().next().value!;
    const viaPool = await pool.chunk(id, c.cx, c.cz, 2);
    expect(pool.inline).toBe(true);
    expect(JSON.stringify(viaPool.colliders)).toBe(JSON.stringify(meshChunk(plan, c.cx, c.cz, { level: 2 }).colliders));
    const t = await pool.texture('carpet', 1, 32, 0);
    expect(t.albedo.length).toBe(32 * 32 * 4);
    pool.dispose();
  });
});

describe('procedural textures and audio IR', () => {
  it('textures are deterministic, sized correctly and differ by kind', () => {
    const a = synthTexture('concrete', 9, 64), b = synthTexture('concrete', 9, 64), c = synthTexture('tile', 9, 64);
    expect(Array.from(a.albedo.slice(0, 200))).toEqual(Array.from(b.albedo.slice(0, 200)));
    expect(Array.from(a.albedo.slice(0, 200))).not.toEqual(Array.from(c.albedo.slice(0, 200)));
    for (const buf of [a.albedo, a.normal, a.orm]) expect(buf.length).toBe(64 * 64 * 4);
  });
  it('normal maps point mostly outward and every kind generates', () => {
    for (const kind of ['wallpaper', 'carpet', 'concrete', 'tile', 'metal', 'ceiling', 'stain'] as const) {
      const t = synthTexture(kind, 3, 32, 1);
      let z = 0; for (let i = 0; i < 32 * 32; i++) z += t.normal[i * 4 + 2];
      expect(z / (32 * 32), kind).toBeGreaterThan(160);
    }
  });
  it('textures tile: opposite edges are similar', () => {
    const t = synthTexture('concrete', 5, 64);
    let diff = 0; for (let y = 0; y < 64; y++) diff += Math.abs(t.albedo[(y * 64) * 4] - t.albedo[(y * 64 + 63) * 4]);
    expect(diff / 64).toBeLessThan(25);
  });
  it('reverb IR: right length, decays, deterministic; bigger/harder rooms ring longer', () => {
    const ir = makeImpulse(8000, 1, 0.5, 4), again = makeImpulse(8000, 1, 0.5, 4);
    expect(ir[0].length).toBe(8000); expect(Array.from(ir[0].slice(0, 50))).toEqual(Array.from(again[0].slice(0, 50)));
    const e = (a: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return s; };
    expect(e(ir[0], 0, 2000)).toBeGreaterThan(e(ir[0], 6000, 8000) * 20);
    expect(rt60For(20, 20, 4, 'concrete')).toBeGreaterThan(rt60For(4, 4, 2.5, 'concrete'));
    expect(rt60For(10, 10, 3, 'tile')).toBeGreaterThan(rt60For(10, 10, 3, 'carpet'));
  });
  it('collision slides along walls and cannot pass through them', () => {
    const w = new StaticWorld(); w.add('wall', [{ x0: 5, x1: 5.2, z0: -10, z1: 10 }]);
    const p = { x: 0, z: 0 }; const r = new Rng(1);
    for (let i = 0; i < 400; i++) w.move(p, 0.1 + r.next() * 0.2, (r.next() - 0.5) * 0.1, 0.3);
    expect(p.x).toBeLessThanOrEqual(5 - 0.3 + 1e-6);
    const q = { x: 0, z: 0 }; w.move(q, 20, 0, 0.3); expect(q.x).toBeLessThan(5);
    w.remove('wall'); const q2 = { x: 0, z: 0 }; w.move(q2, 20, 0, 0.3); expect(q2.x).toBeCloseTo(20);
  });
});
