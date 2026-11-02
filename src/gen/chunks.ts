/**
 * Chunk streaming skeleton. Decides which chunks to load/unload around a point, limits in-flight
 * builds, and applies finished chunks at most N per frame so generation never hitches gameplay.
 * The builder is injected (worker pool, inline, or a fake in tests).
 */
import { chunkKey, indexChunks, type ChunkData } from './mesher';
import type { LevelPlan } from './types';

export interface StreamOptions {
  loadRadius: number;
  /** Hysteresis: chunks unload only beyond loadRadius + this. */
  unloadMargin: number;
  maxInFlight: number;
  maxApplyPerFrame: number;
}

export type ChunkBuilder = (cx: number, cz: number) => Promise<ChunkData>;

export class ChunkStreamer {
  private index: ReturnType<typeof indexChunks>;
  readonly loaded = new Map<string, ChunkData>();
  private pending = new Set<string>();
  private ready: ChunkData[] = [];
  /** Average build time (ms) for perf reports. */
  buildMs = { count: 0, total: 0, max: 0 };

  constructor(
    plan: LevelPlan,
    private build: ChunkBuilder,
    private opt: StreamOptions,
    private hooks: { onLoad(c: ChunkData): void; onUnload(key: string): void },
  ) {
    this.index = indexChunks(plan);
  }

  get chunkCount(): number { return this.index.size; }
  get pendingCount(): number { return this.pending.size; }
  bounds(key: string) { return this.index.get(key)?.bounds; }
  allKeys(): string[] { return [...this.index.keys()]; }

  private distTo(key: string, x: number, z: number): number {
    const b = this.index.get(key)!.bounds;
    const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1);
    return Math.hypot(dx, dz);
  }

  /** Call once per frame with the viewer position. Closest chunks are requested first. */
  update(x: number, z: number): void {
    const want: { key: string; d: number }[] = [];
    for (const key of this.index.keys()) {
      const d = this.distTo(key, x, z);
      if (d <= this.opt.loadRadius) want.push({ key, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const { key } of want) {
      if (this.pending.size >= this.opt.maxInFlight) break;
      if (this.loaded.has(key) || this.pending.has(key)) continue;
      const c = this.index.get(key)!;
      this.pending.add(key);
      const t0 = performance.now();
      this.build(c.cx, c.cz).then((data) => {
        const ms = performance.now() - t0;
        this.buildMs.count++; this.buildMs.total += ms; this.buildMs.max = Math.max(this.buildMs.max, ms);
        this.ready.push(data);
      }).catch((e) => { console.error('chunk build failed', key, e); this.pending.delete(key); });
    }
    // apply finished chunks (bounded per frame)
    for (let i = 0; i < this.opt.maxApplyPerFrame && this.ready.length; i++) {
      const data = this.ready.shift()!;
      this.pending.delete(data.key); // stays "pending" until applied/discarded so it is never built twice
      if (this.distTo(data.key, x, z) > this.opt.loadRadius + this.opt.unloadMargin) continue; // player moved away already
      this.loaded.set(data.key, data);
      this.hooks.onLoad(data);
    }
    // unload far chunks
    for (const key of [...this.loaded.keys()]) {
      if (this.distTo(key, x, z) > this.opt.loadRadius + this.opt.unloadMargin) {
        this.loaded.delete(key);
        this.hooks.onUnload(key);
      }
    }
  }

  /** Synchronously load everything within radius (used during loading screens). */
  async preload(x: number, z: number, radius = this.opt.loadRadius): Promise<void> {
    const keys = [...this.index.keys()].filter((k) => this.distTo(k, x, z) <= radius && !this.loaded.has(k));
    await Promise.all(keys.map(async (k) => {
      const c = this.index.get(k)!;
      const t0 = performance.now();
      const data = await this.build(c.cx, c.cz);
      const ms = performance.now() - t0;
      this.buildMs.count++; this.buildMs.total += ms; this.buildMs.max = Math.max(this.buildMs.max, ms);
      this.loaded.set(k, data);
      this.hooks.onLoad(data);
    }));
  }
}

export { chunkKey };
