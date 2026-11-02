/**
 * Entity Lab (spec 0.3 #5): a flat sandbox plan + headless harness for scripted AI scenarios
 * (player noise, light on/off, hiding, flares). Used by tests and by the dev level `entitylab`.
 */
import { StaticWorld } from '../core/collision';
import { DIFFICULTIES, type DifficultyId } from '../core/difficulty';
import { Rng } from '../gen/rng';
import { NoiseField } from '../systems/noise';
import { Director } from '../systems/director';
import { EntityWorld, type AiContext, type EntityEvent, type PlayerPercept } from './ai';
import type { LevelPlan } from '../gen/types';

export function flatPlan(w = 40, d = 30): LevelPlan {
  const room = { id: 0, x: 0, z: 0, w, d, kind: 'start' as const, height: 3, variant: 0 };
  const c = { x: w / 2, z: d / 2 };
  return {
    levelId: 'entitylab', seed: 1, tier: 'chill', bounds: { x0: 0, z0: 0, x1: w, z1: d }, rooms: [room], connections: [],
    spawn: { room: 0, pos: c }, exit: { room: 0, pos: c }, criticalPath: [0], waypoints: [], items: [], hides: [], entitySlots: [],
    nav: { nodes: [{ id: 0, pos: c, room: 0, kind: 'room' }], edges: [] }, estSeconds: 10, size: 0.1,
  };
}

export interface Lab {
  plan: LevelPlan; world: StaticWorld; ew: EntityWorld; noise: NoiseField; director: Director;
  player: PlayerPercept; events: EntityEvent[]; time: number;
  ctx: AiContext;
  run(seconds: number, each?: (t: number) => void): void;
}

export function makeLab(o: { w?: number; d?: number; difficulty?: DifficultyId; intensity?: number; seed?: number; allowHunt?: boolean; mode?: 'active' | 'observe' } = {}): Lab {
  const plan = flatPlan(o.w, o.d);
  const world = new StaticWorld();
  const { w, d } = { w: plan.rooms[0].w, d: plan.rooms[0].d };
  world.add('walls', [{ x0: -1, x1: 0, z0: -1, z1: d + 1 }, { x0: w, x1: w + 1, z0: -1, z1: d + 1 }, { x0: -1, x1: w + 1, z0: -1, z1: 0 }, { x0: -1, x1: w + 1, z0: d, z1: d + 1 }]);
  const diff = DIFFICULTIES[o.difficulty ?? 'normal'];
  const director = new Director(diff, o.intensity ?? 0.5, new Rng(o.seed ?? 5));
  if (o.allowHunt !== false) { director.phase = 'build'; }
  const noise = new NoiseField(plan);
  const ew = new EntityWorld(plan, world, o.seed ?? 5);
  const events: EntityEvent[] = [];
  ew.listeners.push((e) => events.push(e));
  const player: PlayerPercept = { x: 5, z: d / 2, yaw: 0, hidden: false, crouching: false, noise: 0, light: 0.8, flashOn: false, flashPower: 0, flares: [] };
  const ctx: AiContext = { player, noise, openLocks: new Set(), diff, director, mode: o.mode ?? 'active' };
  const lab: Lab = {
    plan, world, ew, noise, director, player, events, time: 0, ctx,
    run(seconds, each) {
      const dt = 1 / 60;
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        lab.time += dt;
        if (o.allowHunt !== false) director.phase = director.phase === 'quiet' || director.phase === 'release' ? 'build' : director.phase; // keep the gate open for AI tests
        noise.update(dt);
        each?.(lab.time);
        ew.update(dt, ctx);
      }
    },
  };
  return lab;
}
