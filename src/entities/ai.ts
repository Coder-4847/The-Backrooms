/**
 * Entity AI framework (spec 7.1-7.2). Shared perception (sight cone limited by light/crouch/cover,
 * hearing via the noise field), A* navigation on the level nav graph, and per-entity behavior
 * modules (stick, hound). Every attack is preceded by a `tell` state (audio/visual cue) whose length
 * comes from the difficulty table, so nothing is unavoidable. Fully deterministic given the seed.
 */
import { Rng } from '../gen/rng';
import { NavGraph } from './nav';
import { ENTITIES, type EntityDef } from './defs';
import type { StaticWorld } from '../core/collision';
import type { DifficultyDef } from '../core/difficulty';
import type { NoiseField } from '../systems/noise';
import type { Director } from '../systems/director';
import type { LevelPlan, Vec2 } from '../gen/types';

export type AiState = 'lurk' | 'patrol' | 'investigate' | 'hunt' | 'tell' | 'chase' | 'search' | 'flee' | 'stunned';

export interface Entity {
  id: number; def: EntityDef;
  x: number; z: number; yaw: number;
  state: AiState; stateTime: number;
  home: Vec2;
  pack: number;
  path: Vec2[]; pathTarget: Vec2 | null; repath: number;
  target: Vec2 | null;
  seesPlayer: boolean; seenByPlayer: boolean;
  tellLeft: number; cooldown: number; lostTime: number;
  speed: number; // current commanded speed (for animation)
  /** one-shot flag set when a tell starts, consumed by the audio layer */
  tellStarted: boolean;
}

export interface PlayerPercept {
  x: number; z: number; yaw: number;
  hidden: boolean; crouching: boolean; noise: number; light: number;
  flashOn: boolean; flashPower: number;
  flares: Vec2[];
}

export interface AiContext {
  player: PlayerPercept; noise: NoiseField; openLocks: ReadonlySet<string>;
  diff: DifficultyDef; director: Director; mode: 'active' | 'observe';
}

export type EntityEvent =
  | { type: 'tell'; entity: Entity }
  | { type: 'hit'; entity: Entity; damage: number }
  | { type: 'huntStart'; entity: Entity }
  | { type: 'huntEnd' };

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class EntityWorld {
  entities: Entity[] = [];
  listeners: ((e: EntityEvent) => void)[] = [];
  readonly nav: NavGraph;
  private rng: Rng;
  private hunters = 0;
  private nextId = 1;

  constructor(private plan: LevelPlan, private world: StaticWorld, seed: number) {
    this.nav = new NavGraph(plan);
    this.rng = new Rng(seed ^ 0xe17171);
  }

  private emit(e: EntityEvent): void { for (const l of this.listeners) l(e); }

  spawn(defId: string, x: number, z: number, pack = 0): Entity {
    const def = ENTITIES[defId];
    const e: Entity = {
      id: this.nextId++, def, x, z, yaw: this.rng.range(0, Math.PI * 2), state: def.behavior === 'hound' ? 'lurk' : 'patrol', stateTime: 0,
      home: { x, z }, pack, path: [], pathTarget: null, repath: 0, target: null, seesPlayer: false, seenByPlayer: false,
      tellLeft: 0, cooldown: 0, lostTime: 0, speed: 0, tellStarted: false,
    };
    this.entities.push(e);
    return e;
  }

  /** Create entities from the plan's entity slots (ecology). */
  spawnFromPlan(): void {
    let pack = 1;
    for (const s of this.plan.entitySlots) {
      if (!s.entity || !ENTITIES[s.entity]) continue;
      const def = ENTITIES[s.entity];
      const n = this.rng.int(def.packSize[0], def.packSize[1]);
      for (let i = 0; i < n; i++) this.spawn(s.entity, s.pos.x + (i - (n - 1) / 2) * 0.9, s.pos.z + (i % 2) * 0.6, pack);
      pack++;
    }
  }

  // ---- perception ----

  private sees(e: Entity, c: AiContext): boolean {
    const p = c.player;
    if (p.hidden) return false;
    const d = dist(e.x, e.z, p.x, p.z);
    let range = e.def.sightRange * c.diff.entityPerception * (0.55 + 0.45 * p.light) * (p.crouching ? 0.8 : 1);
    if (p.flashOn) range *= 1.15;
    if (d > range) return false;
    const ang = Math.atan2(-(p.x - e.x), -(p.z - e.z));
    let da = Math.abs(ang - e.yaw) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da;
    if (da > e.def.sightFov / 2 && d > 2.2) return false;
    return !this.world.segmentBlocked(e.x, e.z, p.x, p.z);
  }

  /** Does the player have the entity in view (cone around where they look, clear line of sight)? */
  private seenBy(e: Entity, p: PlayerPercept): boolean {
    const d = dist(e.x, e.z, p.x, p.z);
    if (d > 26) return false;
    const toX = e.x - p.x, toZ = e.z - p.z;
    const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
    if ((toX * lx + toZ * lz) / Math.max(d, 1e-6) < 0.55) return false;
    return !this.world.segmentBlocked(p.x, p.z, e.x, e.z);
  }

  // ---- movement ----

  private steer(e: Entity, tx: number, tz: number, speed: number, dt: number): void {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) { e.speed = 0; return; }
    const step = Math.min(d, speed * dt);
    const want = Math.atan2(-dx, -dz);
    let diff = want - e.yaw; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    e.yaw += diff * Math.min(1, 10 * dt);
    const p = { x: e.x, z: e.z };
    this.world.move(p, (dx / d) * step, (dz / d) * step, e.def.radius);
    e.x = p.x; e.z = p.z; e.speed = speed;
  }

  /** Walk toward a point using the nav graph (direct when the way is clear and close). Returns true on arrival. */
  private goTo(e: Entity, t: Vec2, speed: number, dt: number, c: AiContext): boolean {
    const d = dist(e.x, e.z, t.x, t.z);
    if (d < 0.5) { e.speed = 0; return true; }
    if (d < 7 && !this.world.segmentBlocked(e.x, e.z, t.x, t.z)) { this.steer(e, t.x, t.z, speed, dt); return false; }
    e.repath -= dt;
    if (!e.pathTarget || dist(e.pathTarget.x, e.pathTarget.z, t.x, t.z) > 1.5 || e.repath <= 0 || !e.path.length) {
      const p = this.nav.path({ x: e.x, z: e.z }, t, c.openLocks);
      e.path = p ?? []; e.pathTarget = { ...t }; e.repath = 1.5;
    }
    while (e.path.length > 1 && dist(e.x, e.z, e.path[0].x, e.path[0].z) < 0.45) e.path.shift();
    const n = e.path[0];
    if (!n) { e.speed = 0; return true; }
    this.steer(e, n.x, n.z, speed, dt);
    return false;
  }

  private randomPatrolPoint(e: Entity): Vec2 {
    const rooms = this.plan.rooms;
    const near = rooms.filter((r) => Math.hypot(r.x + r.w / 2 - e.home.x, r.z + r.d / 2 - e.home.z) < 40 && r.kind !== 'start');
    const r = this.rng.pick(near.length ? near : rooms);
    return { x: r.x + r.w / 2 + this.rng.range(-1.5, 1.5), z: r.z + r.d / 2 + this.rng.range(-1.5, 1.5) };
  }

  private setState(e: Entity, s: AiState): void { if (e.state !== s) { e.state = s; e.stateTime = 0; e.path = []; e.pathTarget = null; } }

  private startHunt(e: Entity): void { if (this.hunters++ === 0) this.emit({ type: 'huntStart', entity: e }); }
  private endHunt(): void { if (this.hunters > 0 && --this.hunters === 0) this.emit({ type: 'huntEnd' }); }
  private isHunting(s: AiState): boolean { return s === 'hunt' || s === 'tell' || s === 'chase'; }
  private change(e: Entity, s: AiState): void {
    const was = this.isHunting(e.state), will = this.isHunting(s);
    this.setState(e, s);
    if (!was && will) this.startHunt(e); else if (was && !will) this.endHunt();
  }

  // ---- main update ----

  update(dt: number, c: AiContext): void {
    for (const e of this.entities) {
      e.stateTime += dt;
      e.cooldown = Math.max(0, e.cooldown - dt);
      e.tellStarted = false;
      e.seesPlayer = this.sees(e, c);
      e.seenByPlayer = this.seenBy(e, c.player);
      if (e.def.behavior === 'stick') this.stick(e, c, dt); else this.hound(e, c, dt);
    }
  }

  private hit(e: Entity, c: AiContext): void {
    if (c.mode === 'observe') return;
    e.cooldown = e.def.cooldown;
    this.emit({ type: 'hit', entity: e, damage: e.def.damage });
  }

  private beginTell(e: Entity, c: AiContext): void {
    this.change(e, 'tell');
    e.tellLeft = e.def.tell * c.diff.tellTime;
    e.tellStarted = true;
    this.emit({ type: 'tell', entity: e });
  }

  // ---- Stick: advances only when unseen, backs off in strong light ----
  private stick(e: Entity, c: AiContext, dt: number): void {
    const p = c.player;
    const d = dist(e.x, e.z, p.x, p.z);
    const spd = c.diff.entitySpeed;
    // strong light on it makes it back off
    if (p.flashOn && p.flashPower > 0.5 && e.seenByPlayer && d < 9 && e.state !== 'flee') {
      const toX = e.x - p.x, toZ = e.z - p.z;
      const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
      if ((toX * lx + toZ * lz) / Math.max(d, 1e-6) > 0.9) { if (this.isHunting(e.state)) this.endHunt(); this.setState(e, 'flee'); }
    }
    switch (e.state) {
      case 'patrol': {
        if (!e.target || this.goTo(e, e.target, e.def.walk * 0.8 * spd, dt, c) || e.stateTime > 25) { e.target = this.randomPatrolPoint(e); e.stateTime = 0; }
        const aware = d < 26 && !p.hidden && (c.director.allowHunt || d < 9) && (e.seesPlayer || d < 12);
        if (aware) this.change(e, 'hunt');
        break;
      }
      case 'hunt': {
        if (p.hidden) { e.lostTime += dt; } else e.lostTime = 0;
        if (e.lostTime > 3) { this.change(e, 'patrol'); e.lostTime = 0; break; }
        if (d > 40) { this.change(e, 'patrol'); break; }
        if (e.seenByPlayer) { e.speed = 0; break; } // frozen while watched
        this.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
        if (d < 1.6 && e.cooldown <= 0 && !p.hidden) this.beginTell(e, c);
        break;
      }
      case 'tell': {
        e.speed = 0;
        if (e.seenByPlayer || d > 2.4) { e.tellLeft = Math.min(e.def.tell * c.diff.tellTime, e.tellLeft + dt * 2); if (d > 2.4 || e.seenByPlayer) { this.change(e, 'hunt'); break; } }
        e.tellLeft -= dt;
        e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
        if (e.tellLeft <= 0) { this.hit(e, c); this.change(e, 'flee'); }
        break;
      }
      case 'flee': {
        const away = { x: e.x + (e.x - p.x), z: e.z + (e.z - p.z) };
        const t = e.stateTime < 2 ? away : e.home;
        this.goTo(e, t, e.def.run * 1.1 * spd, dt, c);
        if (e.stateTime > 6) this.change(e, 'patrol');
        break;
      }
      default: this.setState(e, 'patrol');
    }
  }

  // ---- Hound: pack hunter, flanks, loses interest if you stay quiet, scatters at flares ----
  private hound(e: Entity, c: AiContext, dt: number): void {
    const p = c.player;
    const d = dist(e.x, e.z, p.x, p.z);
    const spd = c.diff.entitySpeed;
    const flare = p.flares.find((f) => dist(f.x, f.z, e.x, e.z) < 9);
    if (flare && e.state !== 'flee') { if (this.isHunting(e.state)) this.endHunt(); this.setState(e, 'flee'); }
    const heard = c.noise.heardAt(this.nav.roomAt(e.x, e.z), c.openLocks);
    const hearsIt = heard && heard.loudness * e.def.hearing * c.diff.entityPerception > 0.2;

    switch (e.state) {
      case 'lurk': {
        e.speed = 0;
        e.yaw += Math.sin(e.stateTime * 0.8 + e.id) * 0.9 * dt; // idle scanning so it is not blind to one side
        if (e.seesPlayer && (c.director.allowHunt || d < 5)) this.packTell(e, c);
        else if (hearsIt) { e.target = { x: heard!.x, z: heard!.z }; this.change(e, 'investigate'); }
        else if (e.stateTime > 25) this.change(e, 'patrol');
        break;
      }
      case 'patrol': {
        if (!e.target || this.goTo(e, e.target, e.def.walk * spd, dt, c) || e.stateTime > 20) { e.target = this.randomPatrolPoint(e); e.stateTime = 0; }
        if (e.seesPlayer && (c.director.allowHunt || d < 5)) this.packTell(e, c);
        else if (hearsIt) { e.target = { x: heard!.x, z: heard!.z }; this.change(e, 'investigate'); }
        break;
      }
      case 'investigate': {
        if (e.seesPlayer && (c.director.allowHunt || d < 5)) { this.packTell(e, c); break; }
        if (e.target && this.goTo(e, e.target, e.def.walk * 1.2 * spd, dt, c)) this.change(e, 'search');
        if (e.stateTime > 15) this.change(e, 'patrol');
        break;
      }
      case 'tell': {
        e.speed = 0;
        e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
        e.tellLeft -= dt;
        if (e.tellLeft <= 0) this.change(e, 'chase');
        break;
      }
      case 'chase': {
        if (e.seesPlayer || (p.hidden === false && d < 3)) { e.lostTime = 0; e.target = { x: p.x, z: p.z }; } else e.lostTime += dt;
        // flank: spread around the target instead of stacking up
        const idx = this.entities.filter((o) => o.pack === e.pack).indexOf(e);
        const side = (idx % 2 === 0 ? 1 : -1) * Math.min(2.5, d * 0.3) * (idx > 0 ? 1 : 0);
        const tx = (e.target?.x ?? p.x) + Math.cos(e.yaw) * side, tz = (e.target?.z ?? p.z) - Math.sin(e.yaw) * side;
        this.goTo(e, d > 5 ? { x: tx, z: tz } : { x: e.target?.x ?? p.x, z: e.target?.z ?? p.z }, e.def.run * spd, dt, c);
        if (d < 1.1 && !p.hidden && e.cooldown <= 0) this.hit(e, c);
        // smell: a hidden player right next to a hound is found anyway
        if (p.hidden && d > 2.2) e.lostTime += dt;
        if (e.lostTime > 7 && p.noise < 0.3) this.change(e, 'search');
        break;
      }
      case 'search': {
        if (e.seesPlayer && (c.director.allowHunt || d < 5)) { this.packTell(e, c); break; }
        if (!e.target || this.goTo(e, e.target, e.def.walk * spd, dt, c)) { e.speed = 0; }
        if (e.stateTime > 6) { this.change(e, 'patrol'); e.lostTime = 0; }
        break;
      }
      case 'flee': {
        const src = flare ?? p.flares[0] ?? { x: p.x, z: p.z };
        this.goTo(e, e.stateTime < 2.5 ? { x: e.x + (e.x - src.x), z: e.z + (e.z - src.z) } : e.home, e.def.run * spd, dt, c);
        const still = p.flares.some((f) => dist(f.x, f.z, e.x, e.z) < 12);
        if (e.stateTime > 5 && !still) this.change(e, 'patrol');
        break;
      }
      default: this.setState(e, 'patrol');
    }
  }

  /** One hound growls: the whole pack within earshot starts its tell together. */
  private packTell(e: Entity, c: AiContext): void {
    this.beginTell(e, c);
    for (const o of this.entities) {
      if (o === e || o.pack !== e.pack || o.state === 'tell' || o.state === 'chase' || o.state === 'flee') continue;
      if (dist(o.x, o.z, e.x, e.z) < 25) { this.change(o, 'tell'); o.tellLeft = o.def.tell * c.diff.tellTime * 1.1; o.tellStarted = false; }
    }
  }

  /** Closest awake threat proximity 0..1 for the stats system. */
  threatLevel(px: number, pz: number): number {
    let best = 0;
    for (const e of this.entities) {
      if (e.state === 'lurk' || e.state === 'patrol' && e.def.behavior === 'hound') { best = Math.max(best, Math.max(0, 1 - dist(e.x, e.z, px, pz) / 6) * 0.3); continue; }
      const d = dist(e.x, e.z, px, pz);
      best = Math.max(best, Math.max(0, 1 - d / 14) * (this.isHunting(e.state) ? 1 : 0.5));
    }
    return Math.min(1, best);
  }
}
