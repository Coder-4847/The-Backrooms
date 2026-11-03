/** Keeps a THREE body in sync with every simulated entity (and short-lived hallucination ghosts). */
import { CircleGeometry, Mesh, MeshBasicMaterial, type Scene } from 'three';
import { buildBody, buildStick, type Body } from '../entities/body';
import type { EntityWorld } from '../entities/ai';

export class EntityVisuals {
  private bodies = new Map<number, Body>();
  private shadows = new Map<number, { mesh: Mesh; x: number; z: number }>();
  private shadowG = new CircleGeometry(0.38, 14);
  private shadowM = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
  private ghosts: { body: Body; x: number; z: number; yaw: number; ttl: number; sticky: boolean }[] = [];
  /** Jump scare: draw this entity at (x, z) facing `yaw` instead of where the sim has it. */
  lunge: { id: number; x: number; z: number; y: number; yaw: number; shake: number } | null = null;
  constructor(private scene: Scene, private level: number) {}

  sync(ew: EntityWorld, t: number, dt: number): void {
    const live = new Set<number>();
    for (const e of ew.entities) {
      live.add(e.id);
      let b = this.bodies.get(e.id);
      if (!b) { b = buildBody(e.def.id, this.level); this.bodies.set(e.id, b); this.scene.add(b.group); }
      const L = this.lunge && this.lunge.id === e.id ? this.lunge : null;
      if (L) {
        b.group.position.set(L.x + (Math.random() - 0.5) * L.shake, L.y, L.z + (Math.random() - 0.5) * L.shake);
        b.group.rotation.y = L.yaw + (Math.random() - 0.5) * L.shake * 3;
        b.group.visible = true;
        b.update(2.5, t, dt, true, true); // arms up, head down: the tell pose, thrashing
        continue;
      }
      b.group.position.set(e.x, 0, e.z);
      b.group.rotation.y = e.yaw;
      b.group.visible = !(e.data.hidden || e.data.cloaked);
      b.update(e.speed, t, dt, e.state === 'tell', e.seenByPlayer);
      if (e.def.behavior === 'coworker' || e.def.behavior === 'skinstealer' || e.def.behavior === 'monitor') {
        let sh = this.shadows.get(e.id);
        if (!sh) { const mesh = new Mesh(this.shadowG, this.shadowM); mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.012; this.scene.add(mesh); sh = { mesh, x: e.x, z: e.z }; this.shadows.set(e.id, sh); }
        // the tell: a real person's shadow keeps up; the Skin-stealer's lags by about half a second
        const k = e.def.behavior === 'skinstealer' && e.data.disguised !== false ? Math.min(1, dt * 2.2) : 1;
        sh.x += (e.x - sh.x) * k; sh.z += (e.z - sh.z) * k; sh.mesh.position.x = sh.x; sh.mesh.position.z = sh.z;
      }
    }
    for (const [id, b] of this.bodies) if (!live.has(id)) { b.group.removeFromParent(); b.dispose(); this.bodies.delete(id); this.shadows.get(id)?.mesh.removeFromParent(); this.shadows.delete(id); }
    for (const g of this.ghosts) { g.ttl -= dt; g.body.update(0, t, dt, false, true); }
    this.ghosts = this.ghosts.filter((g) => { if (g.ttl > 0) return true; g.body.group.removeFromParent(); g.body.dispose(); return false; });
  }

  /** A hallucinated Stick: vanishes when approached or lit (see LevelScene). */
  addGhost(x: number, z: number, yaw: number, ttl = 8, sticky = false): void {
    const body = buildStick(this.level, true);
    body.group.position.set(x, 0, z); body.group.rotation.y = yaw;
    this.scene.add(body.group);
    this.ghosts.push({ body, x, z, yaw, ttl, sticky });
  }
  get ghostList() { return this.ghosts; }
  killGhost(g: { ttl: number }): void { g.ttl = 0; }

  dispose(): void {
    for (const b of this.bodies.values()) { b.group.removeFromParent(); b.dispose(); }
    for (const g of this.ghosts) { g.body.group.removeFromParent(); g.body.dispose(); }
    this.bodies.clear(); this.ghosts = [];
    for (const sh of this.shadows.values()) sh.mesh.removeFromParent();
    this.shadows.clear(); this.shadowG.dispose(); this.shadowM.dispose();
  }
}
