/**
 * Act 2 entity behaviors (spec 8.2): Lurker (blind, feels footsteps through the floor), Leviathan
 * (water giant that reacts to splashing), Cave Crawlers (light-averse swarm), Smilers (advance if you
 * stare or light them wrongly, retreat from lit rooms), the Drowned (water-bound), Sludge Leech
 * (attaches in sludge) and Static (blinking glitch). All telegraph before they hurt.
 */
import type { AiContext, Entity, EntityWorld } from './ai';
import type { Behavior } from './behaviors';

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const face = (e: Entity, p: { x: number; z: number }) => { e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); };
const aimedAt = (e: Entity, c: AiContext): boolean => {
  const p = c.player; const d = dist(e.x, e.z, p.x, p.z);
  if (!p.flashOn || d > 14) return false;
  const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
  return ((e.x - p.x) * lx + (e.z - p.z) * lz) / Math.max(d, 1e-6) > 0.9;
};
function wander(w: EntityWorld, e: Entity, c: AiContext, dt: number, speed: number): void {
  if (!e.target || w.goTo(e, e.target, speed, dt, c) || e.stateTime > 22) { e.target = w.randomPatrolPoint(e); e.stateTime = 0; }
}
const waterRooms = (w: EntityWorld) => (w.plan.water ?? []).map((q) => w.plan.rooms[q.room]);

/** Lurker: blind. It feels footsteps through the floor within ~9 m (walls do not matter) and hears the noise field. */
const lurker: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const heard = c.noise.heardAt(w.nav.roomAt(e.x, e.z), c.openLocks);
  const feel = !p.hidden && d < 9 && p.noise > 0.05 ? p.noise * (1 - d / 9) * 1.6 : 0;
  const loud = Math.max(feel, heard ? heard.loudness * e.def.hearing * c.diff.entityPerception : 0);
  e.data.rumble = d < 12 ? 1 - d / 12 : 0;
  switch (e.state) {
    case 'patrol': {
      wander(w, e, c, dt, e.def.walk * 0.7 * spd);
      if (loud > 0.22) { e.target = feel > 0.15 ? { x: p.x, z: p.z } : { x: heard!.x, z: heard!.z }; w.change(e, 'investigate'); }
      break;
    }
    case 'investigate': {
      if (feel > 0.15) e.target = { x: p.x, z: p.z };
      if (e.target) w.goTo(e, e.target, e.def.walk * 1.5 * spd, dt, c);
      if (loud > 0.5 && d < 10 && (c.director.allowHunt || d < 5)) { w.beginTell(e, c); break; }
      if (e.stateTime > 12) w.change(e, 'patrol');
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; if (e.tellLeft <= 0) { e.data.quiet = 0; w.change(e, 'chase'); } break; }
    case 'chase': {
      if (feel > 0.1) e.target = { x: p.x, z: p.z };
      e.data.quiet = loud < 0.1 ? ((e.data.quiet as number) || 0) + dt : 0;
      if (e.target) w.goTo(e, e.target, e.def.run * spd, dt, c);
      if (d < 1.4 && !p.hidden && p.noise > 0.05 && e.cooldown <= 0) w.hit(e, c);
      if ((e.data.quiet as number) > 5) w.change(e, 'search');
      break;
    }
    case 'search': { if (loud > 0.3) w.change(e, 'investigate'); else if (e.stateTime > 7) w.change(e, 'patrol'); e.speed = 0; break; }
    default: w.setState(e, 'patrol');
  }
};

/** Leviathan: roams the flooded rooms; splashing near it draws a surge and a strike. Seen only in glimpses. */
const leviathan: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const splash = p.water && p.noise > 0.3 ? p.noise : 0;
  switch (e.state) {
    case 'patrol': {
      if (!e.target || w.goTo(e, e.target, e.def.walk * spd, dt, c) || e.stateTime > 30) { const rs = waterRooms(w); const r = rs.length ? w.rng.pick(rs) : null; e.target = r ? { x: r.x + r.w / 2, z: r.z + r.d / 2 } : w.randomPatrolPoint(e); e.stateTime = 0; }
      if (splash > 0.3 && d < 24 && (c.director.allowHunt || d < 8)) { w.beginTell(e, c); }
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { e.data.strike = 1.8; w.change(e, 'chase'); } break; }
    case 'chase': {
      e.data.strike = (e.data.strike as number) - dt;
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 2.2 && p.water && e.cooldown <= 0 && !p.hidden) { w.hit(e, c); w.change(e, 'flee'); }
      if ((e.data.strike as number) <= 0) w.change(e, 'flee');
      break;
    }
    case 'flee': { w.steer(e, e.x + (e.x - p.x), e.z + (e.z - p.z), e.def.walk * spd, dt); if (e.stateTime > 6) w.change(e, 'patrol'); break; }
    default: w.setState(e, 'patrol');
  }
};

/** Cave Crawler: swarm that only commits in the dark; a beam or flare sends the whole pack away. */
const crawler: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  if (aimedAt(e, c) || p.flares.some((f) => dist(f.x, f.z, e.x, e.z) < 9)) { if (w.isHunting(e.state)) w.endHunt(); w.setState(e, 'flee'); }
  switch (e.state) {
    case 'lurk': case 'patrol': {
      e.speed = 0;
      const dark = p.light < 0.4;
      if (!p.hidden && d < 14 && (e.seesPlayer || d < 5) && dark && (c.director.allowHunt || d < 6)) {
        w.beginTell(e, c);
        for (const o of w.entities) if (o !== e && o.def.id === 'crawler' && o.pack === e.pack && o.state !== 'tell' && o.state !== 'chase' && dist(o.x, o.z, e.x, e.z) < 20) { w.change(o, 'tell'); o.tellLeft = o.def.tell * c.diff.tellTime; }
      }
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) w.change(e, 'chase'); break; }
    case 'chase': {
      const side = (e.id % 2 ? 1 : -1) * Math.min(1.8, d * 0.25);
      w.goTo(e, { x: p.x + Math.cos(e.yaw) * side, z: p.z - Math.sin(e.yaw) * side }, e.def.run * spd, dt, c);
      if (d < 0.9 && !p.hidden && e.cooldown <= 0) w.hit(e, c);
      e.data.lost = d > 18 || p.light > 0.6 ? ((e.data.lost as number) || 0) + dt : 0;
      if ((e.data.lost as number) > 4) w.change(e, 'lurk');
      break;
    }
    case 'flee': { w.goTo(e, e.home, e.def.run * spd, dt, c); if (e.stateTime > 4 && !aimedAt(e, c)) w.change(e, 'lurk'); break; }
    default: w.setState(e, 'lurk');
  }
};

/** Smiler: ignores you unless you stare at it or shine light on it; look away and it holds still. Lit rooms repel it. */
const smiler: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  const lit = p.light > 0.45 && !p.flashOn; // a lit room (not just your own beam)
  e.data.stare = e.seenByPlayer && d < 16 ? ((e.data.stare as number) || 0) + dt : Math.max(0, ((e.data.stare as number) || 0) - dt * 2);
  const provoked = (e.data.stare as number) > 2.6 || (aimedAt(e, c) && (e.data.beam = ((e.data.beam as number) || 0) + dt) > 0.8);
  if (!aimedAt(e, c)) e.data.beam = 0;
  switch (e.state) {
    case 'patrol': case 'lurk': {
      e.speed = 0;
      if (lit) break;
      if (provoked && !p.hidden && d < 16) w.beginTell(e, c);
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (lit || (!e.seenByPlayer && e.tellLeft > 0.3 && d > 8)) { w.change(e, 'lurk'); break; } if (e.tellLeft <= 0) w.change(e, 'chase'); break; }
    case 'chase': {
      if (lit) { w.change(e, 'flee'); break; }
      // look-away rule: while you do NOT see it, it only creeps; while you do, it rushes
      w.goTo(e, { x: p.x, z: p.z }, (e.seenByPlayer ? e.def.run : e.def.walk) * spd, dt, c);
      if (d < 1.2 && e.cooldown <= 0 && !p.hidden) { w.hit(e, c); w.change(e, 'flee'); }
      if (p.hidden) w.change(e, 'flee');
      break;
    }
    case 'flee': { w.goTo(e, e.home, e.def.run * spd, dt, c); if (e.stateTime > 5) { e.data.stare = 0; w.change(e, 'lurk'); } break; }
    default: w.setState(e, 'lurk');
  }
};

/** The Drowned: rare, water-bound; rises when you stay in the water, loses you if you dive quietly. */
const drowned: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  switch (e.state) {
    case 'patrol': case 'lurk': {
      e.speed = 0;
      e.data.wet = p.water && d < 12 ? ((e.data.wet as number) || 0) + dt : Math.max(0, ((e.data.wet as number) || 0) - dt);
      if ((e.data.wet as number) > 4 && !p.hidden) w.change(e, 'hunt');
      break;
    }
    case 'hunt': {
      w.goTo(e, { x: p.x, z: p.z }, e.def.run * spd, dt, c);
      if (d < 1.8 && e.cooldown <= 0) w.beginTell(e, c);
      if (!p.water || p.noise < 0.08 || d > 20) { e.data.lose = ((e.data.lose as number) || 0) + dt; if ((e.data.lose as number) > 4) { e.data.lose = 0; w.change(e, 'lurk'); } } else e.data.lose = 0;
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { if (d < 2.4) w.hit(e, c); w.change(e, 'flee'); } break; }
    case 'flee': { w.goTo(e, e.home, e.def.walk, dt, c); if (e.stateTime > 5) w.change(e, 'lurk'); break; }
    default: w.setState(e, 'lurk');
  }
};

/** Sludge Leech: waits in sludge; if you wade close it attaches and drains you until you leave its room. */
const leech: Behavior = (w, e, c, dt) => {
  const p = c.player;
  const d = dist(e.x, e.z, p.x, p.z);
  const sameRoom = w.nav.roomAt(e.x, e.z) === w.nav.roomAt(p.x, p.z);
  switch (e.state) {
    case 'patrol': case 'lurk': {
      e.speed = 0;
      if (sameRoom && p.water && d < 5 && !p.hidden) w.beginTell(e, c);
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { e.data.attached = 0; w.change(e, 'chase'); } break; }
    case 'chase': { // slithers after you; once on you it bleeds you slowly
      if (d > 0.9) w.goTo(e, { x: p.x, z: p.z }, e.def.run * c.diff.entitySpeed, dt, c); else { e.speed = 0; e.data.attached = ((e.data.attached as number) || 0) + dt; if ((e.data.attached as number) > 1 && e.cooldown <= 0) { e.data.attached = 0; w.hit(e, c); } }
      if (!sameRoom || d > 7 || !p.water) w.change(e, 'flee'); // leaving the sludge sheds it
      if (p.noise > 0.9) e.data.shake = ((e.data.shake as number) || 0) + dt; // thrashing about sheds it
      if ((e.data.shake as number) > 2) { e.data.shake = 0; w.change(e, 'flee'); }
      break;
    }
    case 'flee': { w.goTo(e, e.home, e.def.walk, dt, c); if (e.stateTime > 5) w.change(e, 'lurk'); break; }
    default: w.setState(e, 'lurk');
  }
};

/** Static: a glitch that blinks toward you in short jumps; its tell is the screen tearing. */
const staticB: Behavior = (w, e, c, dt) => {
  const p = c.player, spd = c.diff.entitySpeed;
  const d = dist(e.x, e.z, p.x, p.z);
  e.data.glitch = d < 12 ? 1 - d / 12 : 0;
  switch (e.state) {
    case 'patrol': {
      wander(w, e, c, dt, e.def.walk * 0.7 * spd);
      if (!p.hidden && d < 18 && (c.director.allowHunt || d < 8) && (p.flashOn || e.seesPlayer)) w.change(e, 'hunt'); // drawn to light and screens
      break;
    }
    case 'hunt': {
      e.data.blink = ((e.data.blink as number) || 0) - dt;
      if ((e.data.blink as number) <= 0 && d > 3) {
        e.data.blink = 1.8 / spd;
        for (let k = 0; k < 8; k++) { // short hop toward the player, only to open floor
          const a = Math.atan2(e.z - p.z, e.x - p.x) + (w.rng.next() - 0.5) * 1.6, r = Math.max(2.4, d - 4);
          const nx = p.x + Math.cos(a) * r, nz = p.z + Math.sin(a) * r;
          if (!w.world.overlapsCircle(nx, nz, 0.4) && w.nav.roomAt(nx, nz) >= 0) { e.x = nx; e.z = nz; break; }
        }
      }
      if (d < 3 && e.cooldown <= 0 && !p.hidden) w.beginTell(e, c);
      if (p.hidden || d > 30) w.change(e, 'patrol');
      break;
    }
    case 'tell': { e.speed = 0; e.tellLeft -= dt; face(e, p); if (e.tellLeft <= 0) { if (d < 4) w.hit(e, c); w.change(e, 'flee'); } break; }
    case 'flee': { w.steer(e, e.x + (e.x - p.x), e.z + (e.z - p.z), e.def.run * spd, dt); if (e.stateTime > 4) w.change(e, 'patrol'); break; }
    default: w.setState(e, 'patrol');
  }
};

export const ACT2: Record<string, Behavior> = { lurker, leviathan, crawler, smiler, drowned, leech, static: staticB };
