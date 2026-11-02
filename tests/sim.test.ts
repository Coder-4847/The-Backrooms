import { describe, expect, it } from 'vitest';
import { LEVELS, levelById } from '../src/levels/registry';
import { runBot } from '../src/levels/bot';
import { LevelSim } from '../src/levels/sim';
import { emptyFrame } from '../src/core/input/logic';
import { Loop, STEP } from '../src/core/loop';

describe('autopilot bot through the real simulation', () => {
  for (const def of LEVELS) {
    it(`${def.id}: completes 12 seeds, visiting waypoints`, () => {
      const fails: string[] = [];
      for (let i = 0; i < 12; i++) {
        const plan = def.generate(900 + i * 211);
        const r = runBot(plan, { visitWaypoints: true });
        if (!r.completed) fails.push(`${900 + i * 211}:${r.reason}`);
        else expect(r.seconds).toBeLessThan(plan.estSeconds * 3.5 + 60);
      }
      expect(fails).toEqual([]);
    }, 60000);
  }
  it('bot completes on every difficulty (layout is identical, waypoints differ)', () => {
    const plan = levelById('placeholder')!.generate(31);
    for (const d of ['easy', 'normal', 'hard', 'nightmare', 'hardcore'] as const) expect(runBot(plan, { difficulty: d, visitWaypoints: true }).completed).toBe(true);
  });
});

describe('level simulation rules', () => {
  const plan = levelById('placeholder')!.generate(123);
  it('locked doors block until the right key is held, then open', () => {
    const sim = new LevelSim(plan);
    const door = [...sim.doors.values()][0];
    const before = sim.world.count;
    sim.player.place(door.conn.door.x - (door.conn.axis === 'z' ? 1.0 : 0), door.conn.door.z - (door.conn.axis === 'x' ? 1.0 : 0));
    const events: string[] = []; sim.listeners.push((e) => events.push(e.type));
    sim.interact();
    expect(events).toContain('locked'); expect(door.open).toBe(false);
    sim.keys.add(door.conn.lock!);
    sim.interact();
    expect(door.open).toBe(true); expect(sim.world.count).toBeLessThan(before);
  });
  it('activating a waypoint sets the respawn point; respawn returns there', () => {
    const sim = new LevelSim(plan, 'normal');
    expect(sim.waypoints.length).toBeGreaterThanOrEqual(2);
    const w = sim.waypoints[0];
    sim.player.place(w.pos.x, w.pos.z);
    sim.interact();
    expect(sim.activatedWaypoints.has(0)).toBe(true);
    sim.player.place(plan.spawn.pos.x, plan.spawn.pos.z);
    sim.respawnPlayer();
    expect(sim.player.x).toBeCloseTo(w.pos.x);
  });
  it('hardcore has no waypoints to activate', () => { expect(new LevelSim(plan, 'hardcore').waypoints).toHaveLength(0); });
  it('walking into a wall never leaves the level bounds', () => {
    const sim = new LevelSim(plan);
    const f = emptyFrame(); f.moveY = 1;
    for (let i = 0; i < 60 * 120; i++) { sim.player.yaw += 0.003; sim.step(f); }
    expect(sim.player.x).toBeGreaterThan(plan.bounds.x0 - 0.1); expect(sim.player.x).toBeLessThan(plan.bounds.x1 + 0.1);
    expect(sim.player.z).toBeGreaterThan(plan.bounds.z0 - 0.1); expect(sim.player.z).toBeLessThan(plan.bounds.z1 + 0.1);
  });
  it('stamina drains while sprinting and recovers; crouch is slower than walk', () => {
    const sim = new LevelSim(plan);
    const f = emptyFrame(); f.moveY = 1; f.down.Sprint = true;
    Loop.simulate((dt) => { sim.player.yaw += 0.01; sim.step(f, dt); }, 4);
    expect(sim.player.stamina).toBeLessThan(80);
    const f2 = emptyFrame(); Loop.simulate((dt) => sim.step(f2, dt), 12);
    expect(sim.player.stamina).toBeGreaterThan(95);
    const walk = new LevelSim(plan), crouch = new LevelSim(plan);
    const fw = emptyFrame(); fw.moveY = 1; const fc = emptyFrame(); fc.moveY = 1; fc.down.Crouch = true;
    Loop.simulate((dt) => walk.step(fw, dt), 1); Loop.simulate((dt) => crouch.step(fc, dt), 1);
    expect(crouch.player.speed).toBeLessThan(walk.player.speed);
  });
  it('fixed timestep helper steps exactly', () => {
    let n = 0; Loop.simulate(() => n++, 2); expect(n).toBe(Math.round(2 / STEP));
  });
});
