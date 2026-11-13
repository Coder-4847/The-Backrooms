import { describe, expect, it } from 'vitest';
import { makeLab } from '../src/entities/lab';
import { chaseCap } from '../src/entities/ai';
import { Director } from '../src/systems/director';
import { ENTITIES } from '../src/entities/defs';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/core/difficulty';
import { Rng } from '../src/gen/rng';
import { NoiseField } from '../src/systems/noise';
import { levelById } from '../src/levels/registry';
import { NavGraph } from '../src/entities/nav';

const faceEast = -Math.PI / 2; // yaw whose forward is +x ... forward = (-sin yaw, -cos yaw)
const face = (e: { x: number; z: number; yaw: number }, t: { x: number; z: number }) => { e.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z)); };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('Stick (entity lab)', () => {
  it('stays frozen while the player is looking at it, and advances when they look away', () => {
    const lab = makeLab();
    const st = lab.ew.spawn('stick', 25, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.yaw = faceEast * -1; // forward = (-sin(PI/2), ..) = (-1,0)? set below
    // face the stick: forward vector must point to +x
    lab.player.yaw = -Math.PI / 2; // forward = (-sin(-pi/2), -cos(-pi/2)) = (1, 0)
    lab.run(6);
    const d0 = dist(st, lab.player);
    lab.run(6);
    expect(dist(st, lab.player)).toBeGreaterThan(d0 - 0.2); // not closing while watched
    lab.player.yaw = Math.PI / 2; // look away
    const before = dist(st, lab.player);
    lab.run(4);
    expect(dist(st, lab.player)).toBeLessThan(before - 2);
  });
  it('backs off from a strong flashlight beam', () => {
    const lab = makeLab();
    const st = lab.ew.spawn('stick', 14, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; lab.player.flashOn = true; lab.player.flashPower = 1;
    lab.run(0.3);
    expect(st.state).toBe('flee');
    const d = dist(st, lab.player);
    lab.run(1.2);
    expect(dist(st, lab.player)).toBeGreaterThan(d);
  });
  it('always telegraphs: a tell precedes every hit, lasting at least the difficulty tell time', () => {
    for (const diff of ['easy', 'normal', 'nightmare'] as const) {
      const lab = makeLab({ difficulty: diff });
      lab.ew.spawn('stick', 8, 15);
      lab.player.x = 7; lab.player.z = 15; lab.player.yaw = Math.PI / 2; // looking away, stick right behind
      let tellAt = -1, hitAt = -1;
      lab.run(12, (t) => {
        for (const e of lab.events) { if (e.type === 'tell' && tellAt < 0) tellAt = t; if (e.type === 'hit' && hitAt < 0) hitAt = t; }
      });
      expect(tellAt, diff).toBeGreaterThan(0); expect(hitAt, diff).toBeGreaterThan(tellAt);
      expect(hitAt - tellAt, diff).toBeGreaterThanOrEqual(Math.max(0.38, ENTITIES.stick.tell * DIFFICULTIES[diff].tellTime) - 0.1);
    }
  });
  it('staring at it during its tell no longer saves you: only the flashlight in its face (or distance) does', () => {
    const stare = makeLab();
    stare.ew.spawn('stick', 8, 15);
    stare.player.x = 7; stare.player.z = 15; stare.player.yaw = Math.PI / 2;
    stare.run(0.35); // tell has begun
    stare.player.yaw = -Math.PI / 2; // turn and look
    stare.run(5);
    expect(stare.events.some((e) => e.type === 'hit')).toBe(true);
    const lit = makeLab();
    lit.ew.spawn('stick', 8, 15);
    lit.player.x = 7; lit.player.z = 15; lit.player.yaw = Math.PI / 2;
    lit.run(0.35);
    lit.player.yaw = -Math.PI / 2; lit.player.flashOn = true; lit.player.flashPower = 1;
    lit.run(5);
    expect(lit.events.some((e) => e.type === 'hit')).toBe(false);
  });
  it('observe-only mode never damages', () => {
    const lab = makeLab({ mode: 'observe' });
    lab.ew.spawn('stick', 8, 15); lab.player.x = 7; lab.player.z = 15; lab.player.yaw = Math.PI / 2;
    lab.run(10);
    expect(lab.events.some((e) => e.type === 'hit')).toBe(false);
  });
});

describe('Hound (entity lab)', () => {
  it('investigates a loud noise from another spot', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('hound', 30, 5);
    lab.player.x = 3; lab.player.z = 27; lab.player.hidden = true; // out of sight
    lab.noise.emit(0, 6, 26, 1);
    lab.run(0.5);
    expect(h.state).toBe('investigate');
    const d0 = dist(h, { x: 6, z: 26 });
    lab.run(3);
    expect(dist(h, { x: 6, z: 26 })).toBeLessThan(d0 - 3);
  });
  it('spotting you from a distance: a short growl, then it chases straight away (no stand-off)', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('hound', 15, 15);
    lab.player.x = 5; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; face(h, lab.player);
    let tell = -1, chaseAt = -1;
    lab.run(6, (t) => { if (h.state === 'tell' && tell < 0) tell = t; if (h.state === 'chase' && chaseAt < 0) chaseAt = t; });
    expect(tell).toBeGreaterThan(0);
    expect(chaseAt - tell).toBeLessThanOrEqual(0.6);
    expect(h.def.run).toBeGreaterThan(2.3); // faster than the player's walk
  });
  it('never runs faster than the player can sprint (you can always outrun it)', () => {
    for (const d of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const lab = makeLab({ difficulty: d });
      const h = lab.ew.spawn('hound', 25, 15); lab.player.x = 5; lab.player.z = 15; face(h, lab.player);
      h.state = 'chase'; h.target = { x: 5, z: 15 };
      const x0 = h.x; lab.run(1);
      expect(Math.abs(h.x - x0)).toBeLessThan(4.0); // player sprint is 4 m/s
      expect(chaseCap(DIFFICULTIES[d].entitySpeed)).toBeLessThan(4.0);
    }
  });
  it('a hit never lands before the tell finished', () => {
    const lab = makeLab({ difficulty: 'hard' });
    const hh = lab.ew.spawn('hound', 9, 15); lab.player.x = 5; lab.player.z = 15; face(hh, lab.player);
    let tellAt = -1, hitAt = -1;
    lab.run(8, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tellAt < 0) tellAt = t; if (e.type === 'hit' && hitAt < 0) hitAt = t; } });
    expect(hitAt - tellAt).toBeGreaterThanOrEqual(1.3 * DIFFICULTIES.hard.tellTime - 0.1);
  });
  it('loses interest when the player hides and stays quiet', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('hound', 13, 15);
    lab.player.x = 5; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; face(h, lab.player);
    lab.run(2);
    expect(['tell', 'chase']).toContain(h.state);
    lab.player.hidden = true; lab.player.x = 3; lab.player.z = 3; lab.player.noise = 0;
    h.x = 20; h.z = 25; // knocked back out of smell range
    lab.run(16);
    expect(['search', 'patrol', 'lurk']).toContain(h.state);
  });
  it('scatters from a flare', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('hound', 12, 15);
    lab.player.x = 5; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; face(h, lab.player);
    lab.run(1);
    lab.player.flares = [{ x: 9, z: 15 }];
    lab.run(0.2);
    expect(h.state).toBe('flee');
    const d = dist(h, lab.player);
    lab.run(1.2);
    expect(dist(h, lab.player)).toBeGreaterThan(d);
  });
  it('pack members all start their tell together', () => {
    const lab = makeLab();
    const a = lab.ew.spawn('hound', 15, 14, 1), b = lab.ew.spawn('hound', 16, 16, 1);
    lab.player.x = 6; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; face(a, lab.player);
    lab.run(0.5);
    expect(a.state === 'tell' || a.state === 'chase').toBe(true); expect(b.state === 'tell' || b.state === 'chase').toBe(true);
  });
  it('is deterministic for a seed', () => {
    const run = () => { const lab = makeLab({ seed: 11 }); const h = lab.ew.spawn('hound', 20, 8); lab.noise.emit(0, 5, 5, 1); lab.player.hidden = true; lab.run(6); return [h.x.toFixed(4), h.z.toFixed(4), h.state]; };
    expect(run()).toEqual(run());
  });
});

describe('Director', () => {
  it('guarantees a breather after a hunt ends: no hunts while releasing/quiet', () => {
    for (const d of DIFFICULTY_ORDER) {
      const dir = new Director(DIFFICULTIES[d], 0.6, new Rng(3));
      dir.phase = 'build';
      dir.huntStarted();
      expect(dir.allowHunt).toBe(true);
      for (let i = 0; i < 60 * 36; i++) dir.update(1 / 60, 0.0);
      // hunt ended with no threat: must now be in release or quiet and refuse hunts
      expect(['release', 'quiet']).toContain(dir.phase);
      const minQuiet = 5;
      let blocked = 0;
      for (let i = 0; i < 60 * minQuiet; i++) { dir.update(1 / 60, 0); if (!dir.allowHunt) blocked++; }
      expect(blocked).toBeGreaterThan(60 * (minQuiet - 3));
    }
  });
  it('lower difficulties get longer breathers than higher ones', () => {
    const quietTime = (id: 'easy' | 'nightmare') => { const dir = new Director(DIFFICULTIES[id], 0.6, new Rng(8)); dir.phase = 'build'; dir.huntStarted(); let t = 0; for (let i = 0; i < 60 * 400; i++) { dir.update(1 / 60, 0); t += dir.allowHunt ? 0 : 1 / 60; if (dir.allowHunt && t > 40) break; } return t; };
    expect(quietTime('easy')).toBeGreaterThan(quietTime('nightmare'));
  });
  it('never fires ambient events right after a hunt (only in build/quiet phases)', () => {
    const dir = new Director(DIFFICULTIES.normal, 1, new Rng(2));
    dir.phase = 'build'; dir.huntStarted();
    let events = 0;
    for (let i = 0; i < 60 * 10; i++) if (dir.update(1 / 60, 1) === 'ambush') events++;
    expect(events).toBe(0);
  });
});

describe('noise propagation and nav', () => {
  const plan = levelById('placeholder')!.generate(21);
  it('loudness drops with each wall hop and locked doors muffle more', () => {
    const nf = new NoiseField(plan);
    const src = plan.spawn.room;
    const m = nf.propagate(src, 1);
    expect(m.get(src)).toBe(1);
    const neighbors = plan.connections.filter((c) => c.a === src || c.b === src).map((c) => (c.a === src ? c.b : c.a));
    for (const n of neighbors) expect(m.get(n)!).toBeLessThan(1);
    const far = [...m.entries()].filter(([r]) => r !== src);
    expect(Math.max(...far.map(([, v]) => v))).toBeLessThan(0.6);
    const locked = plan.connections.find((c) => c.lock);
    if (locked) {
      const a = nf.propagate(locked.a, 1, new Set()).get(locked.b) ?? 0, b = nf.propagate(locked.a, 1, new Set([locked.lock!])).get(locked.b) ?? 0;
      expect(b).toBeGreaterThan(a);
    }
  });
  it('entities path around the level on the nav graph and respect closed doors', () => {
    const nav = new NavGraph(plan);
    const a = plan.spawn.pos, b = plan.exit.pos;
    const none = nav.path(a, b, new Set());
    const keys = new Set(plan.connections.filter((c) => c.lock).map((c) => c.lock!));
    const all = nav.path(a, b, keys);
    expect(all).not.toBeNull();
    if (plan.connections.some((c) => c.lock)) expect(none).toBeNull();
    expect(all![all!.length - 1]).toEqual(b);
  });
});
