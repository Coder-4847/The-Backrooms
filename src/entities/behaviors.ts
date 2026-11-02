/**
 * Behavior modules for Phase 2 entities (spec 8.2). Each one reads the shared EntityWorld helpers
 * (steer/goTo/change/beginTell/hit) and keeps its timers in `e.data`. Every attack has a tell.
 *  - Howler: blind, hunts by sound, screams to alert others (pipes carry sound).
 *  - Coworker: harmless survivor figure (real). Skin-stealer: looks identical, approaches, attacks after a tell.
 *  - Concierge: summoned by breaking a posted rule; relentless but slower than a sprint, rings a bell first.
 *  - Hall Monitor: patrols halls, checks passes (real passes are ignored, forged ones sometimes fail).
 */
import type { AiContext, Entity, EntityWorld } from './ai';
import { ACT2 } from './behaviors2';
import { ACT3 } from './behaviors3';

export type Behavior = (w: EntityWorld, e: Entity, c: AiContext, dt: number) => void;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

function patrol(w: EntityWorld, e: Entity, c: AiContext, dt: number, speed: number): void {
  if (!e.target || w.goTo(e, e.target, speed, dt, c) || e.stateTime > 25) { e.target = w.randomPatrolPoint(e); e.stateTime = 0; }
}

const howler: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const heard = c.noise.heardAt(w.nav.roomAt(e.x, e.z), c.openLocks);
  const loud = heard ? heard.loudness * e.def.hearing * c.diff.entityPerception : 0;
  const d = dist(e.x, e.z, p.x, p.z);
  switch (e.state) {
    case 'patrol': {
      patrol(w, e, c, dt, e.def.walk * 0.8 * spd);
      if (loud > 0.25) { e.target = { x: heard!.x, z: heard!.z }; w.change(e, 'investigate'); }
      break;
    }
    case 'investigate': {
      if (heard && loud > 0.25) e.target = { x: heard.x, z: heard.z };
      if (e.target) w.goTo(e, e.target, e.def.walk * 1.6 * spd, dt, c);
      // a loud noise close by triggers the scream (tell) and the hunt
      if (loud > 0.6 && (c.director.allowHunt || d < 6) && !p.hidden) { w.beginTell(e, c); c.noise.emit(w.nav.roomAt(e.x, e.z), e.x, e.z, 1.4); break; }
      if (e.stateTime > 12) w.change(e, 'patrol');
      break;
    }
    case 'tell': {
      e.speed = 0; e.tellLeft -= dt;
      if (e.tellLeft <= 0) { e.data.quiet = 0; w.change(e, 'chase'); }
      break;
    }
    case 'chase': {
      if (heard && loud > 0.2) e.target = { x: heard.x, z: heard.z };
      if (p.noise < 0.12 || p.hidden) e.data.quiet = ((e.data.quiet as number) || 0) + dt; else e.data.quiet = 0;
      if (e.target) w.goTo(e, e.target, e.def.run * spd, dt, c);
      if (d < 1.4 && !p.hidden && p.noise > 0.1 && e.cooldown <= 0) w.hit(e, c); // blind: needs you to be audible when it touches you
      if ((e.data.quiet as number) > 4) w.change(e, 'search');
      break;
    }
    case 'search': {
      if (e.target) w.goTo(e, e.target, e.def.walk * spd, dt, c);
      if (loud > 0.3) { e.target = { x: heard!.x, z: heard!.z }; w.change(e, 'investigate'); }
      if (e.stateTime > 6) w.change(e, 'patrol');
      break;
    }
    default: w.setState(e, 'patrol');
  }
};

const coworker: Behavior = (w, e, c, dt) => {
  const p = c.player;
  const d = dist(e.x, e.z, p.x, p.z);
  if (d < 7 && !p.hidden) { e.speed = 0; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); return; }
  patrol(w, e, c, dt, e.def.walk * 0.6);
};

const skinstealer: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const disguised = e.data.disguised !== false;
  // light on the "shadow lags" tell: a sustained flashlight beam on it reveals it
  const aimed = p.flashOn && e.seenByPlayer && d < 12 && (() => { const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw); return ((e.x - p.x) * lx + (e.z - p.z) * lz) / Math.max(d, 1e-6) > 0.93; })();
  e.data.lit = aimed ? ((e.data.lit as number) || 0) + dt : Math.max(0, ((e.data.lit as number) || 0) - dt);
  if (disguised && (((e.data.lit as number) > 2.2) || e.data.reveal)) { e.data.disguised = false; e.data.reveal = false; if (c.mode === 'active') w.beginTell(e, c); else w.change(e, 'chase'); return; }
  switch (e.state) {
    case 'patrol': { // wandering "coworker": drifts toward the player if it notices them
      patrol(w, e, c, dt, e.def.walk * 0.7);
      if (!p.hidden && d < 16 && (e.seesPlayer || d < 8) && (c.director.allowHunt || d < 8)) w.change(e, 'hunt');
      break;
    }
    case 'hunt': { // friendly approach, slows down at conversation distance
      if (d > 3) w.goTo(e, { x: p.x, z: p.z }, e.def.walk * 1.2 * spd, dt, c); else { e.speed = 0; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); e.data.close = ((e.data.close as number) || 0) + (d < 2.2 ? dt : 0); }
      if ((e.data.close as number) > 4.5 && !p.hidden) { e.data.close = 0; w.beginTell(e, c); }
      if (p.hidden || d > 30) w.change(e, 'patrol');
      break;
    }
    case 'tell': {
      e.speed = 0; e.tellLeft -= dt; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
      if (e.tellLeft <= 0) { if (d < 3 && c.mode === 'active') { e.data.disguised = false; w.hit(e, c); } w.change(e, 'chase'); e.data.chaseT = 0; }
      break;
    }
    case 'chase': {
      e.data.chaseT = ((e.data.chaseT as number) || 0) + dt;
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 1.2 && e.cooldown <= 0 && !p.hidden) w.hit(e, c);
      if ((e.data.chaseT as number) > 9 || p.hidden) { w.change(e, 'flee'); }
      break;
    }
    case 'flee': {
      w.goTo(e, e.home, e.def.run * spd, dt, c);
      if (e.stateTime > 6) { e.data.disguised = true; w.change(e, 'patrol'); }
      break;
    }
    default: w.setState(e, 'patrol');
  }
};

const concierge: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  e.data.life = ((e.data.life as number) ?? 70) - dt;
  if ((e.data.life as number) <= 0) { w.remove(e); return; }
  switch (e.state) {
    case 'patrol': case 'hunt': {
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c); // knows where you are: it is the building
      if (d < 5.5 && e.cooldown <= 0) w.beginTell(e, c);
      if (e.state === 'patrol') w.change(e, 'hunt');
      break;
    }
    case 'tell': {
      e.speed = 0; e.tellLeft -= dt; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
      if (e.tellLeft <= 0) w.change(e, 'chase');
      break;
    }
    case 'chase': {
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 1.3 && e.cooldown <= 0 && !p.hidden) { w.hit(e, c); w.change(e, 'flee'); }
      break;
    }
    case 'flee': { w.steer(e, e.x + (e.x - p.x), e.z + (e.z - p.z), e.def.walk, dt); if (e.stateTime > 4) w.remove(e); break; }
    default: w.setState(e, 'hunt');
  }
};

const monitor: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const pass = c.pass ?? 'none';
  e.data.recheck = Math.max(0, ((e.data.recheck as number) || 0) - dt);
  switch (e.state) {
    case 'patrol': {
      patrol(w, e, c, dt, e.def.walk * spd);
      if (e.seesPlayer && !p.hidden && (e.data.recheck as number) <= 0) {
        if (pass === 'none') { if (c.director.allowHunt || d < 5) w.beginTell(e, c); }
        else { e.data.inspect = 3; w.setState(e, 'investigate'); }
      }
      break;
    }
    case 'investigate': { // inspecting a pass
      e.speed = 0; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
      e.data.inspect = (e.data.inspect as number) - dt;
      if ((e.data.inspect as number) <= 0) {
        e.data.recheck = 25;
        const fail = pass === 'forged' && w.rng.chance(0.35);
        if (fail) w.beginTell(e, c); else w.setState(e, 'patrol');
      }
      break;
    }
    case 'tell': {
      e.speed = 0; e.tellLeft -= dt; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
      if (e.tellLeft <= 0) { w.change(e, 'chase'); e.data.lost = 0; }
      break;
    }
    case 'chase': {
      e.data.lost = e.seesPlayer ? 0 : ((e.data.lost as number) || 0) + dt;
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 1.2 && e.cooldown <= 0 && !p.hidden) w.hit(e, c);
      if ((e.data.lost as number) > 6 || p.hidden) { e.data.recheck = 10; w.change(e, 'patrol'); }
      break;
    }
    default: w.setState(e, 'patrol');
  }
};

/** Companion (spec 8.4): follows, panics near hunters (noisy), recruitable survivors stand still until asked. */
const companion: Behavior = (w, e, c, dt) => {
  const p = c.player;
  if (!e.data.following) { e.speed = 0; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); return; }
  const d = dist(e.x, e.z, p.x, p.z);
  const threat = w.entities.some((o) => o !== e && o.def.id !== 'companion' && o.def.id !== 'coworker' && w.isHunting(o.state) && dist(o.x, o.z, e.x, e.z) < 12);
  e.data.panic = threat;
  if (threat) {
    e.speed = 0;
    e.data.cry = ((e.data.cry as number) || 0) - dt;
    if ((e.data.cry as number) <= 0) { e.data.cry = 2.2; c.noise.emit(w.nav.roomAt(e.x, e.z), e.x, e.z, 0.55); }
    return;
  }
  if (d > 2.6) w.goTo(e, { x: p.x, z: p.z }, d > 8 ? e.def.run : e.def.walk * 1.1, dt, c); else { e.speed = 0; e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); }
};

export const BEHAVIORS: Record<string, Behavior> = { howler, coworker, skinstealer, concierge, monitor, companion, ...ACT2, ...ACT3 };
