import { describe, expect, it } from 'vitest';
import { levelById, CAMPAIGN } from '../src/levels/registry';
import { LevelSim } from '../src/levels/sim';
import { simulateReach } from '../src/gen/validate';
import { emptyFrame } from '../src/core/input/logic';
import { ACHIEVEMENTS, checkAchievements, unlocksFor } from '../src/story/achievements';
import { newProfile, newSlot, SaveManager } from '../src/core/save';
import { MemoryKV } from '../src/core/storage';
import { resolveEnding, BASE_STATE, ENDING_TEXT, type EndingId } from '../src/story/endings';
import { DIFFICULTIES } from '../src/core/difficulty';
import { lensById } from '../src/ui/panels2';
import { NOTES } from '../src/story/notes';
import { itemDef } from '../src/systems/items';

const ANCHOR_LEVELS: [string, number][] = [['level0', 1], ['level2', 2], ['level37', 3], ['level94', 4], ['wheatfield', 5]];

describe('Anchors (true ending) and the secret', () => {
  it('five Anchors, one per level across Acts 1-3, off the critical path, reachable, with a hint note near the start', () => {
    expect(new Set(ANCHOR_LEVELS.map(([, n]) => n)).size).toBe(5);
    for (const [id, n] of ANCHOR_LEVELS) for (let s = 0; s < 25; s++) {
      const p = levelById(id)!.generate(s * 311 + 4);
      const a = p.items.find((i) => i.item === `anchor${n}`)!;
      expect(a, `${id} ${s}`).toBeDefined();
      expect(p.criticalPath.includes(a.room), `${id}: anchor on the path`).toBe(false);
      expect(simulateReach(p).rooms.has(a.room), `${id}: anchor unreachable`).toBe(true);
      const hint = p.items.find((i) => i.item === `anchor_hint${n}`)!;
      expect(hint.room).toBe(p.spawn.room); expect(NOTES[`anchor_hint${n}`]).toBeDefined();
    }
    for (let n = 1; n <= 5; n++) { expect(itemDef(`anchor${n}`).essential).toBe(true); expect(itemDef(`anchor${n}`).name).toContain('Anchor'); }
    expect(CAMPAIGN.find((c) => c.id === 'level37')!.act).toBe(2); expect(CAMPAIGN.find((c) => c.id === 'wheatfield')!.act).toBe(3);
  });
  it('the Level 0 secret needs 20 s of crouching, lights off, holding breath, still, in the first room', () => {
    const plan = levelById('level0')!.generate(12);
    const run = (secs: number, o: { flash?: boolean; move?: boolean; room?: boolean } = {}) => {
      const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
      const fired: string[] = []; sim.listeners.push((e) => fired.push(e.type));
      if (o.room === false) { const r = plan.rooms.find((q) => q.id !== plan.spawn.room && q.w > 6)!; sim.player.place(r.x + r.w / 2, r.z + r.d / 2); }
      sim.flash.on = !!o.flash;
      const f = emptyFrame(); f.down.Crouch = true; f.down.HoldBreath = true; if (o.move) f.moveY = 1;
      for (let i = 0; i < 60 * secs; i++) { if (o.move) sim.player.yaw += 0.02; sim.step(f); }
      return fired.includes('secret');
    };
    expect(run(22)).toBe(true);
    expect(run(15)).toBe(false);
    expect(run(25, { flash: true })).toBe(false);
    expect(run(25, { move: true })).toBe(false);
    expect(run(25, { room: false })).toBe(false);
    expect(levelById('level0')!.generate(12).items.some((i) => i.item === 'l0_secret')).toBe(true); // an in-world, non-menu hint
  });
  it('the secret does not exist in other levels', () => {
    const sim = new LevelSim(levelById('level1')!.generate(3), 'normal', { spawnEntities: false });
    const f = emptyFrame(); f.down.Crouch = true; f.down.HoldBreath = true;
    for (let i = 0; i < 60 * 25; i++) sim.step(f);
    expect(sim.x.secretDone).toBe(false);
  });
});

describe('endings, unlocks and achievements', () => {
  it('all six endings are reachable and have text; precedence is stable', () => {
    const R = (p: object) => resolveEnding({ ...BASE_STATE, ...p });
    const got = new Set<EndingId>([R({}), R({ acceptedArchitect: true }), R({ companionAlive: true, chosenStay: true }), R({ refusedExit: true }), R({ anchorsFound: 5, trueDecision: true }), R({ secretSequence: true })]);
    expect(got.size).toBe(6); for (const id of got) expect(ENDING_TEXT[id].text.length).toBeGreaterThan(40);
    expect(R({ secretSequence: true, anchorsFound: 5, trueDecision: true, acceptedArchitect: true })).toBe('secret');
    expect(R({ sanity: 0 })).toBe('join'); expect(R({ sanity: 10 })).toBe('loop'); expect(R({ anchorsFound: 4, trueDecision: true })).toBe('escape');
  });
  it('unlocks: any ending gives the amber lens + Survivor; hard runs give gold + Unbroken; the sixth ending gives mono + Completionist', () => {
    const p = newProfile();
    expect(unlocksFor('escape', 'normal', p)).toEqual({ cosmetics: ['lens:amber'], titles: ['Survivor'] });
    expect(unlocksFor('escape', 'hardcore', p).cosmetics).toContain('lens:gold'); expect(unlocksFor('escape', 'nightmare', p).titles).toContain('Unbroken');
    p.endings = ['escape', 'join', 'sacrifice', 'loop', 'true'];
    const last = unlocksFor('secret', 'normal', p); expect(last.cosmetics).toContain('lens:mono'); expect(last.titles).toContain('Completionist');
    expect(unlocksFor('true', 'normal', newProfile()).titles).toContain('Anchor');
  });
  it('achievements unlock once, from the right conditions', () => {
    const p = newProfile(); const s = newSlot(1, 'normal', 'A');
    expect(checkAchievements(p, s)).toEqual([]);
    s.completed.level0 = { bestTime: 100, difficulty: 'normal' };
    expect(checkAchievements(p, s).map((a) => a.id)).toEqual(['first_noclip']); expect(checkAchievements(p, s)).toEqual([]);
    s.flags.anchors = 5; s.flags.secret = true; p.endings = ['escape', 'join', 'sacrifice', 'loop', 'true', 'secret']; p.completedOn.finale = ['nightmare']; p.counters = { crafted: 5 };
    const ids = checkAchievements(p, s).map((a) => a.id);
    for (const id of ['anchors', 'secret', 'all_endings', 'any_ending', 'nightmare', 'crafter']) expect(ids).toContain(id);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
  it('New Game+ makes entities sharper and faster', () => {
    const plan = levelById('level1')!.generate(3);
    const a = new LevelSim(plan, 'normal', { spawnEntities: false }), b = new LevelSim(plan, 'normal', { spawnEntities: false, ngPlus: true });
    expect(b.diff.entitySpeed).toBeGreaterThan(a.diff.entitySpeed); expect(b.diff.entityPerception).toBeGreaterThan(a.diff.entityPerception);
    expect(DIFFICULTIES.normal.entitySpeed).toBe(1.1); // the table itself is never mutated
  });
  it('lenses fall back to standard; old profiles without counters still load', async () => {
    expect(lensById('gold').sat).toBeGreaterThan(1); expect(lensById('nonsense').id).toBe('standard'); expect(lensById('mono').sat).toBe(0);
    const kv = new MemoryKV(); const sm = new SaveManager(kv);
    const old = newProfile() as unknown as Record<string, unknown>; delete old.counters;
    await kv.set('profile', JSON.stringify(old));
    const back = await sm.loadProfile(); expect(back.endings).toEqual([]); expect(back.counters ?? {}).toEqual({});
  });
});
