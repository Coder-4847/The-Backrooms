/**
 * LevelSim: the headless, render-free gameplay core for one level: player, collision, doors, keys,
 * pickups, hiding, items, stats/sanity, light, noise, Director, entities, waypoints and exit.
 * The real game wraps it with visuals; the autopilot bot and tests run it directly at accelerated
 * simulated time (entities can be set to "observe" so the bot is never killed).
 */
import { StaticWorld, type Collider } from '../core/collision';
import { Player } from '../core/player';
import { emptyFrame, type InputFrame } from '../core/input/logic';
import { STEP } from '../core/loop';
import { meshChunk, indexChunks, WALL_HALF } from '../gen/mesher';
import { waypointsFor } from '../gen/waypoints';
import { Rng, deriveSeed } from '../gen/rng';
import { DIFFICULTIES, effectiveIntensity, type DifficultyDef, type DifficultyId, type ScareIntensity } from '../core/difficulty';
import { Inventory } from '../systems/inventory';
import { itemDef } from '../systems/items';
import { Stats, type Hallucination } from '../systems/stats';
import { Flashlight, Camcorder } from '../systems/light';
import { NoiseField, NOISE } from '../systems/noise';
import { Director, type DirectorEvent } from '../systems/director';
import { EntityWorld, type AiContext, type Entity, type PlayerPercept } from '../entities/ai';
import type { Connection, HideSpot, ItemSpawn, LevelPlan, Waypoint } from '../gen/types';

export type SimEvent =
  | { type: 'custom'; ref: unknown }
  | { type: 'pickup'; item: ItemSpawn }
  | { type: 'full'; item: ItemSpawn }
  | { type: 'note'; id: string }
  | { type: 'unlock'; connection: Connection }
  | { type: 'locked'; lock: string }
  | { type: 'checkpoint'; index: number; waypoint: Waypoint }
  | { type: 'exit' }
  | { type: 'hide'; on: boolean }
  | { type: 'use'; item: string }
  | { type: 'hit'; entity: Entity; damage: number }
  | { type: 'tell'; entity: Entity }
  | { type: 'death' }
  | { type: 'hallucination'; kind: Hallucination }
  | { type: 'director'; event: DirectorEvent }
  | { type: 'flare'; x: number; z: number }
  | { type: 'glow'; x: number; z: number };

export interface Interactable { kind: 'item' | 'door' | 'waypoint' | 'exit' | 'hide' | 'custom'; x: number; z: number; label: string; ref: unknown }

export interface SimOptions {
  seed?: number; mode?: 'active' | 'observe'; scare?: ScareIntensity; intensity?: number;
  inventory?: Inventory; stats?: Stats; hungerEnabled?: boolean; spawnEntities?: boolean;
}

export interface SimSnapshot { collected: string[]; keys: string[]; openDoors: number[]; activated: number[]; time: number; notes: string[]; respawn: { x: number; z: number; yaw: number } }

export const REACH = 1.9;

export class LevelSim {
  readonly world = new StaticWorld();
  readonly player = new Player();
  readonly doors = new Map<number, { conn: Connection; open: boolean }>();
  readonly collected = new Set<string>();
  readonly keys = new Set<string>();
  readonly notes = new Set<string>();
  readonly waypoints: Waypoint[];
  activatedWaypoints = new Set<number>();
  respawn: { x: number; z: number; yaw: number };
  time = 0;
  finished = false;
  listeners: ((e: SimEvent) => void)[] = [];

  inv: Inventory; stats: Stats; flash = new Flashlight(); cam = new Camcorder();
  noise: NoiseField; director: Director; ew: EntityWorld;
  diff: DifficultyDef;
  hidden: HideSpot | null = null;
  flares: { x: number; z: number; t: number }[] = [];
  glows: { x: number; z: number; t: number }[] = [];
  dead = false;
  deaths = 0;
  /** Hub: always safe (sanity recovers) and extra interactables (doors, NPCs, stations). */
  alwaysSafe = false;
  extra: (() => Interactable[]) | null = null;
  room = 0;
  intensity: number;
  hungerEnabled: boolean;
  private rng: Rng;
  private noiseTimer = 0;
  private opts: SimOptions;
  private percept: PlayerPercept;
  private ctx: AiContext;

  constructor(readonly plan: LevelPlan, difficulty: DifficultyId = 'normal', opts: SimOptions = {}) {
    this.opts = opts;
    this.diff = DIFFICULTIES[difficulty];
    this.waypoints = waypointsFor(plan, difficulty);
    for (const [, c] of indexChunks(plan)) this.world.add(`chunk:${c.cx},${c.cz}`, meshChunk(plan, c.cx, c.cz, { level: 0 }).colliders);
    for (const conn of plan.connections) if (conn.lock) {
      this.doors.set(conn.id, { conn, open: false });
      this.world.add(`door:${conn.id}`, [this.doorBox(conn)]);
    }
    for (const h of plan.hides ?? []) this.world.add(`hide:${h.id}`, [{ x0: h.pos.x - 0.3, x1: h.pos.x + 0.3, z0: h.pos.z - 0.3, z1: h.pos.z + 0.3 }]);
    this.respawn = { x: plan.spawn.pos.x, z: plan.spawn.pos.z, yaw: 0 };
    this.player.place(this.respawn.x, this.respawn.z, 0);
    const seed = opts.seed ?? plan.seed;
    this.rng = new Rng(seed ^ 0x51d3);
    this.inv = opts.inventory ?? Inventory.starter();
    this.stats = opts.stats ?? new Stats();
    this.hungerEnabled = opts.hungerEnabled ?? true;
    this.intensity = effectiveIntensity(opts.intensity ?? 0.5, opts.scare ?? 'standard');
    this.noise = new NoiseField(plan);
    this.director = new Director(this.diff, this.intensity, this.rng.fork('director'));
    // supply scarcity (difficulty): some loot is simply not there. Layout is untouched; deterministic per seed.
    const keep = Math.min(1, this.diff.supply);
    for (const it of plan.items) if (it.kind === 'loot' && new Rng(deriveSeed(seed, it.id)).next() >= keep) this.collected.add(it.id);
    this.ew = new EntityWorld(plan, this.world, seed);
    if (opts.spawnEntities !== false) this.ew.spawnFromPlan();
    this.percept = { x: 0, z: 0, yaw: 0, hidden: false, crouching: false, noise: 0, light: 0.6, flashOn: false, flashPower: 0, flares: [] };
    this.ctx = { player: this.percept, noise: this.noise, openLocks: this.keys, diff: this.diff, director: this.director, mode: opts.mode ?? 'active' };
    this.ew.listeners.push((e) => {
      if (e.type === 'hit') { if (!this.player.god) this.stats.damage(e.damage, this.diff); this.emit({ type: 'hit', entity: e.entity, damage: e.damage }); }
      else if (e.type === 'tell') this.emit({ type: 'tell', entity: e.entity });
      else if (e.type === 'huntStart') this.director.huntStarted();
      else if (e.type === 'huntEnd') this.director.huntEnded();
    });
  }

  doorBox(c: Connection): Collider {
    const hw = c.width / 2;
    return c.axis === 'z'
      ? { x0: c.door.x - WALL_HALF, x1: c.door.x + WALL_HALF, z0: c.door.z - hw, z1: c.door.z + hw }
      : { x0: c.door.x - hw, x1: c.door.x + hw, z0: c.door.z - WALL_HALF, z1: c.door.z + WALL_HALF };
  }

  emit(e: SimEvent): void { for (const l of this.listeners) l(e); }

  /** Light the player stands in 0..1: ceiling lights keep rooms lit; the flashlight adds to it. */
  get lightLevel(): number { return Math.min(1, 0.5 + this.flash.output(this.time) * 0.3); }
  get safeRoom(): boolean {
    if (this.alwaysSafe) return true;
    const r = this.plan.rooms[this.room];
    if (r?.kind === 'supply') return true;
    const p = this.player;
    return [...this.activatedWaypoints].some((i) => Math.hypot(this.waypoints[i].pos.x - p.x, this.waypoints[i].pos.z - p.z) < 3.5);
  }

  /** Advance one fixed step. */
  step(f: InputFrame, dt = STEP): void {
    if (this.dead) return;
    this.time += dt;
    const p = this.player;
    // hiding freezes movement but not looking
    let frame = f;
    if (this.hidden) { frame = { ...f, moveX: 0, moveY: 0, down: { ...f.down, Sprint: false, Crouch: false } }; }
    p.regenScale = this.inv.weightFactor;
    p.update(dt, frame, this.world);
    this.room = this.ew.nav.roomAt(p.x, p.z) < 0 ? this.room : this.ew.nav.roomAt(p.x, p.z);

    // hotbar + item use + lights
    for (let i = 0; i < 4; i++) if (f.pressed[`Slot${i + 1}` as 'Slot1']) this.inv.selected = i;
    if (f.pressed.NextItem) this.inv.selected = (this.inv.selected + 1) % 4;
    if (f.pressed.UseItem) this.useHeld();
    if (f.pressed.Flashlight && this.inv.has('flashlight')) this.flash.on = !this.flash.on;
    if (f.pressed.Camcorder && this.inv.has('camcorder')) this.cam.toggle();
    this.flash.addShake(Math.hypot(f.lookX, f.lookY) * 60);
    this.flash.update(dt, this.diff);
    this.cam.update(dt, this.diff);
    const breath = f.down.HoldBreath && p.stamina > 8;
    if (breath) p.stamina = Math.max(0, p.stamina - 8 * dt);

    // noise: the player's movement noise is emitted a few times a second
    this.noiseTimer -= dt;
    const loud = this.hidden ? 0 : p.noise * (breath ? 0.15 : 1);
    if (this.noiseTimer <= 0) { this.noiseTimer = 0.25; if (loud > 0.05) this.noise.emit(this.room, p.x, p.z, loud); }
    this.noise.update(dt);

    // flares / glowsticks burn down
    for (const l of this.flares) l.t -= dt;
    for (const l of this.glows) l.t -= dt;
    this.flares = this.flares.filter((l) => l.t > 0); this.glows = this.glows.filter((l) => l.t > 0);

    // entities
    const pc = this.percept;
    pc.x = p.x; pc.z = p.z; pc.yaw = p.yaw; pc.hidden = !!this.hidden; pc.crouching = p.crouching; pc.noise = loud;
    pc.light = this.lightLevel; pc.flashOn = this.flash.on && this.inv.has('flashlight'); pc.flashPower = this.flash.output(this.time);
    pc.flares = this.flares;
    this.ew.update(dt, this.ctx);

    // stats, director, hallucinations
    const threat = this.ew.threatLevel(p.x, p.z);
    this.stats.update(dt, { light: pc.light, threat, safeRoom: this.safeRoom, resting: this.safeRoom && p.speed < 0.2, hungerEnabled: this.hungerEnabled && this.diff.hungerRate > 0 }, this.diff);
    const ev = this.director.update(dt, threat);
    if (ev) this.emit({ type: 'director', event: ev });
    const h = this.stats.hallucinate(dt, this.rng, false);
    if (h) this.emit({ type: 'hallucination', kind: h });
    if (this.stats.dead && !p.god) { this.dead = true; this.deaths++; this.emit({ type: 'death' }); return; }
    if (p.god) { this.stats.dead = false; this.stats.health = Math.max(this.stats.health, 50); }

    if (f.pressed.Interact) this.interact();
  }

  /** Everything the player could currently interact with, nearest first. */
  interactables(): Interactable[] {
    const p = this.player;
    const out: Interactable[] = [];
    if (this.hidden) return [{ kind: 'hide', x: p.x, z: p.z, label: 'Leave hiding spot', ref: this.hidden }];
    for (const it of this.plan.items) {
      if (this.collected.has(it.id)) continue;
      out.push({ kind: 'item', x: it.pos.x, z: it.pos.z, label: it.kind === 'note' ? 'Read note' : `Take ${itemDef(it.item).name}`, ref: it });
    }
    for (const d of this.doors.values()) if (!d.open) out.push({ kind: 'door', x: d.conn.door.x, z: d.conn.door.z, label: this.keys.has(d.conn.lock!) ? 'Unlock door' : 'Locked', ref: d });
    this.waypoints.forEach((w, i) => out.push({ kind: 'waypoint', x: w.pos.x, z: w.pos.z, label: this.activatedWaypoints.has(i) ? 'Checkpoint (set)' : 'Activate checkpoint', ref: i }));
    for (const h of this.plan.hides ?? []) out.push({ kind: 'hide', x: h.pos.x, z: h.pos.z, label: h.kind === 'locker' ? 'Hide in locker' : 'Hide under desk', ref: h });
    if (!this.plan.hub) out.push({ kind: 'exit', x: this.plan.exit.pos.x, z: this.plan.exit.pos.z, label: 'Leave', ref: null });
    if (this.extra) out.push(...this.extra());
    const near = out.filter((o) => Math.hypot(o.x - p.x, o.z - p.z) <= REACH);
    near.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    return near;
  }

  interact(): Interactable | null {
    const t = this.interactables()[0];
    if (!t) return null;
    const p = this.player;
    if (t.kind === 'item') {
      const it = t.ref as ItemSpawn;
      if (it.kind === 'note') { this.collected.add(it.id); this.notes.add(it.item); this.emit({ type: 'note', id: it.item }); }
      else if (this.inv.add(it.item) > 0) { this.emit({ type: 'full', item: it }); return t; }
      else { this.collected.add(it.id); if (it.kind === 'key' && it.unlocks) this.keys.add(it.unlocks); this.noise.emit(this.room, p.x, p.z, NOISE.pickup); this.emit({ type: 'pickup', item: it }); }
    } else if (t.kind === 'door') {
      const d = t.ref as { conn: Connection; open: boolean };
      if (this.keys.has(d.conn.lock!)) { d.open = true; this.world.remove(`door:${d.conn.id}`); this.noise.emit(this.room, p.x, p.z, NOISE.door); this.emit({ type: 'unlock', connection: d.conn }); }
      else this.emit({ type: 'locked', lock: d.conn.lock! });
    } else if (t.kind === 'waypoint') {
      const i = t.ref as number;
      this.activatedWaypoints.add(i);
      const w = this.waypoints[i];
      this.respawn = { x: w.pos.x, z: w.pos.z, yaw: p.yaw };
      this.emit({ type: 'checkpoint', index: i, waypoint: w });
    } else if (t.kind === 'hide') {
      if (this.hidden) {
        const h = this.hidden; this.hidden = null;
        p.place(h.pos.x - Math.sin(h.yaw) * 0.95, h.pos.z - Math.cos(h.yaw) * 0.95, p.yaw);
        this.emit({ type: 'hide', on: false });
      } else { this.hidden = t.ref as HideSpot; this.emit({ type: 'hide', on: true }); }
    } else if (t.kind === 'custom') { this.emit({ type: 'custom', ref: t.ref }); }
    else { this.finished = true; this.emit({ type: 'exit' }); }
    return t;
  }

  /** Use the held hotbar item: consumables apply their effect, lights get placed. */
  useHeld(): boolean {
    const id = this.inv.held;
    if (!id) return false;
    const d = itemDef(id), u = d.use;
    if (!u) return false;
    const p = this.player;
    if (u.battery) { if (this.flash.battery > 95) return false; this.flash.recharge(u.battery); }
    if (u.glow) {
      if (id === 'flare') { this.flares.push({ x: p.x, z: p.z, t: u.glow }); this.noise.emit(this.room, p.x, p.z, 0.3); this.emit({ type: 'flare', x: p.x, z: p.z }); }
      else { this.glows.push({ x: p.x, z: p.z, t: u.glow }); this.emit({ type: 'glow', x: p.x, z: p.z }); }
    }
    this.stats.apply(u);
    this.inv.remove(id, 1);
    this.noise.emit(this.room, p.x, p.z, NOISE.item);
    this.emit({ type: 'use', item: id });
    return true;
  }

  snapshot(): SimSnapshot {
    return { collected: [...this.collected], keys: [...this.keys], openDoors: [...this.doors.values()].filter((d) => d.open).map((d) => d.conn.id), activated: [...this.activatedWaypoints], time: this.time, notes: [...this.notes], respawn: { ...this.respawn } };
  }

  applySnapshot(s: SimSnapshot): void {
    s.collected.forEach((c) => this.collected.add(c)); s.keys.forEach((k) => this.keys.add(k)); s.notes.forEach((n) => this.notes.add(n));
    for (const id of s.openDoors) { const d = this.doors.get(id); if (d) { d.open = true; this.world.remove(`door:${id}`); } }
    this.activatedWaypoints = new Set(s.activated); this.time = s.time; this.respawn = { ...s.respawn };
    this.player.place(this.respawn.x, this.respawn.z, this.respawn.yaw);
  }

  /** Death/respawn at the last checkpoint: player moves back, entities re-roll, stats partially recover. */
  respawnPlayer(): void {
    this.hidden = null; this.dead = false;
    this.stats.revive();
    this.player.place(this.respawn.x, this.respawn.z, this.respawn.yaw);
    this.ew = new EntityWorld(this.plan, this.world, (this.opts.seed ?? this.plan.seed) + this.deaths * 7919);
    if (this.opts.spawnEntities !== false) this.ew.spawnFromPlan();
    this.ew.listeners.push((e) => {
      if (e.type === 'hit') { if (!this.player.god) this.stats.damage(e.damage, this.diff); this.emit({ type: 'hit', entity: e.entity, damage: e.damage }); }
      else if (e.type === 'tell') this.emit({ type: 'tell', entity: e.entity });
      else if (e.type === 'huntStart') this.director.huntStarted();
      else if (e.type === 'huntEnd') this.director.huntEnded();
    });
    this.director = new Director(this.diff, this.intensity, this.rng.fork(`director${this.deaths}`));
    this.ctx.director = this.director; this.ctx.noise = this.noise;
  }
}

export { emptyFrame };
