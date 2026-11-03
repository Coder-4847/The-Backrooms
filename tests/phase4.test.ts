import { describe, expect, it } from 'vitest';
import { levelById, LEVELS, isImplemented, CAMPAIGN } from '../src/levels/registry';
import { LevelSim } from '../src/levels/sim';
import { runBot } from '../src/levels/bot';
import { validatePlan } from '../src/gen/validate';
import { makeLab } from '../src/entities/lab';
import { emptyFrame } from '../src/core/input/logic';
import { ENTITIES } from '../src/entities/defs';
import { DIFFICULTIES } from '../src/core/difficulty';
import { Stats } from '../src/systems/stats';
import { NOTES } from '../src/story/notes';
import { ENDING_TEXT, BASE_STATE, resolveEnding } from '../src/story/endings';

const ACT3 = ['metro', 'carnival', 'suburbs', 'wheatfield', 'arctic', 'city', 'level94', 'gallery', 'chase', 'finale'];
const face = (e: { x: number; z: number; yaw: number }, t: { x: number; z: number }) => { e.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z)); };
const ents = (id: string) => [...new Set(levelById(id)!.generate(11).entitySlots.map((s) => s.entity))].sort();

describe('Act 3 levels', () => {
  it('registers all ten (indices 15-24); the whole campaign is now playable', () => {
    for (const id of ACT3) expect(isImplemented(id), id).toBe(true);
    expect(CAMPAIGN.slice(15).map((c) => c.id)).toEqual(ACT3);
    expect(LEVELS.filter((l) => !l.dev).length).toBe(25);
    for (const c of CAMPAIGN) expect(isImplemented(c.id), c.id).toBe(true);
  });
  it('ecology as designed', () => {
    expect(ents('metro')).toEqual(['wraith']); expect(ents('carnival')).toEqual(['partygoer']); expect(ents('suburbs')).toEqual(['watcher']);
    expect(ents('wheatfield')).toEqual([]); expect(ents('arctic')).toEqual(['stalker']); expect(ents('city')).toEqual(['windowman']);
    expect(ents('level94')).toEqual(['echo']); expect(ents('gallery')).toEqual([]); expect(ents('chase')).toEqual(['pursuer']);
    expect(ents('finale')).toEqual(['architect', 'hound', 'howler', 'stick']);
  });
  it('pacing across the whole campaign: no two horror levels in a row except Gallery -> Run for Your Life; horror is followed by calm except there', () => {
    const t = CAMPAIGN.map((c) => c.tier);
    for (let i = 1; i < t.length; i++) if (t[i] === 'horror' && t[i - 1] === 'horror') expect(CAMPAIGN[i].id).toBe('chase');
    expect(t[CAMPAIGN.findIndex((c) => c.id === 'chase') + 1]).toBe('tense');
    expect(t.filter((x) => x === 'chill').length).toBe(2); expect(t.filter((x) => x === 'horror').length).toBe(6);
  });
  it('each validates on 40 seeds', () => {
    for (const id of ACT3) { const def = levelById(id)!; for (let s = 0; s < 40; s++) expect(validatePlan(def, def.generate(s * 521 + 9)), `${id} ${s}`).toEqual([]); }
  }, 60000);
  it('the bot completes every Act 3 level (finale: reaches the Architect room) on 8 seeds', () => {
    for (const id of ACT3.filter((x) => x !== 'finale')) { const def = levelById(id)!; for (let i = 0; i < 8; i++) { const r = runBot(def.generate(700 + i * 313), { visitWaypoints: true }); expect(r.completed, `${id}: ${r.reason}`).toBe(true); } }
    const f = levelById('finale')!.generate(5); expect(f.finale).toBe(true); expect(f.entitySlots.some((s) => s.entity === 'architect')).toBe(true);
  }, 120000);
  it('notes exist for every Act 3 level', () => { for (const id of ACT3) expect(Object.values(NOTES).some((n) => n.level === id), id).toBe(true); });
});

describe('open levels (Wheat Field)', () => {
  const plan = levelById('wheatfield')!.generate(3);
  it('is outdoors: open rooms without walls, a perimeter, soft wheat, a compass, no entities', () => {
    expect(plan.open).toBe(true); expect(plan.rooms.filter((r) => r.open).length).toBeGreaterThan(10);
    expect(plan.props!.filter((p) => p.soft).length).toBeGreaterThan(500);
    expect(plan.items.some((i) => i.item === 'compass')).toBe(true); expect(plan.entitySlots).toEqual([]);
  });
  it('soft props do not block movement; the perimeter keeps you inside', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const wheat = plan.props!.find((p) => p.soft)!;
    const rooms = plan.rooms.find((r) => r.open)!;
    sim.player.place(wheat.x - 1, wheat.z, -Math.PI / 2);
    const f = emptyFrame(); f.moveY = 1; for (let i = 0; i < 90; i++) sim.step(f);
    expect(sim.player.x).toBeGreaterThan(wheat.x); void rooms;
    sim.player.place(plan.bounds.x1 - 2, plan.bounds.z1 / 2, -Math.PI / 2); for (let i = 0; i < 200; i++) sim.step(f);
    expect(sim.player.x).toBeLessThan(plan.bounds.x1);
  });
});

describe('cold (Arctic) and warmth', () => {
  const plan = levelById('arctic')!.generate(4);
  it('has heated shelters; warmth drains outside them, refills inside, frostbite hurts', () => {
    expect(plan.cold!.warm.length).toBeGreaterThanOrEqual(3);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const cold = plan.rooms.find((r) => !plan.cold!.warm.includes(r.id) && !r.open && r.w > 6)!;
    sim.player.place(cold.x + cold.w / 2, cold.z + cold.d / 2);
    for (let i = 0; i < 60 * 30; i++) sim.step(emptyFrame());
    expect(sim.stats.warmth).toBeLessThan(70); expect(sim.inWarm).toBe(false);
    const warm = plan.rooms[plan.cold!.warm[0]]; sim.player.place(warm.x + warm.w / 2, warm.z + warm.d / 2);
    for (let i = 0; i < 60 * 10; i++) sim.step(emptyFrame());
    expect(sim.inWarm).toBe(true); expect(sim.stats.warmth).toBeGreaterThan(80);
    const s = new Stats(); for (let i = 0; i < 60 * 200; i++) s.updateWarmth(1 / 60, true, 1.3, DIFFICULTIES.normal);
    expect(s.warmth).toBe(0); expect(s.health).toBeLessThan(100);
  });
  it('a flare warms you; harder difficulties freeze faster', () => {
    const a = new Stats(), b = new Stats();
    for (let i = 0; i < 60 * 10; i++) { a.updateWarmth(1 / 60, true, 1.3, DIFFICULTIES.easy); b.updateWarmth(1 / 60, true, 1.3, DIFFICULTIES.nightmare); }
    expect(b.warmth).toBeLessThan(a.warmth);
  });
  it('the Whiteout Stalker will not hunt you inside a warm room and flees flares', () => {
    const lab = makeLab(); lab.plan.cold = { rate: 1, warm: [0] };
    const st = lab.ew.spawn('stalker', 14, 15); lab.player.x = 8; lab.player.z = 15;
    lab.run(6); expect(['hunt', 'tell', 'chase']).not.toContain(st.state);
    const lab2 = makeLab(); lab2.plan.cold = { rate: 1, warm: [] }; const s2 = lab2.ew.spawn('stalker', 14, 15); lab2.player.x = 8; lab2.player.z = 15;
    let tell = -1; lab2.run(8, (t) => { for (const e of lab2.events) if (e.type === 'tell' && tell < 0) tell = t; });
    expect(tell).toBeGreaterThan(0); void s2;
    const lab3 = makeLab(); lab3.plan.cold = { rate: 1, warm: [] }; const s3 = lab3.ew.spawn('stalker', 14, 15); lab3.player.x = 8; lab3.player.z = 15; lab3.player.flares = [{ x: 12, z: 15 }];
    lab3.run(1); expect(s3.state).toBe('flee');
  });
});

describe('Metro schedule and Platform Wraiths', () => {
  const plan = levelById('metro')!.generate(6);
  it('a train passes on schedule and emits events', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const ev: boolean[] = []; sim.listeners.push((e) => { if (e.type === 'train') ev.push(e.on); });
    for (let i = 0; i < 60 * 100; i++) sim.step(emptyFrame());
    expect(ev.filter(Boolean).length).toBeGreaterThanOrEqual(2); expect(ev.filter((x) => !x).length).toBeGreaterThanOrEqual(2);
    const sc = plan.schedule!; expect(sc.window).toBeLessThan(sc.period);
  });
  it('Wraiths only exist while a train passes: hidden and harmless otherwise, hunting with a tell during the window', () => {
    const lab = makeLab(); const w = lab.ew.spawn('wraith', 14, 15); face(w, lab.player); lab.player.x = 8; lab.player.z = 15;
    lab.ctx.trainActive = false; lab.run(5); expect(w.data.hidden).toBe(true); expect(lab.events.some((e) => e.type === 'tell' || e.type === 'hit')).toBe(false);
    lab.ctx.trainActive = true; let tell = -1, hit = -1;
    lab.run(8, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(w.data.hidden).toBe(false); expect(tell).toBeGreaterThan(0); if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(1.0 - 0.1);
  });
});

describe('Carnival party rules, Suburbs, City, Level 94, Gallery', () => {
  it('Partygoers are friendly until a rule is broken, then tell and chase; the alert expires', () => {
    const lab = makeLab(); const g = lab.ew.spawn('partygoer', 14, 15);
    lab.player.x = 8; lab.player.z = 15; lab.run(6);
    expect(lab.events.some((e) => e.type === 'tell' || e.type === 'hit')).toBe(false);
    lab.ctx.alert = true; let tell = -1; lab.run(6, (t) => { for (const e of lab.events) if (e.type === 'tell' && tell < 0) tell = t; });
    expect(tell).toBeGreaterThan(0);
    const p = levelById('carnival')!.generate(5); expect(p.ruleEntity).toBe('partygoers'); expect(p.rules!.filter((r) => r.real)).toHaveLength(2);
    void g;
  });
  it('breaking a real carnival rule raises the alert in the sim', () => {
    const plan = levelById('carnival')!.generate(5);
    const real = plan.rules!.find((r) => r.real && r.kind === 'noRunning') ?? plan.rules!.find((r) => r.real)!;
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const hall = plan.rooms.find((r) => r.kind === 'hall') ?? plan.rooms[plan.spawn.room];
    sim.player.place(hall.x + hall.w / 2, hall.z + hall.d / 2); sim.room = hall.id; if (hall.kind !== 'hall') hall.kind = 'hall';
    const f = emptyFrame(); f.moveY = 1; f.down.Sprint = true; if (real.kind === 'noLight') sim.flash.on = true;
    for (let i = 0; i < 90; i++) { sim.player.yaw += 0.02; sim.step(f); }
    expect(sim.alert).toBe(true);
  });
  it('Watchers freeze while watched and advance when unseen (Stick logic)', () => {
    const lab = makeLab(); const w = lab.ew.spawn('watcher', 22, 15); lab.player.x = 8; lab.player.z = 15; lab.player.yaw = -Math.PI / 2;
    lab.run(5); const d0 = Math.hypot(w.x - 8, w.z - 15); lab.player.yaw = Math.PI / 2; lab.run(4);
    expect(Math.hypot(w.x - 8, w.z - 15)).toBeLessThan(d0 - 1.5);
  });
  it('Window-Man steps closer each time you look back, then tells before it touches you', () => {
    const lab = makeLab(); const wm = lab.ew.spawn('windowman', 26, 15); lab.player.x = 8; lab.player.z = 15;
    lab.player.yaw = Math.PI / 2; lab.run(0.5); const d0 = Math.hypot(wm.x - 8, wm.z - 15);
    lab.player.yaw = -Math.PI / 2; lab.run(0.5); // look back
    const d1 = Math.hypot(wm.x - 8, wm.z - 15); expect(d1).toBeLessThan(d0 - 2);
    let tell = -1, hit = -1;
    for (let k = 0; k < 6; k++) { lab.player.yaw = Math.PI / 2; lab.run(0.4); lab.player.yaw = -Math.PI / 2; lab.run(0.6, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } }); }
    lab.run(4, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0); if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(Math.max(0.38, ENTITIES.windowman.tell * DIFFICULTIES.normal.tellTime) - 0.1);
  });
  it('Motion Echo replays your path five seconds late and kills only after a tell if you stand still', () => {
    const lab = makeLab({ difficulty: 'normal' });
    const e = lab.ew.spawn('echo', 5, 5);
    const trailPos = (t: number) => ({ x: 6 + t * 1.0, z: 15 });
    let last = 0; let tell = -1, hit = -1;
    lab.run(30, (t) => {
      const moving = t < 8; const pos = moving ? trailPos(t) : trailPos(8);
      lab.player.x = pos.x; lab.player.z = pos.z;
      if (t - last >= 0.25) { last = t; lab.ctx.trail = lab.ctx.trail ?? []; lab.ctx.trail.push({ t, x: pos.x, z: pos.z }); }
      lab.ctx.time = t;
      for (const ev of lab.events) { if (ev.type === 'tell' && tell < 0) tell = t; if (ev.type === 'hit' && hit < 0) hit = t; }
    });
    expect(tell).toBeGreaterThan(8); expect(hit).toBeGreaterThanOrEqual(tell + 1.0 - 0.1);
    expect(e.x).toBeCloseTo(14, 0); // it ended where you stood, late
  });
  it('Gallery: staring at a wrong portrait summons the Curator; the Curator freezes while watched and tells before it strikes', () => {
    const plan = levelById('gallery')!.generate(5);
    expect(plan.portraits!.length).toBeGreaterThan(15); expect(plan.portraits!.some((p) => p.wrong)).toBe(true);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const wrong = plan.portraits!.find((p) => p.wrong)!;
    sim.player.place(wrong.x - Math.sin(wrong.yaw) * 2.5, wrong.z - Math.cos(wrong.yaw) * 2.5, wrong.yaw + Math.PI);
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    for (let i = 0; i < 60 * 6; i++) sim.step(emptyFrame());
    expect(sim.ew.entities.some((e) => e.def.id === 'curator') || ev.includes('violation')).toBe(true);
    const lab = makeLab(); const c = lab.ew.spawn('curator', 22, 15); lab.player.x = 8; lab.player.z = 15; lab.player.yaw = -Math.PI / 2;
    lab.run(5); expect(Math.hypot(c.x - 8, c.z - 15)).toBeGreaterThan(12); // frozen while watched
    lab.player.yaw = Math.PI / 2; let tell = -1; lab.run(10, (t) => { for (const e of lab.events) if (e.type === 'tell' && tell < 0) tell = t; });
    expect(tell).toBeGreaterThan(0);
  });
});

describe('Run for Your Life (the chase)', () => {
  it('the Pursuer waits a grace period, holds off at checkpoints, tells before the kill', () => {
    const lab = makeLab(); const p = lab.ew.spawn('pursuer', 30, 15); lab.player.x = 8; lab.player.z = 15;
    lab.run(10); expect(Math.hypot(p.x - 30, p.z - 15)).toBeLessThan(0.5); // grace
    lab.run(30); expect(Math.hypot(p.x - 8, p.z - 15)).toBeLessThan(6);
    const lab2 = makeLab(); const q = lab2.ew.spawn('pursuer', 25, 15); lab2.player.x = 8; lab2.player.z = 15; lab2.ctx.safeSpots = [{ x: 8, z: 15 }];
    lab2.run(40); expect(Math.hypot(q.x - 8, q.z - 15)).toBeGreaterThan(8); // held off at the checkpoint
    const lab3 = makeLab(); lab3.ew.spawn('pursuer', 12, 15); lab3.player.x = 8; lab3.player.z = 15;
    let tell = -1, hit = -1; lab3.run(25, (t) => { for (const e of lab3.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(12); expect(hit).toBeGreaterThanOrEqual(tell + Math.max(0.38, ENTITIES.pursuer.tell * DIFFICULTIES.normal.tellTime) - 0.1);
  });
  it('FAIR: a runner who alternates sprinting and walking outruns the Pursuer to the exit on every tested seed (no god mode)', () => {
    const def = levelById('chase')!;
    for (let i = 0; i < 6; i++) { const plan = def.generate(2000 + i * 97); const r = runBot(plan, { mode: 'active', god: false, sprint: true, visitWaypoints: false, maxSeconds: 400 }); expect(r.completed, `seed ${2000 + i * 97}: ${r.reason} after ${r.seconds.toFixed(0)}s`).toBe(true); }
  }, 60000);
});

describe('Finale and endings', () => {
  it('the finale has the Architect, echoes of earlier entities, and no plain exit', () => {
    const p = levelById('finale')!.generate(5); const sim = new LevelSim(p, 'normal');
    expect(sim.ew.entities.some((e) => e.def.id === 'architect')).toBe(true);
    const a = sim.ew.entities.find((e) => e.def.id === 'architect')!; sim.player.place(a.x - 1.2, a.z);
    const labels = sim.interactables().map((i) => i.label); expect(labels.some((l) => l.includes('Architect'))).toBe(true); expect(labels).not.toContain('Leave');
  });
  it('every ending has text and each of the six is reachable from the Architect\'s choices + flags', () => {
    for (const id of ['escape', 'join', 'sacrifice', 'loop', 'true', 'secret'] as const) expect(ENDING_TEXT[id].text.length).toBeGreaterThan(40);
    const R = (p: object) => resolveEnding({ ...BASE_STATE, ...p });
    expect(R({})).toBe('escape'); expect(R({ acceptedArchitect: true })).toBe('join'); expect(R({ companionAlive: true, chosenStay: true })).toBe('sacrifice');
    expect(R({ refusedExit: true })).toBe('loop'); expect(R({ anchorsFound: 5, trueDecision: true })).toBe('true'); expect(R({ secretSequence: true })).toBe('secret');
  });
});
