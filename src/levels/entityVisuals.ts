/** Keeps a THREE body in sync with every simulated entity (and short-lived hallucination ghosts). */
import type { Scene } from 'three';
import { buildBody, buildStick, type Body } from '../entities/body';
import type { EntityWorld } from '../entities/ai';

export class EntityVisuals {
  private bodies = new Map<number, Body>();
  private ghosts: { body: Body; x: number; z: number; yaw: number; ttl: number }[] = [];
  constructor(private scene: Scene, private level: number) {}

  sync(ew: EntityWorld, t: number, dt: number): void {
    const live = new Set<number>();
    for (const e of ew.entities) {
      live.add(e.id);
      let b = this.bodies.get(e.id);
      if (!b) { b = buildBody(e.def.id, this.level); this.bodies.set(e.id, b); this.scene.add(b.group); }
      b.group.position.set(e.x, 0, e.z);
      b.group.rotation.y = e.yaw;
      b.update(e.speed, t, dt, e.state === 'tell', e.seenByPlayer);
    }
    for (const [id, b] of this.bodies) if (!live.has(id)) { b.group.removeFromParent(); b.dispose(); this.bodies.delete(id); }
    for (const g of this.ghosts) { g.ttl -= dt; g.body.update(0, t, dt, false, true); }
    this.ghosts = this.ghosts.filter((g) => { if (g.ttl > 0) return true; g.body.group.removeFromParent(); g.body.dispose(); return false; });
  }

  /** A hallucinated Stick: vanishes when approached or lit (see LevelScene). */
  addGhost(x: number, z: number, yaw: number, ttl = 8): void {
    const body = buildStick(this.level, true);
    body.group.position.set(x, 0, z); body.group.rotation.y = yaw;
    this.scene.add(body.group);
    this.ghosts.push({ body, x, z, yaw, ttl });
  }
  get ghostList() { return this.ghosts; }
  killGhost(g: { ttl: number }): void { g.ttl = 0; }

  dispose(): void {
    for (const b of this.bodies.values()) { b.group.removeFromParent(); b.dispose(); }
    for (const g of this.ghosts) { g.body.group.removeFromParent(); g.body.dispose(); }
    this.bodies.clear(); this.ghosts = [];
  }
}
