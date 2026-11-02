/**
 * WorkerPool: round-robin Web Workers for chunk meshing and texture synthesis. Falls back to
 * running handlers inline (async, in a microtask) where Workers are unavailable (Node, tests).
 * Plans are broadcast once to every worker; chunk requests then reference `planId`.
 */
import { handle, type WorkRequest, type WorkResult } from './handlers';
import type { ChunkData } from './mesher';
import type { TexKind, TexSet } from './textures';
import type { LevelPlan } from './types';

export class WorkerPool {
  private workers: Worker[] = [];
  private load: number[] = [];
  private pending = new Map<number, { resolve(r: WorkResult): void; reject(e: Error): void }>();
  private nextId = 1;
  private nextPlan = 1;
  readonly inline: boolean;

  constructor(size = Math.max(1, Math.min(3, (navigator?.hardwareConcurrency ?? 4) - 1)), forceInline = false) {
    this.inline = forceInline || typeof Worker === 'undefined';
    if (this.inline) return;
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ id: number; result?: WorkResult; error?: string }>) => {
          const p = this.pending.get(e.data.id);
          if (!p) return;
          this.pending.delete(e.data.id);
          const i2 = this.workers.indexOf(w);
          if (i2 >= 0) this.load[i2]--;
          if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result ?? null);
        };
        this.workers.push(w);
        this.load.push(0);
      }
    } catch { this.workers = []; }
    (this as { inline: boolean }).inline = this.workers.length === 0;
  }

  private send(req: WorkRequest, worker?: number): Promise<WorkResult> {
    if (this.inline) {
      return new Promise((res, rej) => queueMicrotask(() => { try { res(handle(req).result); } catch (e) { rej(e as Error); } }));
    }
    const id = this.nextId++;
    let wi = worker ?? 0;
    if (worker === undefined) for (let i = 1; i < this.workers.length; i++) if (this.load[i] < this.load[wi]) wi = i;
    this.load[wi]++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workers[wi].postMessage({ id, req });
    });
  }

  /** Register a plan with every worker. Returns its id. */
  async setPlan(plan: LevelPlan): Promise<number> {
    const planId = this.nextPlan++;
    if (this.inline) handle({ type: 'plan', planId, plan });
    else await Promise.all(this.workers.map((_, i) => this.send({ type: 'plan', planId, plan }, i)));
    return planId;
  }

  chunk(planId: number, cx: number, cz: number, quality: number): Promise<ChunkData> {
    return this.send({ type: 'chunk', planId, cx, cz, quality }) as Promise<ChunkData>;
  }

  texture(kind: TexKind, seed: number, size: number, variant: number): Promise<TexSet> {
    return this.send({ type: 'texture', kind, seed, size, variant }) as Promise<TexSet>;
  }

  dispose(): void { this.workers.forEach((w) => w.terminate()); this.workers = []; }
}
