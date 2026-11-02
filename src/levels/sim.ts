/**
 * LevelSim: the headless, render-free gameplay core for one level (player + collision + doors,
 * keys, pickups, waypoints, exit). The real game wraps it with visuals; the autopilot bot and
 * tests run it directly at accelerated simulated time.
 */
import { StaticWorld, type Collider } from '../core/collision';
import { Player } from '../core/player';
import { emptyFrame, type InputFrame } from '../core/input/logic';
import { STEP } from '../core/loop';
import { meshChunk, indexChunks, WALL_HALF } from '../gen/mesher';
import type { Connection, ItemSpawn, LevelPlan, Waypoint } from '../gen/types';
import { waypointsFor } from '../gen/waypoints';
import type { DifficultyId } from '../core/difficulty';

export type SimEvent =
  | { type: 'pickup'; item: ItemSpawn }
  | { type: 'unlock'; connection: Connection }
  | { type: 'locked'; lock: string }
  | { type: 'checkpoint'; index: number; waypoint: Waypoint }
  | { type: 'exit' };

export interface Interactable { kind: 'item' | 'door' | 'waypoint' | 'exit'; x: number; z: number; label: string; ref: unknown }

export const REACH = 1.9;

export class LevelSim {
  readonly world = new StaticWorld();
  readonly player = new Player();
  readonly doors = new Map<number, { conn: Connection; open: boolean }>();
  readonly collected = new Set<string>();
  readonly keys = new Set<string>();
  readonly waypoints: Waypoint[];
  activatedWaypoints = new Set<number>();
  respawn: { x: number; z: number; yaw: number };
  time = 0;
  finished = false;
  listeners: ((e: SimEvent) => void)[] = [];

  constructor(readonly plan: LevelPlan, difficulty: DifficultyId = 'normal') {
    this.waypoints = waypointsFor(plan, difficulty);
    // colliders for the whole level (cheap): mesh each chunk at the lowest quality and keep only the boxes
    for (const [, c] of indexChunks(plan)) this.world.add(`chunk:${c.cx},${c.cz}`, meshChunk(plan, c.cx, c.cz, { level: 0 }).colliders);
    for (const conn of plan.connections) if (conn.lock) {
      this.doors.set(conn.id, { conn, open: false });
      this.world.add(`door:${conn.id}`, [this.doorBox(conn)]);
    }
    this.respawn = { x: plan.spawn.pos.x, z: plan.spawn.pos.z, yaw: 0 };
    this.player.place(this.respawn.x, this.respawn.z, 0);
  }

  doorBox(c: Connection): Collider {
    const hw = c.width / 2;
    return c.axis === 'z'
      ? { x0: c.door.x - WALL_HALF, x1: c.door.x + WALL_HALF, z0: c.door.z - hw, z1: c.door.z + hw }
      : { x0: c.door.x - hw, x1: c.door.x + hw, z0: c.door.z - WALL_HALF, z1: c.door.z + WALL_HALF };
  }

  emit(e: SimEvent): void { for (const l of this.listeners) l(e); }

  /** Advance one fixed step. */
  step(f: InputFrame, dt = STEP): void {
    this.time += dt;
    this.player.update(dt, f, this.world);
    if (f.pressed.Interact) this.interact();
  }

  /** Everything the player could currently interact with, nearest first. */
  interactables(): Interactable[] {
    const p = this.player;
    const out: Interactable[] = [];
    for (const it of this.plan.items) {
      if (this.collected.has(it.id)) continue;
      out.push({ kind: 'item', x: it.pos.x, z: it.pos.z, label: it.kind === 'key' ? `Take ${it.item}` : `Take ${it.item.replace('_', ' ')}`, ref: it });
    }
    for (const d of this.doors.values()) if (!d.open) out.push({ kind: 'door', x: d.conn.door.x, z: d.conn.door.z, label: this.keys.has(d.conn.lock!) ? 'Unlock door' : 'Locked', ref: d });
    this.waypoints.forEach((w, i) => out.push({ kind: 'waypoint', x: w.pos.x, z: w.pos.z, label: this.activatedWaypoints.has(i) ? 'Checkpoint (set)' : 'Activate checkpoint', ref: i }));
    out.push({ kind: 'exit', x: this.plan.exit.pos.x, z: this.plan.exit.pos.z, label: 'Leave', ref: null });
    const near = out.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) <= REACH);
    near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return near;
  }

  interact(): Interactable | null {
    const t = this.interactables()[0];
    if (!t) return null;
    if (t.kind === 'item') {
      const it = t.ref as ItemSpawn;
      this.collected.add(it.id);
      if (it.kind === 'key' && it.unlocks) this.keys.add(it.unlocks);
      this.emit({ type: 'pickup', item: it });
    } else if (t.kind === 'door') {
      const d = t.ref as { conn: Connection; open: boolean };
      if (this.keys.has(d.conn.lock!)) { d.open = true; this.world.remove(`door:${d.conn.id}`); this.emit({ type: 'unlock', connection: d.conn }); }
      else this.emit({ type: 'locked', lock: d.conn.lock! });
    } else if (t.kind === 'waypoint') {
      const i = t.ref as number;
      this.activatedWaypoints.add(i);
      const w = this.waypoints[i];
      this.respawn = { x: w.pos.x, z: w.pos.z, yaw: this.player.yaw };
      this.emit({ type: 'checkpoint', index: i, waypoint: w });
    } else {
      this.finished = true;
      this.emit({ type: 'exit' });
    }
    return t;
  }

  /** Death/respawn at the last checkpoint. */
  respawnPlayer(): void { this.player.place(this.respawn.x, this.respawn.z, this.respawn.yaw); }
}

export { emptyFrame };
