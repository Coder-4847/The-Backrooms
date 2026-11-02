/**
 * Noise (spec 5.6): every action has a loudness; it travels along the room graph and each hop
 * (a wall with a door) dampens it. Entities hear `heardAt(room)`. Locked doors muffle more.
 */
import type { LevelPlan } from '../gen/types';

export const NOISE = { walk: 0.35, sprint: 1, crouch: 0.1, item: 0.5, throw: 0.9, door: 0.6, pickup: 0.15, shout: 1.4 } as const;
const HOP_DAMPING = 0.55;

export interface NoiseEvent { room: number; x: number; z: number; loudness: number; age: number; /** propagation map, computed once at emit time */ map: Map<number, number> }

export class NoiseField {
  private adj: { to: number; lock: string | null }[][];
  events: NoiseEvent[] = [];
  constructor(plan: LevelPlan, private hop = HOP_DAMPING) {
    this.adj = plan.rooms.map(() => []);
    for (const c of plan.connections) { this.adj[c.a].push({ to: c.b, lock: c.lock }); this.adj[c.b].push({ to: c.a, lock: c.lock }); }
  }

  /** Loudness reaching each room from a source (BFS with per-hop damping). */
  propagate(room: number, loudness: number, openLocks: ReadonlySet<string> = new Set()): Map<number, number> {
    const out = new Map<number, number>([[room, loudness]]);
    const q = [room];
    while (q.length) {
      const u = q.shift()!;
      const l = out.get(u)!;
      for (const e of this.adj[u]) {
        const next = l * this.hop * (e.lock && !openLocks.has(e.lock) ? 0.3 : 1);
        if (next > 0.04 && next > (out.get(e.to) ?? 0)) { out.set(e.to, next); q.push(e.to); }
      }
    }
    return out;
  }

  emit(room: number, x: number, z: number, loudness: number): void {
    if (loudness > 0.05) this.events.push({ room, x, z, loudness, age: 0, map: this.propagate(room, loudness) });
  }

  update(dt: number): void {
    for (const e of this.events) e.age += dt;
    this.events = this.events.filter((e) => e.age < 3);
  }

  /** Loudest recent noise that reaches `room`, with its source position. */
  heardAt(room: number, _openLocks: ReadonlySet<string> = new Set()): { loudness: number; x: number; z: number } | null {
    let best: { loudness: number; x: number; z: number } | null = null;
    for (const e of this.events) {
      const l = (e.map.get(room) ?? 0) * (1 - e.age / 3);
      if (l > (best?.loudness ?? 0.04)) best = { loudness: l, x: e.x, z: e.z };
    }
    return best;
  }
}
