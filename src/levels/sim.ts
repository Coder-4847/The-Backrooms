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
import { SimExtras } from './simExtras';
import type { Connection, HideSpot, ItemSpawn, LevelPlan, Waypoint } from '../gen/types';

export type SimEvent =
  | { type: 'custom'; ref: unknown }
  | { type: 'valve'; puzzle: string; solved: boolean }
  | { type: 'puzzle'; id: string }
  | { type: 'throw'; x: number; z: number; item: string }
  | { type: 'alarm'; x: number; z: number }
  | { type: 'radio'; x: number; z: number }
  | { type: 'violation'; rule: string }
  | { type: 'companion'; what: 'recruited' | 'hurt' | 'lost' }
  | { type: 'talk'; id: number }
  | { type: 'lights'; lock: string; rooms: number[] }
  | { type: 'seq'; puzzle: string; ok: boolean; progress: number }
  | { type: 'splash'; x: number; z: number }
  | { type: 'train'; on: boolean }
  | { type: 'gaze'; wrong: boolean }
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
const plan_cold = (s: { plan: LevelPlan }): boolean => !!s.plan.cold;

const lockHint = (lock: string): string => lock.startsWith('fuse') ? 'Dead transformer bay: needs a fuse' : lock.startsWith('pry') ? 'Stuck door: needs a crowbar' : lock.startsWith('valves') ? 'Sealed: the valves must be aligned' : lock.startsWith('rope') ? 'Chasm: needs a grappling hook' : lock.startsWith('seq') ? 'Rack lock: servers must be rebooted in order' : lock.startsWith('breaker') ? 'Dead section: flip its breaker' : 'Locked';

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
  x: SimExtras;
  diff: DifficultyDef;
  hidden: HideSpot | null = null;
  /** Rooms whose lamps are currently off (dark levels / unrestored garage sections). */
  unlit: Set<number>;
  private water = new Map<number, 'wade' | 'swim' | 'flooded'>();
  /** Depth of the room the player stands in, for footsteps and visuals. */
  waterHere: 'wade' | 'swim' | 'flooded' | null = null;
  outOfAir = false;
  trail: { t: number; x: number; z: number }[] = [];
  private trailT = 0;
  trainActive = false;
  alert = false;
  alertT = 0;
  inWarm = true;
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
    if (plan.open) { const b = plan.bounds; this.world.add('perimeter', [{ x0: b.x0 - 1, x1: b.x0, z0: b.z0 - 1, z1: b.z1 + 1 }, { x0: b.x1, x1: b.x1 + 1, z0: b.z0 - 1, z1: b.z1 + 1 }, { x0: b.x0 - 1, x1: b.x1 + 1, z0: b.z0 - 1, z1: b.z0 }, { x0: b.x0 - 1, x1: b.x1 + 1, z0: b.z1, z1: b.z1 + 1 }]); }
    this.respawn = { x: plan.spawn.pos.x, z: plan.spawn.pos.z, yaw: 0 };
    this.player.place(this.respawn.x, this.respawn.z, 0);
    const seed = opts.seed ?? plan.seed;
    this.rng = new Rng(seed ^ 0x51d3);
    this.inv = opts.inventory ?? Inventory.starter();
    this.stats = opts.stats ?? new Stats();
    this.hungerEnabled = opts.hungerEnabled ?? true;
    this.intensity = effectiveIntensity(opts.intensity ?? 0.5, opts.scare ?? 'standard');
    this.noise = new NoiseField(plan, plan.acoustics?.damping);
    this.director = new Director(this.diff, this.intensity, this.rng.fork('director'));
    // supply scarcity (difficulty): some loot is simply not there. Layout is untouched; deterministic per seed.
    const keep = Math.min(1, this.diff.supply);
    for (const it of plan.items) if (it.kind === 'loot' && new Rng(deriveSeed(seed, it.id)).next() >= keep) this.collected.add(it.id);
    this.ew = new EntityWorld(plan, this.world, seed);
    if (opts.spawnEntities !== false) this.ew.spawnFromPlan();
    this.unlit = new Set(plan.unlit ?? []);
    for (const w of plan.water ?? []) this.water.set(w.room, w.depth);
    this.x = new SimExtras(this);
    for (const pr of (plan.props ?? []).filter((q) => !q.soft)) this.world.add(`prop:${pr.x},${pr.z}`, [{ x0: pr.x - pr.w / 2, x1: pr.x + pr.w / 2, z0: pr.z - pr.d / 2, z1: pr.z + pr.d / 2 }]);
    this.percept = { x: 0, z: 0, yaw: 0, hidden: false, crouching: false, noise: 0, light: 0.6, flashOn: false, flashPower: 0, flares: [] };
    this.ctx = { player: this.percept, noise: this.noise, openLocks: this.keys, diff: this.diff, director: this.director, mode: opts.mode ?? 'active', pass: 'none' };
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
  get lightLevel(): number {
    const base = this.plan.dark ? 0.03 : this.unlit.has(this.room) ? 0.12 : 0.5;
    return Math.min(1, base + this.flash.output(this.time) * 0.3 + (this.glows.length || this.flares.length ? 0.25 : 0));
  }
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

    // water: speed, swimming, diving and breath
    this.waterHere = this.water.get(this.room) ?? null;
    const wd = this.waterHere;
    p.waterMul = wd === 'wade' ? 0.8 : wd === 'swim' ? 0.55 : wd === 'flooded' ? 0.5 : 1;
    const diving = wd === 'flooded' || (wd === 'swim' && f.down.Crouch);
    p.swim = wd === 'swim' || wd === 'flooded' ? (diving ? 'dive' : 'surface') : 'none';
    this.outOfAir = this.stats.updateBreath(dt, diving, this.diff, wd === 'flooded' ? 4 : 3.2);
    if (wd && p.speed > 0.4 && Math.floor(this.time * 3) !== Math.floor((this.time - dt) * 3)) this.emit({ type: 'splash', x: p.x, z: p.z });

    // cold, schedule, trail, alert
    if (plan_cold(this)) { const c = this.plan.cold!; this.inWarm = c.warm.includes(this.room) || this.safeRoom || this.flares.some((f) => Math.hypot(f.x - p.x, f.z - p.z) < 4); this.stats.updateWarmth(dt, !this.inWarm, c.rate, this.diff); }
    const sc = this.plan.schedule;
    if (sc) { const on = ((this.time + sc.offset) % sc.period) < sc.window; if (on !== this.trainActive) { this.trainActive = on; this.emit({ type: 'train', on }); if (on) this.noise.emit(this.room, p.x, p.z, 0.8); } }
    this.trailT -= dt; if (this.trailT <= 0) { this.trailT = 0.25; this.trail.push({ t: this.time, x: p.x, z: p.z }); if (this.trail.length > 200) this.trail.shift(); }
    if (this.alert) { this.alertT -= dt; if (this.alertT <= 0) this.alert = false; }

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
    const loud = this.hidden ? 0 : p.noise * (breath ? 0.15 : 1) * (wd === 'wade' || wd === 'swim' ? (diving ? 0.35 : 1.6) : 1);
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
    pc.flares = this.flares; pc.water = this.waterHere !== null;
    this.ctx.pass = this.x.passHeld; this.ctx.time = this.time; this.ctx.trail = this.trail; this.ctx.alert = this.alert; this.ctx.trainActive = this.trainActive;
    this.ctx.safeSpots = [...this.activatedWaypoints].map((i) => this.waypoints[i].pos);
    this.x.update(dt, f);
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
    for (const d of this.doors.values()) if (!d.open) out.push({ kind: 'door', x: d.conn.door.x, z: d.conn.door.z, label: this.keys.has(d.conn.lock!) ? 'Unlock door' : lockHint(d.conn.lock!), ref: d });
    this.waypoints.forEach((w, i) => out.push({ kind: 'waypoint', x: w.pos.x, z: w.pos.z, label: this.activatedWaypoints.has(i) ? 'Checkpoint (set)' : 'Activate checkpoint', ref: i }));
    for (const h of this.plan.hides ?? []) out.push({ kind: 'hide', x: h.pos.x, z: h.pos.z, label: h.kind === 'locker' ? 'Hide in locker' : 'Hide under desk', ref: h });
    if (!this.plan.hub && !this.plan.finale) out.push({ kind: 'exit', x: this.plan.exit.pos.x, z: this.plan.exit.pos.z, label: 'Leave', ref: null });
    if (this.extra) out.push(...this.extra());
    out.push(...this.x.interactables());
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
      this.openDoor(t.ref as { conn: Connection; open: boolean });
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
    } else if (t.kind === 'custom') { const r = t.ref as { type: string; id?: number }; if (!this.x.handle(r as never)) this.emit({ type: r.type === 'talk' ? 'talk' : 'custom', ref: t.ref, id: r.id } as never); }
    else { this.finished = true; this.emit({ type: 'exit' }); }
    return t;
  }

  /** Unlock a door if the key/puzzle is held (also used directly by the bot, so a nearby waypoint can never steal the interaction). */
  openDoor(d: { conn: Connection; open: boolean }): boolean {
    const p = this.player;
    if (this.keys.has(d.conn.lock!)) { d.open = true; this.world.remove(`door:${d.conn.id}`); this.noise.emit(this.room, p.x, p.z, NOISE.door); this.emit({ type: 'unlock', connection: d.conn }); return true; }
    this.emit({ type: 'locked', lock: d.conn.lock! });
    return false;
  }

  /** Use the held hotbar item: consumables apply their effect, lights get placed. */
  useHeld(): boolean {
    const id = this.inv.held;
    if (!id) return false;
    const special = this.x.useSpecial(id);
    if (special !== null) return special;
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
    this.x.companion = null;
    this.director = new Director(this.diff, this.intensity, this.rng.fork(`director${this.deaths}`));
    this.ctx.director = this.director; this.ctx.noise = this.noise;
  }
}

export { emptyFrame };
