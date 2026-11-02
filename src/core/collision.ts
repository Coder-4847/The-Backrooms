/**
 * Capsule-vs-world collision (spec 2): the player is a vertical capsule, so in the XZ plane it is a
 * circle. Static walls are 2D AABBs held in a spatial hash; movement is swept in small steps and
 * slides along walls. No physics engine.
 */
import type { Box2 } from '../gen/mesher';

const CELL = 4;
const cellKey = (ix: number, iz: number) => ix * 73856093 ^ iz * 19349663;

export interface Collider extends Box2 { id?: string; owner?: string }

export class StaticWorld {
  private cells = new Map<number, Collider[]>();
  private byOwner = new Map<string, Collider[]>();
  count = 0;

  add(owner: string, boxes: Collider[]): void {
    this.byOwner.set(owner, [...(this.byOwner.get(owner) ?? []), ...boxes]);
    for (const b of boxes) {
      for (let ix = Math.floor(b.x0 / CELL); ix <= Math.floor(b.x1 / CELL); ix++) {
        for (let iz = Math.floor(b.z0 / CELL); iz <= Math.floor(b.z1 / CELL); iz++) {
          const k = cellKey(ix, iz);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(b);
        }
      }
      this.count++;
    }
  }

  /** Remove everything added under `owner` (chunk unload, unlocked door). */
  remove(owner: string): void {
    const boxes = this.byOwner.get(owner);
    if (!boxes) return;
    for (const b of boxes) {
      for (let ix = Math.floor(b.x0 / CELL); ix <= Math.floor(b.x1 / CELL); ix++) {
        for (let iz = Math.floor(b.z0 / CELL); iz <= Math.floor(b.z1 / CELL); iz++) {
          const list = this.cells.get(cellKey(ix, iz));
          if (list) { const i = list.indexOf(b); if (i >= 0) list.splice(i, 1); }
        }
      }
      this.count--;
    }
    this.byOwner.delete(owner);
  }

  /** Push a circle out of any overlapping box. Mutates `p`; returns true if anything was hit. */
  private resolve(p: { x: number; z: number }, r: number): boolean {
    let hit = false;
    const i0 = Math.floor((p.x - r) / CELL), i1 = Math.floor((p.x + r) / CELL);
    const j0 = Math.floor((p.z - r) / CELL), j1 = Math.floor((p.z + r) / CELL);
    for (let ix = i0; ix <= i1; ix++) for (let iz = j0; iz <= j1; iz++) {
      const list = this.cells.get(cellKey(ix, iz));
      if (!list) continue;
      for (const b of list) {
        const cx = Math.max(b.x0, Math.min(p.x, b.x1)), cz = Math.max(b.z0, Math.min(p.z, b.z1));
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
        else {
          // centre inside the box: push out along the shallowest axis
          const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bt = b.z1 - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === t) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
    }
    return hit;
  }

  /** Move the circle by (dx,dz) in sub-steps, sliding along walls. */
  move(p: { x: number; z: number }, dx: number, dz: number, r: number): boolean {
    const dist = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(dist / (r * 0.6)));
    let hit = false;
    for (let i = 0; i < steps; i++) {
      p.x += dx / steps; p.z += dz / steps;
      for (let k = 0; k < 3; k++) { if (this.resolve(p, r)) hit = true; else break; }
    }
    return hit;
  }

  /** Is any wall between two points? (line-of-sight test; samples every 0.1 m so thin walls are never skipped) */
  segmentBlocked(x0: number, z0: number, x1: number, z1: number): boolean {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!list) continue;
      for (const b of list) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
  }

  /** Point-in-any-box test (used by validators/tests to prove spawns are not inside walls). */
  overlapsCircle(x: number, z: number, r: number): boolean {
    const p = { x, z };
    return this.resolve(p, r);
  }
}
