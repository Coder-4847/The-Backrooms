import { describe, expect, it } from 'vitest';
import { levelById } from '../src/levels/registry';
import { indexChunks, levelLights, meshChunk, CEIL_GRID } from '../src/gen/mesher';
import { bakeLighting } from '../src/render/bake';
import { synthTexture } from '../src/gen/textures';
import { buildBody } from '../src/entities/body';
import type { Mesh } from 'three';
import { planClues } from '../src/gen/clues';
import { LEVELS } from '../src/levels/registry';
import { bearingWords, levelObjective, routeToExit } from '../src/levels/objective';
import { LevelSim } from '../src/levels/sim';
import { verbFor } from '../src/ui/ui';

const plan = levelById('level0')!.generate(42, { difficulty: 'normal' });

describe('light baking', () => {
  it('levelLights matches what the chunk mesher emits', () => {
    const fromChunks = [...indexChunks(plan).values()].flatMap((c) => meshChunk(plan, c.cx, c.cz, { level: 2 }).lights);
    expect(JSON.stringify(levelLights(plan))).toBe(JSON.stringify(fromChunks));
  });
  it('lamps sit on the suspended-ceiling grid', () => {
    for (const l of levelLights(plan)) {
      expect(Math.abs(l.x / CEIL_GRID - Math.round(l.x / CEIL_GRID)) < 1e-6 || l.x === plan.rooms[l.room].x + 0.9 || l.x === plan.rooms[l.room].x + plan.rooms[l.room].w - 0.9).toBe(true);
    }
  });
  it('lit rooms get direct light under their lamps, broken lamps add nothing', () => {
    const lamps = levelLights(plan);
    const b = bakeLighting(plan, lamps);
    const at = (x: number, z: number) => { const i = Math.floor((x - b.originX) / b.texel), j = Math.floor((z - b.originZ) / b.texel); return b.light[(j * b.nx + i) * 4]; };
    const lit = lamps.find((l) => !l.broken)!;
    expect(at(lit.x, lit.z)).toBeGreaterThan(0.3);
    const dark = bakeLighting(plan, lamps.map((l) => ({ ...l, broken: true })));
    let mx = 0; for (let i = 0; i < dark.light.length; i += 4) mx = Math.max(mx, dark.light[i]);
    expect(mx).toBe(0);
    // geometry map: distances to walls are non-negative and inside rooms
    expect(b.geo.reduce((m, v) => Math.min(m, v), Infinity)).toBeGreaterThanOrEqual(0);
  });
});

describe('visual assets', () => {
  it('macro and louver maps synthesize deterministically', () => {
    for (const k of ['macro', 'louver'] as const) expect(synthTexture(k, 3, 32).albedo).toEqual(synthTexture(k, 3, 32).albedo);
  });
  it('every entity body builds, animates and stays within its triangle budget per tier', () => {
    for (const id of ['stick', 'hound', 'howler', 'coworker', 'concierge', 'companion', 'leviathan', 'leech', 'smiler', 'drowned', 'curator', 'static']) {
      for (const lvl of [0, 4]) {
        const b = buildBody(id, lvl);
        let tris = 0;
        b.group.traverse((o) => { const m = o as Mesh; if (m.isMesh) { const g = m.geometry; tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
        b.update(1.2, 0.5, 1 / 60, false, false); b.update(2, 1, 1 / 60, true, true);
        expect(tris).toBeGreaterThan(100);
        expect(tris).toBeLessThan(lvl === 0 ? 2500 : 25000);
        b.dispose();
      }
    }
  });
});

describe('clue notes', () => {
  it('every playable level gets a few deterministic clues, placed inside their rooms', () => {
    for (const def of LEVELS.filter((l) => !l.dev)) {
      const p = def.generate(7, { difficulty: 'normal' });
      const a = planClues(p), b = planClues(def.generate(7, { difficulty: 'normal' }));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      if (p.finale) continue;
      expect(a.length, def.id).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(8);
      for (const c of a) {
        const r = p.rooms[c.room];
        expect(c.x >= r.x - 0.01 && c.x <= r.x + r.w + 0.01 && c.z >= r.z - 0.01 && c.z <= r.z + r.d + 0.01, `${def.id} ${c.id}`).toBe(true);
        expect(c.text.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('objectives and touch verbs', () => {
  it('every level has a route to the exit and a sensible first objective', () => {
    for (const def of LEVELS.filter((l) => !l.dev)) {
      const p = def.generate(11, { difficulty: 'normal' });
      if (p.finale) continue;
      const sim = new LevelSim(p, 'normal', { seed: 11 });
      const o = levelObjective(sim);
      expect(routeToExit(p, p.spawn.room), def.id).not.toBeNull();
      expect(o.text.length, def.id).toBeGreaterThan(5);
      expect(o.target, def.id).not.toBeNull();
    }
  });
  it('names the missing tool for the first locked door on the way', () => {
    const p = levelById('level2')!.generate(5, { difficulty: 'normal' });
    const sim = new LevelSim(p, 'normal', { seed: 5 });
    const locked = p.connections.some((c) => c.lock);
    const o = levelObjective(sim);
    if (locked) expect(/find|align|reboot|flip|key|open/i.test(o.text)).toBe(true);
  });
  it('bearing words are relative to where you look', () => {
    expect(bearingWords(0, 0, 0, { x: 0, z: -10 })).toBe('straight ahead');   // yaw 0 looks toward -z
    expect(bearingWords(0, 0, 0, { x: 10, z: 0 })).toBe('to your right');
    expect(bearingWords(0, 0, 0, { x: -10, z: 0 })).toBe('to your left');
    expect(bearingWords(0, 0, 0, { x: 0, z: 10 })).toBe('behind you');
  });
  it('touch verbs for every interaction label', () => {
    for (const [l, v] of [['Talk to coworker', 'Talk'], ['Read note', 'Read'], ['Take Key', 'Take'], ['Hide in locker', 'Hide'], ['Leave hiding spot', 'Come out'], ['Unlock door', 'Unlock'], ['Activate checkpoint', 'Activate'], ['Leave', 'Leave'], ['Read the scrap of paper', 'Read'], ['Continue Campaign: Level 0: The Lobby', 'Open'], ['Notice board', 'Look'], ['Sealed door', 'Try'], ['Locked', 'Try'], ['Turn valve A (0)', 'Use']] as const) expect(verbFor(l)).toBe(v);
  });
});
