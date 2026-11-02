import { describe, expect, it } from 'vitest';
import { generateHub, hubDef, TOTAL_DOORS, visibleDoors } from '../src/levels/hub';
import { validatePlan } from '../src/gen/validate';
import { CAMPAIGN, LEVELS, isImplemented } from '../src/levels/registry';
import { StaticWorld } from '../src/core/collision';
import { indexChunks, meshChunk } from '../src/gen/mesher';
import { LevelSim } from '../src/levels/sim';

describe('Central Hub', () => {
  it('lists all 25 levels in campaign order with unique ids, 3 acts', () => {
    expect(CAMPAIGN).toHaveLength(25);
    expect(new Set(CAMPAIGN.map((c) => c.id)).size).toBe(25);
    expect([1, 2, 3].map((a) => CAMPAIGN.filter((c) => c.act === a).length)).toEqual([7, 8, 10]);
    expect(CAMPAIGN[0].id).toBe('level0'); expect(CAMPAIGN[24].id).toBe('finale');
    expect(isImplemented('level0')).toBe(true); expect(isImplemented('level1')).toBe(true); expect(isImplemented('level6')).toBe(false);
    for (const l of LEVELS.filter((x) => !x.dev)) expect(CAMPAIGN.some((c) => c.id === l.id)).toBe(true);
  });
  it('is valid at every frontier: rooms do not overlap, connected, doors on walls, nav ok', () => {
    for (const f of [0, 1, 5, 12, 24]) for (const seed of [1, 2, 3]) {
      const plan = generateHub(seed, f);
      expect(validatePlan(hubDef, plan, { minWaypoints: 0 }), `frontier ${f} seed ${seed}`).toEqual([]);
    }
  });
  it('extends as the campaign progresses and shows every door up to the frontier + teasers', () => {
    const len = (f: number) => generateHub(1, f).rooms[0].w;
    expect(len(10)).toBeGreaterThan(len(0));
    expect(generateHub(1, 0).hub!.doors.length).toBe(visibleDoors(0));
    expect(generateHub(1, 40).hub!.doors.length).toBe(TOTAL_DOORS);
    expect(generateHub(1, 3).hub!.doors.map((d) => d.index)).toEqual([...Array(visibleDoors(3)).keys()]);
  });
  it('layout is fixed; only dressing may vary with the seed', () => {
    const a = generateHub(1, 4), b = generateHub(99, 4);
    expect(JSON.stringify(a.rooms)).toBe(JSON.stringify(b.rooms));
    expect(JSON.stringify(a.hub)).toBe(JSON.stringify(b.hub));
  });
  it('has the Almond Outpost wing stations and 3 survivors', () => {
    const h = generateHub(1, 0).hub!;
    expect(new Set(h.stations.map((s) => s.kind))).toEqual(new Set(['stash', 'crafting', 'noteboard', 'bestiary', 'gallery', 'kitchen', 'camcorder']));
    expect(h.npcs.map((n) => n.id).sort()).toEqual(['ines', 'marlow', 'tobias']);
  });
  it('the player can walk from the tunnel into every door alcove and the outpost (no blocked doorways)', () => {
    const plan = generateHub(3, 6);
    const w = new StaticWorld();
    for (const c of indexChunks(plan).values()) w.add(`c${c.cx},${c.cz}`, meshChunk(plan, c.cx, c.cz, { level: 0 }).colliders);
    for (const d of plan.hub!.doors) { expect(w.overlapsCircle(d.pos.x, d.pos.z, 0.4)).toBe(false); }
    for (const s of plan.hub!.stations) expect(w.overlapsCircle(s.pos.x + Math.sin(s.yaw) * 1.2 * -1, s.pos.z + Math.cos(s.yaw) * 1.2 * -1, 0.3), s.kind).toBe(false);
    for (const n of plan.hub!.npcs) expect(w.overlapsCircle(n.pos.x, n.pos.z, 0.4), n.id).toBe(false);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.alwaysSafe = true;
    expect(sim.safeRoom).toBe(true);
  });
});
