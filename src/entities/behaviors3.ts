/**
 * Act 3 entity behaviors (spec 8.2): Platform Wraith (only while a train passes), Partygoers (friendly
 * until a rule is broken), Whiteout Stalker (storm hunter, will not enter warm rooms), Window-Man (steps
 * closer each time you look back), Motion Echo (replays your own path late), Curator (frozen while
 * watched), Pursuer (relentless but slower than a sprint; holds off at checkpoints) and the Architect.
 */
import type { AiContext, Entity, EntityWorld } from './ai';
import type { Behavior } from './behaviors';

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const face = (e: Entity, p: { x: number; z: number }) => { e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); };
function wander(w: EntityWorld, e: Entity, c: AiContext, dt: number, speed: number): void {
  if (!e.target || w.goTo(e, e.target, speed, dt, c) || e.stateTime > 22) { e.target = w.randomPatrolPoint(e); e.stateTime = 0; }
}

const wraith: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const active = !!c.trainActive;
  e.data.hidden = !active;
  if (!active) { if (w.isHunting(e.state)) w.endHunt(); e.speed = 0; e.x += (e.home.x - e.x) * Math.min(1, dt); e.z += (e.home.z - e.z) * Math.min(1, dt); w.setState(e, 'patrol'); return; }
  const d = dist(e.x, e.z, p.x, p.z);
  switch (e.state) {
    case 'patrol': { wander(w, e, c, dt, e.def.walk * spd); if (!p.hidden && d < 18 && (e.seesPlayer || d < 7) && (c.director.allowHunt || d < 6)) w.beginTell(e, c); break; }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) w.change(e, 'chase'); break; }
    case 'chase': { w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c); if (d < 1.2 && e.cooldown <= 0 && !p.hidden) w.hit(e, c); if (p.hidden) w.change(e, 'patrol'); break; }
    default: w.setState(e, 'patrol');
  }
};

const partygoer: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  if (!c.alert) { if (e.state !== 'patrol') { if (w.isHunting(e.state)) w.endHunt(); w.setState(e, 'patrol'); } if (d < 3.5 && !p.hidden) { e.speed = 0; face(e, p); } else wander(w, e, c, dt, e.def.walk * 0.7); return; }
  switch (e.state) {
    case 'patrol': { if (!p.hidden && d < 25) w.beginTell(e, c); break; }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) w.change(e, 'chase'); break; }
    case 'chase': { w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c); if (d < 1.1 && e.cooldown <= 0 && !p.hidden) w.hit(e, c); if (p.hidden) w.change(e, 'patrol'); break; }
    default: w.setState(e, 'patrol');
  }
};

const stalker: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const warm = w.plan.cold?.warm.includes(w.nav.roomAt(p.x, p.z)) ?? false;
  if (p.flares.some((f) => dist(f.x, f.z, e.x, e.z) < 8) && e.state !== 'flee') { if (w.isHunting(e.state)) w.endHunt(); w.setState(e, 'flee'); }
  e.data.cloaked = d > 6;
  switch (e.state) {
    case 'patrol': { wander(w, e, c, dt, e.def.walk * 0.8 * spd); if (!warm && !p.hidden && d < 22 && (c.director.allowHunt || d < 8)) w.change(e, 'hunt'); break; }
    case 'hunt': {
      if (warm || p.hidden) { w.change(e, 'patrol'); break; }
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 4 && e.cooldown <= 0) w.beginTell(e, c);
      if (d > 30) w.change(e, 'patrol');
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { if (d < 4.5 && !warm) w.hit(e, c); w.change(e, 'flee'); } break; }
    case 'flee': { w.goTo(e, e.home, e.def.run * spd, dt, c); if (e.stateTime > 5) w.change(e, 'patrol'); break; }
    default: w.setState(e, 'patrol');
  }
};

/** Window-Man: stands still; each time you turn back and see it, it is closer. */
const windowman: Behavior = (w, e, c, dt) => {
  const p = c.player;
  const d = dist(e.x, e.z, p.x, p.z);
  const seen = e.seenByPlayer;
  const was = !!e.data.wasSeen; e.data.wasSeen = seen;
  switch (e.state) {
    case 'patrol': {
      e.speed = 0; face(e, p);
      if (seen && !was && d > 5 && d < 22 && !p.hidden) { // you looked back: it is nearer
        const step = Math.min(3.2, d - 4), nx = e.x + ((p.x - e.x) / d) * step, nz = e.z + ((p.z - e.z) / d) * step;
        if (!w.world.overlapsCircle(nx, nz, 0.4)) { e.x = nx; e.z = nz; }
      }
      if (d < 4.6 && !p.hidden && (c.director.allowHunt || d < 3)) w.beginTell(e, c);
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (seen && p.flashOn) { w.change(e, 'flee'); break; } if (e.tellLeft <= 0) { if (d < 5.5) w.hit(e, c); w.change(e, 'flee'); } break; }
    case 'flee': { w.steer(e, e.x + (e.x - p.x), e.z + (e.z - p.z), e.def.run, dt); if (e.stateTime > 3) { w.setState(e, 'patrol'); } break; }
    default: w.setState(e, 'patrol');
  }
};

/** Motion Echo: your own path, five seconds late. Keep moving; it becomes visible and tells before it touches you. */
const echo: Behavior = (w, e, c, dt) => {
  const p = c.player, trail = c.trail ?? [], now = c.time ?? 0;
  const delay = 5;
  const target = now - delay;
  let pt = null as { x: number; z: number } | null;
  for (let i = trail.length - 1; i >= 0; i--) if (trail[i].t <= target) { pt = trail[i]; break; }
  if (!pt) { e.data.hidden = true; e.speed = 0; return; }
  const nx = pt.x, nz = pt.z;
  e.speed = dist(e.x, e.z, nx, nz) / Math.max(dt, 1e-3) > 0.2 ? 2 : 0;
  e.yaw = Math.atan2(-(nx - e.x), -(nz - e.z)); e.x = nx; e.z = nz;
  const d = dist(e.x, e.z, p.x, p.z);
  e.data.hidden = d > 12; // it only shows when it is near
  if (e.state === 'tell') { e.tellLeft -= dt; if (e.tellLeft <= 0) { if (d < 1.4 && !p.hidden) w.hit(e, c); w.change(e, 'patrol'); e.cooldown = Math.max(e.cooldown, 3); } return; }
  if (d < 2.4 && e.cooldown <= 0 && !p.hidden && c.mode === 'active') w.beginTell(e, c);
};

const curator: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  e.data.life = ((e.data.life as number) ?? 60) - dt;
  if ((e.data.life as number) <= 0) { w.remove(e); return; }
  switch (e.state) {
    case 'patrol': case 'hunt': {
      if (e.seenByPlayer) { e.speed = 0; if (e.state === 'patrol') w.change(e, 'hunt'); break; } // frozen while you look at it
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (e.state === 'patrol') w.change(e, 'hunt');
      if (d < 3.5 && e.cooldown <= 0) w.beginTell(e, c);
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.seenByPlayer && d > 2) { w.change(e, 'hunt'); break; } if (e.tellLeft <= 0) { if (d < 3) w.hit(e, c); w.change(e, 'flee'); } break; }
    case 'flee': { w.steer(e, e.x + (e.x - p.x), e.z + (e.z - p.z), e.def.walk, dt); if (e.stateTime > 3) w.remove(e); break; }
    default: w.setState(e, 'hunt');
  }
};

/** Pursuer: starts after a grace delay, never stops, slower than a sprint; holds off while you rest at a checkpoint. */
const pursuer: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  e.data.grace = ((e.data.grace as number) ?? 12) - dt;
  if ((e.data.grace as number) > 0) { e.speed = 0; e.data.hidden = false; return; }
  const resting = (c.safeSpots ?? []).some((s) => dist(s.x, s.z, p.x, p.z) < 3.5);
  switch (e.state) {
    case 'patrol': case 'hunt': {
      if (resting && d < 9) { e.speed = 0; w.setState(e, 'hunt'); break; }
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (e.state === 'patrol') w.change(e, 'hunt');
      if (d < 3.4 && e.cooldown <= 0 && !p.hidden && !resting) w.beginTell(e, c);
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { if (d < 4.2) w.hit(e, c); w.change(e, 'hunt'); e.cooldown = 6; } break; }
    default: w.setState(e, 'hunt');
  }
};

const architect: Behavior = (_w, e, c) => { e.speed = 0; face(e, c.player); };

export const ACT3: Record<string, Behavior> = { wraith, partygoer, stalker, windowman, echo, curator, pursuer, architect };
