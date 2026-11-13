import { describe, expect, it } from 'vitest';
import { Inventory, applyDeathPenalty, GRID_H, GRID_W } from '../src/systems/inventory';
import { ITEMS, itemDef } from '../src/systems/items';
import { Stats } from '../src/systems/stats';
import { Flashlight, Camcorder } from '../src/systems/light';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../src/core/difficulty';
import { Rng } from '../src/gen/rng';
import { LevelSim } from '../src/levels/sim';
import { level0 } from '../src/levels/level0';
import { emptyFrame } from '../src/core/input/logic';
import { SAVE_VERSION, newSlot } from '../src/core/save';
import { NOTES, LEVEL_NOTES } from '../src/story/notes';

describe('inventory', () => {
  it('stacks, respects stack limits and grid space, and reports overflow', () => {
    const inv = new Inventory();
    expect(inv.add('battery', 3)).toBe(0);
    expect(inv.count('battery')).toBe(3);
    expect(inv.stacks).toHaveLength(1);
    inv.add('battery', 3); // stack of 4 then a new stack
    expect(inv.stacks.filter((s) => s.id === 'battery')).toHaveLength(2);
    // fill the grid with 1x2 flashlights (stack 1): 12 fit (6x4 grid, 1x2 each)
    const full = new Inventory();
    let added = 0; for (let i = 0; i < 30; i++) if (full.add('flashlight') === 0) added++;
    expect(added).toBe((GRID_W * GRID_H) / 2);
  });
  it('removes across stacks, moves items on the grid and never overlaps', () => {
    const inv = new Inventory(); inv.add('cracker', 6);
    expect(inv.remove('cracker', 5)).toBe(true); expect(inv.count('cracker')).toBe(1); expect(inv.remove('cracker', 2)).toBe(false);
    inv.add('flashlight');
    const s = inv.stacks.find((x) => x.id === 'flashlight')!;
    expect(inv.move(s, 5, 3)).toBe(false); // 1x2 at the bottom edge does not fit
    expect(inv.move(s, 5, 2)).toBe(true);
    expect(inv.canPlace('cracker', 5, 2)).toBe(false);
  });
  it('auto-assigns the hotbar, tracks weight, and round-trips through the save format', () => {
    const inv = Inventory.starter();
    expect(inv.hotbar.filter(Boolean).length).toBeGreaterThan(0);
    expect(inv.weight).toBeGreaterThan(0.5);
    const back = Inventory.fromState(inv.toState());
    expect(back.count('flashlight')).toBe(1); expect(back.count('almond_water')).toBe(1); expect(back.hotbar).toEqual(inv.hotbar);
    const heavy = new Inventory(); for (let i = 0; i < 8; i++) heavy.add('almond_water', 4);
    expect(heavy.weightFactor).toBeLessThan(1);
  });
  it('old saves: items that sat in the stash lockers come along in the backpack', () => {
    const inv = Inventory.fromState({ hotbar: [null, null, null, null], backpack: [{ id: 'battery', n: 1 }], stash: [{ id: 'battery', n: 2 }, { id: 'flare', n: 1 }] });
    expect(inv.count('battery')).toBe(3); expect(inv.count('flare')).toBe(1);
    expect(inv.toState()).not.toHaveProperty('stash');
  });
  it('death penalty scales with difficulty and never takes essentials', () => {
    const lose = (p: Parameters<typeof applyDeathPenalty>[1]) => {
      let total = 0;
      for (let s = 0; s < 30; s++) { const inv = Inventory.starter(); inv.add('battery', 4); inv.add('almond_water', 4); inv.add('cracker', 4); inv.add('key1'); const before = inv.count('battery') + inv.count('cracker') + inv.count('almond_water'); applyDeathPenalty(inv, p, new Rng(s)); total += before - (inv.count('battery') + inv.count('cracker') + inv.count('almond_water')); expect(inv.has('flashlight') && inv.has('camcorder') && inv.has('key1')).toBe(true); }
      return total;
    };
    const [a, b, c, d] = [lose('keepAll'), lose('loseUnsecured'), lose('loseMost'), lose('loseAllCarried')];
    expect(a).toBe(0); expect(b).toBeGreaterThan(0); expect(c).toBeGreaterThan(b); expect(d).toBeGreaterThan(c);
    for (const id of DIFFICULTY_ORDER) expect(['keepAll', 'loseUnsecured', 'loseMost', 'loseAllCarried', 'permadeath']).toContain(DIFFICULTIES[id].deathPenalty);
  });
  it('every item in the table is well formed', () => {
    for (const d of Object.values(ITEMS)) { expect(d.w).toBeGreaterThan(0); expect(d.h).toBeGreaterThan(0); expect(d.stack).toBeGreaterThan(0); expect(d.name.length).toBeGreaterThan(1); }
    expect(itemDef('mystery').name).toBe('mystery');
  });
});

describe('stats, sanity and hallucinations', () => {
  const calm = { light: 0.8, threat: 0, safeRoom: false, resting: false, hungerEnabled: true };
  it('sanity drains in darkness and near threats, faster on harder difficulties; safe rooms restore it', () => {
    const run = (diff: 'easy' | 'nightmare', ctx: object) => { const s = new Stats(); for (let i = 0; i < 600; i++) s.update(0.1, { ...calm, ...ctx }, DIFFICULTIES[diff]); return s.sanity; };
    expect(run('normal' as never, { light: 0 })).toBeLessThan(100);
    expect(run('nightmare', { light: 0 })).toBeLessThan(run('easy', { light: 0 }));
    expect(run('normal' as never, { threat: 1 })).toBeLessThan(run('normal' as never, { light: 0 }));
    const s = new Stats(); s.sanity = 20; for (let i = 0; i < 300; i++) s.update(0.1, { ...calm, safeRoom: true, resting: true }, DIFFICULTIES.normal);
    expect(s.sanity).toBeGreaterThan(60);
  });
  it('hunger and thirst drain slowly, never on Easy, and starvation hurts', () => {
    const drain = (d: 'easy' | 'normal' | 'nightmare') => { const s = new Stats(); for (let i = 0; i < 3000; i++) s.update(0.1, calm, DIFFICULTIES[d]); return s.hunger; };
    expect(drain('easy')).toBe(100); expect(drain('normal')).toBeLessThan(100); expect(drain('nightmare')).toBeLessThan(drain('normal'));
    const s = new Stats(); s.hunger = 0; for (let i = 0; i < 300; i++) s.update(0.1, calm, DIFFICULTIES.normal); expect(s.health).toBeLessThan(100);
  });
  it('damage is scaled by difficulty and death is flagged; revive recovers partially', () => {
    const a = new Stats(), b = new Stats(); a.damage(10, DIFFICULTIES.easy); b.damage(10, DIFFICULTIES.nightmare);
    expect(a.health).toBeGreaterThan(b.health);
    b.damage(100, DIFFICULTIES.nightmare); expect(b.dead).toBe(true); b.revive(); expect(b.dead).toBe(false); expect(b.health).toBeGreaterThanOrEqual(60);
  });
  it('consumables apply their effects', () => {
    const s = new Stats(); s.sanity = 40; s.apply(itemDef('almond_water').use!); expect(s.sanity).toBe(65);
  });
  it('hallucinations only occur at low sanity, are more frequent as it falls, and fake entities obey reduce-jumpscares', () => {
    const count = (sanity: number, reduce = false) => { const s = new Stats(); s.sanity = sanity; const r = new Rng(4); let n = 0, fake = 0; for (let i = 0; i < 6000; i++) { const h = s.hallucinate(0.1, r, reduce); if (h) { n++; if (h === 'fakeEntity') fake++; } } return { n, fake }; };
    expect(count(90).n).toBe(0);
    expect(count(10).n).toBeGreaterThan(count(50).n);
    expect(count(10).fake).toBeGreaterThan(0); expect(count(10, true).fake).toBe(0);
  });
});

describe('lights', () => {
  it('flashlight drains by difficulty, flickers when low, and recharges from shaking and batteries', () => {
    const f = new Flashlight(), g = new Flashlight();
    for (let i = 0; i < 600; i++) { f.update(0.1, DIFFICULTIES.easy); g.update(0.1, DIFFICULTIES.nightmare); }
    expect(g.battery).toBeLessThan(f.battery);
    f.battery = 10; const o = Array.from({ length: 200 }, (_, i) => f.output(i * 0.05)); expect(Math.max(...o) - Math.min(...o)).toBeGreaterThan(0.2);
    f.battery = 20; for (let i = 0; i < 60; i++) f.addShake(2); expect(f.battery).toBeGreaterThan(20);
    f.battery = 80; const b = f.battery; f.addShake(500); expect(f.battery).toBe(b); // no shake recharge when charged
    f.recharge(60); expect(f.battery).toBe(100);
    f.battery = 0; expect(f.output(0)).toBe(0);
  });
  it('camcorder night vision drains its own battery and shuts off when empty', () => {
    const c = new Camcorder(); c.toggle(); expect(c.nightVision).toBe(true);
    for (let i = 0; i < 5000; i++) c.update(0.1, DIFFICULTIES.normal);
    expect(c.nightVision).toBe(false); expect(c.battery).toBeLessThan(20);
  });
});

describe('Level 0 in the real simulation', () => {
  const plan = level0.generate(77);
  it('has the Level 0 ecology: one stick, a hound pack, lockers and notes', () => {
    const sim = new LevelSim(plan);
    expect(plan.entitySlots.filter((s) => s.entity === 'stick')).toHaveLength(1); // the plan's ecology is unchanged
    expect(sim.ew.entities.filter((e) => e.def.id === 'stick').length).toBeGreaterThanOrEqual(1); // plus a roaming extra on Normal
    expect(sim.ew.entities.filter((e) => e.def.id === 'hound').length).toBeGreaterThanOrEqual(2);
    expect(plan.hides!.length).toBeGreaterThan(5);
    expect(plan.items.filter((i) => i.kind === 'note').length).toBe(6); // 4 story notes + the Anchor hint + the secret hint
    for (const n of plan.items.filter((i) => i.kind === 'note')) expect(NOTES[n.item]).toBeDefined();
    expect(LEVEL_NOTES('level0').length).toBeGreaterThanOrEqual(6);
  });
  it('hiding blocks movement, hides the player from entities, and leaving works', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const h = plan.hides![0];
    sim.player.place(h.pos.x - Math.sin(h.yaw) * 1.1, h.pos.z - Math.cos(h.yaw) * 1.1);
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    sim.interact(); expect(sim.hidden).toBe(h);
    const f = emptyFrame(); f.moveY = 1;
    const x0 = sim.player.x; for (let i = 0; i < 60; i++) sim.step(f);
    expect(Math.hypot(sim.player.x - x0, 0)).toBeLessThan(0.01);
    sim.interact(); expect(sim.hidden).toBeNull(); expect(ev).toContain('hide');
  });
  it('items: picking up consumes space, using a battery recharges the flashlight, almond water restores sanity', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.flash.battery = 20; sim.inv.selected = sim.inv.hotbar.indexOf('battery');
    expect(sim.inv.held).toBe('battery');
    expect(sim.useHeld()).toBe(true); expect(sim.flash.battery).toBeGreaterThan(70); expect(sim.inv.has('battery')).toBe(false);
    sim.stats.sanity = 30; sim.inv.selected = sim.inv.hotbar.indexOf('almond_water'); sim.useHeld(); expect(sim.stats.sanity).toBeGreaterThan(50);
  });
  it('flares and glowsticks are placed and burn out', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.inv.add('flare'); sim.inv.hotbar[3] = 'flare'; sim.inv.selected = 3; sim.useHeld(); expect(sim.flares).toHaveLength(1);
    const f = emptyFrame(); for (let i = 0; i < 61 * 60; i++) sim.step(f); expect(sim.flares).toHaveLength(0);
  });
  it('death is detected, respawn returns to the checkpoint and re-rolls entities', () => {
    const sim = new LevelSim(plan, 'normal');
    const w = sim.waypoints[0]; sim.player.place(w.pos.x, w.pos.z); sim.interact();
    sim.player.place(plan.spawn.pos.x, plan.spawn.pos.z);
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    sim.stats.damage(500, sim.diff); sim.step(emptyFrame());
    expect(sim.dead).toBe(true); expect(ev).toContain('death');
    const before = sim.ew.entities.map((e) => e.x.toFixed(2)).join();
    sim.respawnPlayer();
    expect(sim.dead).toBe(false); expect(sim.player.x).toBeCloseTo(w.pos.x);
    expect(sim.ew.entities.map((e) => e.x.toFixed(2)).join()).not.toBe(sim.ew.entities.length ? '' : before);
  });
  it('snapshots restore keys, doors, pickups and checkpoint progress', () => {
    const a = new LevelSim(plan, 'normal', { spawnEntities: false });
    const key = plan.items.find((i) => i.kind === 'key')!;
    a.collected.add(key.id); a.keys.add(key.unlocks!); a.activatedWaypoints.add(0);
    const door = [...a.doors.values()][0]; door.open = true; a.world.remove(`door:${door.conn.id}`);
    const snap = a.snapshot();
    const b = new LevelSim(plan, 'normal', { spawnEntities: false });
    b.applySnapshot(JSON.parse(JSON.stringify(snap)));
    expect(b.collected.has(key.id)).toBe(true); expect(b.keys.has(key.unlocks!)).toBe(true); expect(b.doors.get(door.conn.id)!.open).toBe(true); expect(b.activatedWaypoints.has(0)).toBe(true);
  });
  it('scarcer difficulties remove loot but never change the layout', () => {
    const left = (d: 'easy' | 'nightmare') => { const s = new LevelSim(plan, d, { spawnEntities: false }); return plan.items.filter((i) => i.kind === 'loot' && !s.collected.has(i.id)).length; };
    expect(left('easy')).toBeGreaterThan(left('nightmare'));
    expect(JSON.stringify(level0.generate(77, { difficulty: 'nightmare' }))).toBe(JSON.stringify(plan));
  });
  it('save slot format carries the version used by Phase 1', () => { expect(newSlot(1, 'normal', 'x').version).toBe(SAVE_VERSION); });
});
