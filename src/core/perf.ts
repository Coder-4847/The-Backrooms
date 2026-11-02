/**
 * In-browser performance run used by tools/perf.ts (spec 0.3 #7): load a level at a tier and fly a
 * scripted camera along the critical path while recording frame times, draw calls, triangles,
 * memory and chunk generation time. Frame-time budgets only mean something on a real GPU, so the
 * result also reports the GPU string and whether it is a software renderer.
 */
import type { Game } from './game';
import type { TierSetting } from './settings';

export interface PerfResult {
  level: string; tier: string; gpu: string; software: boolean;
  frames: number; avgMs: number; p99Ms: number; fps: number; low1Fps: number;
  callsAvg: number; callsMax: number; trisAvg: number; trisMax: number;
  loadMs: number; chunkAvgMs: number; chunkMaxMs: number;
  heapMb: number; geometries: number; textures: number; scale: number;
}

export async function runPerf(game: Game, opts: { level: string; seed: number; tier: TierSetting; seconds: number; maxFrames?: number }): Promise<PerfResult> {
  game.settings.set('tier', opts.tier);
  const t0 = performance.now();
  await game.startLevel(opts.level, opts.seed, 'normal');
  const loadMs = performance.now() - t0;
  const L = game.level!;
  const plan = L.plan;
  L.sim.player.god = true;
  // build a polyline: room centres along the critical path, through the doors between them
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < plan.criticalPath.length; i++) {
    const r = plan.rooms[plan.criticalPath[i]];
    if (i > 0) { const prev = plan.criticalPath[i - 1]; const c = plan.connections.find((k) => (k.a === prev && k.b === r.id) || (k.b === prev && k.a === r.id)); if (c) pts.push(c.door); }
    pts.push({ x: r.x + r.w / 2, z: r.z + r.d / 2 });
  }
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = seg[seg.length - 1] || 1;

  const times: number[] = [], calls: number[] = [], tris: number[] = [];
  let dist = 0;
  const start = performance.now();
  const gl = game.gfx.hardwareInfo();
  await new Promise<void>((resolve) => {
    game.perfHook = (dt, frameMs) => {
      times.push(frameMs);
      const st = game.gfx.stats(); calls.push(st.calls); tris.push(st.triangles);
      dist = (dist + 3.2 * dt) % total;
      let i = 1; while (i < seg.length - 1 && seg[i] < dist) i++;
      const f = (dist - seg[i - 1]) / Math.max(1e-6, seg[i] - seg[i - 1]);
      const a = pts[i - 1], b = pts[i];
      const p = L.sim.player;
      p.x = p.px = a.x + (b.x - a.x) * f; p.z = p.pz = a.z + (b.z - a.z) * f;
      p.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)); p.pitch = -0.05;
      if (performance.now() - start > opts.seconds * 1000 || times.length >= (opts.maxFrames ?? 1e9)) resolve();
    };
  });
  game.perfHook = null;
  const sorted = [...times].sort((x, y) => x - y);
  const avg = times.reduce((x, y) => x + y, 0) / Math.max(1, times.length);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
  const st = L.stats();
  const gi = game.gfx.stats();
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {
    level: opts.level, tier: game.tier().id, gpu: gl.gpu, software: /swiftshader|llvmpipe|software/i.test(gl.gpu),
    frames: times.length, avgMs: avg, p99Ms: p99, fps: 1000 / avg, low1Fps: 1000 / (p99 || 1),
    callsAvg: mean(calls), callsMax: Math.max(0, ...calls), trisAvg: mean(tris), trisMax: Math.max(0, ...tris),
    loadMs, chunkAvgMs: st.chunkBuildAvgMs, chunkMaxMs: st.chunkBuildMaxMs,
    heapMb: mem ? mem.usedJSHeapSize / 1048576 : 0, geometries: gi.geometries, textures: gi.textures, scale: game.gfx.scale,
  };
}
