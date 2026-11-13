import { describe, expect, it } from 'vitest';
import { Inventory } from '../src/systems/inventory';
import { LevelSim } from '../src/levels/sim';
import { level0 } from '../src/levels/level0';
import { emptyFrame } from '../src/core/input/logic';
import { guidePoint, levelObjective } from '../src/levels/objective';
import { defaultSettings, sanitizeSettings } from '../src/core/settings';

describe('hotbar and held items', () => {
  it('switching slots changes the held item (1-4, next / previous)', () => {
    const sim = new LevelSim(level0.generate(77), 'normal', { spawnEntities: false });
    const f = emptyFrame();
    expect(sim.inv.held).toBe('flashlight');
    f.pressed.Slot2 = true; sim.step(f); f.pressed.Slot2 = false;
    expect(sim.inv.held).toBe('camcorder');
    f.pressed.NextItem = true; sim.step(f); f.pressed.NextItem = false;
    expect(sim.inv.held).toBe('battery');
    f.pressed.PrevItem = true; sim.step(f); sim.step(f);
    expect(sim.inv.held).toBe('flashlight');
  });

  it('the use key toggles the flashlight and night vision when they are held', () => {
    const sim = new LevelSim(level0.generate(77), 'normal', { spawnEntities: false });
    const on = sim.flash.on;
    expect(sim.useSelected()).toBe(true); expect(sim.flash.on).toBe(!on);
    sim.inv.selected = 1;
    sim.useSelected(); expect(sim.cam.nightVision).toBe(true);
  });

  it('using the last of an item frees its hotbar slot; assigning never duplicates', () => {
    const inv = Inventory.starter();
    const bi = inv.hotbar.indexOf('battery');
    inv.remove('battery', 1);
    expect(inv.hotbar[bi]).toBeNull();
    inv.assign(0, 'almond_water');
    expect(inv.hotbar.filter((x) => x === 'almond_water')).toHaveLength(1);
    expect(inv.hotbar[0]).toBe('almond_water');
    expect(inv.hotbar).toContain('flashlight'); // swapped, not lost
  });

  it('using an item from the backpack leaves the hotbar alone', () => {
    const sim = new LevelSim(level0.generate(77), 'normal', { spawnEntities: false });
    sim.inv.add('bandage'); sim.stats.health = 40;
    const before = [...sim.inv.hotbar];
    expect(sim.useHeld('bandage')).toBe(true);
    expect(sim.stats.health).toBeGreaterThan(40);
    expect(sim.inv.hotbar.filter(Boolean)).toEqual(before.filter((x) => x && x !== 'bandage'));
  });

  it('a battery on a full flashlight explains why nothing happened', () => {
    const sim = new LevelSim(level0.generate(77), 'normal', { spawnEntities: false });
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    sim.flash.battery = 100;
    expect(sim.useHeld('battery')).toBe(false);
    expect(ev).toContain('nouse');
  });
});

describe('Level 0 guidance', () => {
  it('the guide points at a doorway (or the goal itself), never through a locked door', () => {
    for (const seed of [1, 7, 77, 123, 999]) {
      const sim = new LevelSim(level0.generate(seed), 'normal', { spawnEntities: false });
      const o = levelObjective(sim);
      expect(o.target).not.toBeNull();
      const g = guidePoint(sim, o.target!);
      const isDoor = sim.plan.connections.some((c) => c.door.x === g.x && c.door.z === g.z && (!c.lock || sim.doors.get(c.id)?.open));
      expect(isDoor || (g.x === o.target!.x && g.z === o.target!.z)).toBe(true);
    }
  });

  it('defaults to the arrow and survives a settings round-trip', () => {
    expect(defaultSettings().guidance).toBe('arrow');
    expect(sanitizeSettings({ guidance: 'off' }).guidance).toBe('off');
    expect(sanitizeSettings({ guidance: 'bogus' }).guidance).toBe('arrow');
  });
});
