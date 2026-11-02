/** A* over the level nav graph for entity pathing. Closed locked doors block; open ones do not. */
import type { LevelPlan, Vec2 } from '../gen/types';

export class NavGraph {
  private adj: { to: number; cost: number; lock: string | null }[][];
  constructor(private plan: LevelPlan) {
    const N = plan.nav.nodes;
    this.adj = N.map(() => []);
    for (const e of plan.nav.edges) {
      const lock = e.connection !== undefined ? plan.connections[e.connection].lock : null;
      this.adj[e.a].push({ to: e.b, cost: e.cost, lock }); this.adj[e.b].push({ to: e.a, cost: e.cost, lock });
    }
  }

  roomAt(x: number, z: number): number {
    for (const r of this.plan.rooms) if (x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d) return r.id;
    return -1;
  }

  /** Nearest nav node inside the same room as (x,z). */
  private nearest(x: number, z: number): number {
    const room = this.roomAt(x, z);
    let best = -1, bd = Infinity;
    for (const n of this.plan.nav.nodes) {
      if (room >= 0 && n.room !== room) continue;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z);
      if (d < bd) { bd = d; best = n.id; }
    }
    return best;
  }

  /** Waypoints from `from` to `to` (excluding the start), ending exactly at `to`. null if unreachable. */
  path(from: Vec2, to: Vec2, openLocks: ReadonlySet<string>): Vec2[] | null {
    const N = this.plan.nav.nodes;
    const s = this.nearest(from.x, from.z), g = this.nearest(to.x, to.z);
    if (s < 0 || g < 0) return null;
    const dist = new Array(N.length).fill(Infinity), prev = new Array(N.length).fill(-1);
    dist[s] = 0;
    const open = new Set<number>([s]);
    const h = (n: number) => Math.hypot(N[n].pos.x - N[g].pos.x, N[n].pos.z - N[g].pos.z);
    while (open.size) {
      let u = -1, bf = Infinity;
      for (const n of open) { const f = dist[n] + h(n); if (f < bf) { bf = f; u = n; } }
      open.delete(u);
      if (u === g) break;
      for (const e of this.adj[u]) {
        if (e.lock && !openLocks.has(e.lock)) continue;
        if (dist[u] + e.cost < dist[e.to]) { dist[e.to] = dist[u] + e.cost; prev[e.to] = u; open.add(e.to); }
      }
    }
    if (!isFinite(dist[g])) return null;
    const out: Vec2[] = [];
    for (let n = g; n !== -1 && n !== s; n = prev[n]) out.unshift(N[n].pos);
    out.push(to);
    return out;
  }
}
