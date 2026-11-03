import { describe, expect, it } from 'vitest';
import { levelById } from '../src/levels/registry';
import { LevelSim } from '../src/levels/sim';
import { Director, type DirectorEvent } from '../src/systems/director';
import { DIFFICULTIES } from '../src/core/difficulty';
import { ENTITIES } from '../src/entities/defs';
import { Jumpscare } from '../src/levels/scare';
import { Player } from '../src/core/player';
import { emptyFrame } from '../src/core/input/logic';
import { StaticWorld } from '../src/core/collision';
import { Rng } from '../src/gen/rng';

const plan = levelById('level0')!.generate(42, { difficulty: 'normal' });

describe('horror tuning', () => {
  it('hostiles hit hard and warn briefly; friendlies and the finale chase are untouched', () => {
    expect(ENTITIES.stick.damage).toBeGreaterThanOrEqual(30);
    expect(ENTITIES.hound.damage).toBeGreaterThanOrEqual(18);
    for (const id of ['stick', 'hound', 'howler', 'smiler']) expect(ENTITIES[id].tell, id).toBeLessThan(1.1);
    expect(ENTITIES.coworker.damage).toBe(0); expect(ENTITIES.companion.damage).toBe(0);
    expect(ENTITIES.leech.damage).toBeLessThan(5); // still a slow bleed
    expect(ENTITIES.pursuer.run).toBe(2.7);
  });
  it('Normal is harder than before and the ladder still rises', () => {
    const n = DIFFICULTIES.normal;
    expect(n.entitySpeed).toBeGreaterThan(1); expect(n.tellTime).toBeLessThan(1); expect(n.breather).toBeLessThan(1);
    expect(DIFFICULTIES.hard.entitySpeed).toBeGreaterThan(n.entitySpeed); expect(DIFFICULTIES.nightmare.breather).toBeLessThan(DIFFICULTIES.hard.breather);
  });
});

describe('Director dread', () => {
  it('fires dread beats (not just flicker) within the first minutes, and never goes quiet for long', () => {
    const dir = new Director(DIFFICULTIES.normal, 0.7, new Rng(5));
    const seen = new Set<DirectorEvent>(); let gap = 0, worstGap = 0;
    for (let i = 0; i < 60 * 600; i++) {
      const ev = dir.update(1 / 60, 0);
      if (ev) { seen.add(ev); gap = 0; } else gap += 1 / 60;
      worstGap = Math.max(worstGap, gap);
    }
    for (const k of ['blackout', 'slam', 'breath', 'knock', 'stare', 'whisperClose', 'silence'] as DirectorEvent[]) expect(seen.has(k), k).toBe(true);
    expect(worstGap).toBeLessThan(70);
  });
  it('quiet no longer lasts a minute', () => {
    const dir = new Director(DIFFICULTIES.normal, 0.7, new Rng(1));
    let quiet = 0, worst = 0;
    for (let i = 0; i < 60 * 900; i++) { dir.update(1 / 60, 0); if (dir.phase === 'quiet') { quiet += 1 / 60; worst = Math.max(worst, quiet); } else quiet = 0; }
    expect(worst).toBeLessThan(25);
  });
});

describe('roaming hunters and ambushes', () => {
  it('every level with hostiles gets roaming extras on Normal, none on Easy', () => {
    const base = (d: 'easy' | 'normal') => new LevelSim(plan, d, { seed: 3 }).ew.entities.filter((e) => e.def.damage > 0);
    expect(base('normal').some((e) => e.data.extra)).toBe(true);
    expect(base('easy').some((e) => e.data.extra)).toBe(false);
  });
  it('a Director ambush spawns a hunter out of sight that goes after you, then fades if unseen', () => {
    const sim = new LevelSim(plan, 'normal', { seed: 9 });
    sim.ew.entities.length = 0;
    const before = sim.ew.entities.length;
    (sim as unknown as { ambush(): void }).ambush();
    expect(sim.ew.entities.length).toBe(before + 1);
    const e = sim.ew.entities[sim.ew.entities.length - 1];
    expect(Math.hypot(e.x - sim.player.x, e.z - sim.player.z)).toBeGreaterThan(12);
    expect(e.data.ambushUntil).toBeGreaterThan(sim.time);
    sim.time += 200; e.seenByPlayer = false;
    (sim as unknown as { reapAmbushers(): void }).reapAmbushers();
    sim.ew.update(0.016, (sim as unknown as { ctx: never }).ctx);
    expect(sim.ew.entities.includes(e)).toBe(false);
  });
  it('a lethal hit is flagged on the event, and god mode never dies', () => {
    const sim = new LevelSim(plan, 'normal', { seed: 4 });
    let lethal: boolean | null = null;
    sim.listeners.push((ev) => { if (ev.type === 'hit') lethal = ev.lethal; });
    sim.stats.health = 5;
    const e = sim.ew.spawn('stick', sim.player.x, sim.player.z - 1);
    sim.ew.hit(e, (sim as unknown as { ctx: never }).ctx);
    expect(lethal).toBe(true);
    const god = new LevelSim(plan, 'normal', { seed: 4 }); god.player.god = true; god.stats.health = 5;
    let l2: boolean | null = null; god.listeners.push((ev) => { if (ev.type === 'hit') l2 = ev.lethal; });
    god.ew.hit(god.ew.spawn('stick', god.player.x, god.player.z - 1), (god as unknown as { ctx: never }).ctx);
    expect(l2).toBe(false);
  });
});

describe('jump scare plumbing', () => {
  it('classifies hits: lethal > heavy > bite', () => {
    expect(Jumpscare.kindFor(10, true)).toBe('lethal'); expect(Jumpscare.kindFor(35, false)).toBe('heavy'); expect(Jumpscare.kindFor(8, false)).toBe('light');
  });
  it('the freeze ignores movement and look input, then releases', () => {
    const p = new Player(); const w = new StaticWorld();
    p.place(0, 0, 0); p.lockT = 0.5;
    const f = emptyFrame(); f.moveY = 1; f.lookX = 0.3;
    for (let i = 0; i < 20; i++) p.update(1 / 60, f, w);
    expect(Math.abs(p.z)).toBeLessThan(0.01); expect(p.yaw).toBe(0);
    f.lookX = 0; // (a constant look delta would just spin the player in circles)
    for (let i = 0; i < 120; i++) p.update(1 / 60, f, w);
    expect(Math.abs(p.z)).toBeGreaterThan(0.3);
  });
});
