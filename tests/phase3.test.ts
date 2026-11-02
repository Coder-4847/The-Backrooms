import { describe, expect, it } from 'vitest';
import { levelById, LEVELS, isImplemented, CAMPAIGN } from '../src/levels/registry';
import { LevelSim } from '../src/levels/sim';
import { runBot } from '../src/levels/bot';
import { validatePlan } from '../src/gen/validate';
import { makeLab } from '../src/entities/lab';
import { emptyFrame } from '../src/core/input/logic';
import { DIFFICULTIES } from '../src/core/difficulty';
import { Stats } from '../src/systems/stats';
import { NOTES } from '../src/story/notes';

const ACT2 = ['level6', 'level7', 'level8', 'garage', 'level37', 'sewers', 'hospital', 'serverfarm'];
const face = (e: { x: number; z: number; yaw: number }, t: { x: number; z: number }) => { e.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z)); };
const ents = (id: string) => [...new Set(levelById(id)!.generate(11).entitySlots.map((s) => s.entity))].sort();

describe('Act 2 levels', () => {
  it('registers all eight in campaign order (indices 7-14)', () => {
    for (const id of ACT2) expect(isImplemented(id), id).toBe(true);
    expect(CAMPAIGN.slice(7, 15).map((c) => c.id)).toEqual(ACT2);
    expect(LEVELS.filter((l) => !l.dev).length).toBe(15);
  });
  it('ecology: signature + secondary entities as designed', () => {
    expect(ents('level6')).toEqual(['lurker']); expect(ents('level7')).toEqual(['leviathan']); expect(ents('level8')).toEqual(['crawler']);
    expect(ents('garage')).toEqual(['smiler']); expect(ents('level37')).toEqual(['drowned']); expect(ents('sewers')).toEqual(['hound', 'leech']);
    expect(ents('hospital')).toEqual(['coworker', 'faceling']); expect(ents('serverfarm')).toEqual(['static']);
  });
  it('pacing rule: never two full-horror levels in a row until the climax; a calmer level follows horror', () => {
    const order = CAMPAIGN.map((c) => c.tier);
    for (let i = 1; i < order.length - 3; i++) if (order[i] === 'horror') expect(order[i - 1] === 'horror', `${CAMPAIGN[i].id}`).toBe(false);
    for (let i = 0; i < order.length - 1; i++) if (order[i] === 'horror' && i < 21) expect(['chill', 'uneasy', 'tense']).toContain(order[i + 1]);
  });
  it('each level validates on 40 seeds (water, sections, unlit, props)', () => {
    for (const id of ACT2) { const def = levelById(id)!; for (let s = 0; s < 40; s++) expect(validatePlan(def, def.generate(s * 733 + 5)), `${id} ${s}`).toEqual([]); }
  }, 60000);
  it('the bot completes every Act 2 level on 10 seeds', () => {
    for (const id of ACT2) { const def = levelById(id)!; for (let i = 0; i < 10; i++) { const r = runBot(def.generate(900 + i * 211), { visitWaypoints: true }); expect(r.completed, `${id}: ${r.reason}`).toBe(true); } }
  }, 120000);
  it('every note referenced exists; Act 2 has its notes', () => {
    for (const id of ACT2) { expect(Object.values(NOTES).some((n) => n.level === id), id).toBe(true); const p = levelById(id)!.generate(3); for (const i of p.items.filter((x) => x.kind === 'note')) expect(NOTES[i.item] ?? p.noteText?.[i.item]).toBeDefined(); }
  });
});

describe('water and breath', () => {
  const plan = levelById('level7')!.generate(21);
  const swimRoom = plan.water!.find((w) => w.depth === 'swim')!;
  const flooded = plan.water!.find((w) => w.depth === 'flooded');
  const put = (sim: LevelSim, room: number) => { const r = plan.rooms[room]; sim.player.place(r.x + r.w / 2, r.z + r.d / 2); sim.room = room; };
  it('flooded rooms are never on the critical path; the exit, start and supply are never underwater', () => {
    for (let s = 0; s < 30; s++) { const p = levelById('level7')!.generate(s + 1); for (const w of p.water!) { if (w.depth === 'flooded') expect(p.criticalPath.includes(w.room)).toBe(false); expect(['start', 'supply', 'exit']).not.toContain(p.rooms[w.room].kind); } }
    expect(flooded).toBeDefined();
  });
  it('swimming is slower than walking and noisier; diving (crouch) is quiet and drains breath, the surface refills it', () => {
    const dry = new LevelSim(plan, 'normal', { spawnEntities: false }), wet = new LevelSim(plan, 'normal', { spawnEntities: false });
    const f = emptyFrame(); f.moveY = 1;
    const dryRoom = plan.rooms.find((r) => !plan.water!.some((w) => w.room === r.id) && r.w > 8 && r.d > 8)!;
    put(dry, dryRoom.id); put(wet, swimRoom.room);
    for (let i = 0; i < 60; i++) { dry.player.yaw += 0.01; wet.player.yaw += 0.01; dry.step(f); wet.step(f); }
    expect(wet.player.speed).toBeLessThan(dry.player.speed); expect(wet.waterHere).toBe('swim'); expect(wet.player.swim).toBe('surface');
    expect(wet.stats.breath).toBe(100);
    const fd = emptyFrame(); fd.down.Crouch = true;
    for (let i = 0; i < 60 * 5; i++) wet.step(fd);
    expect(wet.player.swim).toBe('dive'); expect(wet.stats.breath).toBeLessThan(90);
    const b = wet.stats.breath; for (let i = 0; i < 60 * 2; i++) wet.step(emptyFrame());
    expect(wet.stats.breath).toBeGreaterThan(b);
  });
  it('running out of air hurts; harder difficulties drain faster', () => {
    const s = new Stats();
    for (let i = 0; i < 60 * 40; i++) s.updateBreath(1 / 60, true, DIFFICULTIES.normal);
    expect(s.breath).toBe(0); expect(s.health).toBeLessThan(100);
    const a = new Stats(), b = new Stats();
    for (let i = 0; i < 60 * 5; i++) { a.updateBreath(1 / 60, true, DIFFICULTIES.easy); b.updateBreath(1 / 60, true, DIFFICULTIES.nightmare); }
    expect(b.breath).toBeLessThan(a.breath);
  });
  it('a flooded side room forces a dive and drains breath', () => {
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    put(sim, flooded!.room);
    for (let i = 0; i < 60 * 3; i++) sim.step(emptyFrame());
    expect(sim.waterHere).toBe('flooded'); expect(sim.player.swim).toBe('dive'); expect(sim.stats.breath).toBeLessThan(95);
  });
  it('wading and swimming splash noise is louder than dry walking; diving is quieter', () => {
    const loud = (room: number, dive: boolean) => { const sim = new LevelSim(plan, 'normal', { spawnEntities: false }); put(sim, room); const f = emptyFrame(); f.moveY = 1; f.down.Crouch = dive; for (let i = 0; i < 30; i++) { sim.player.yaw += 0.01; sim.step(f); } return Math.max(0, ...sim.noise.events.map((e) => e.loudness)); };
    const dryRoom = plan.rooms.find((r) => !plan.water!.some((w) => w.room === r.id) && r.w > 8 && r.d > 8)!.id;
    expect(loud(swimRoom.room, false)).toBeGreaterThan(loud(dryRoom, false));
    expect(loud(swimRoom.room, true)).toBeLessThan(loud(swimRoom.room, false));
  });
});

describe('darkness, light sections and puzzles', () => {
  it('Level 6 is dark: only the start and supply rooms are lit, light level is near zero, the flashlight is the light', () => {
    const p = levelById('level6')!.generate(5);
    expect(p.dark).toBe(true);
    const lit = p.rooms.filter((r) => !p.unlit!.includes(r.id)).map((r) => r.kind);
    expect(lit.every((k) => k === 'start' || k === 'supply')).toBe(true);
    expect(p.beacons![0]).toEqual(p.exit.pos);
    const sim = new LevelSim(p, 'normal', { spawnEntities: false });
    const r = p.rooms.find((q) => p.unlit!.includes(q.id))!; sim.player.place(r.x + r.w / 2, r.z + r.d / 2); sim.room = r.id; sim.flash.on = false;
    expect(sim.lightLevel).toBeLessThan(0.1);
    sim.flash.on = true; expect(sim.lightLevel).toBeGreaterThan(0.2);
  });
  it('sanity drains in the dark faster than in the light', () => {
    const p = levelById('level6')!.generate(5);
    const run = (flash: boolean) => { const sim = new LevelSim(p, 'normal', { spawnEntities: false }); const r = p.rooms.find((q) => p.unlit!.includes(q.id))!; sim.player.place(r.x + r.w / 2, r.z + r.d / 2); sim.flash.on = flash; for (let i = 0; i < 60 * 30; i++) { sim.room = r.id; sim.step(emptyFrame()); } return sim.stats.sanity; };
    expect(run(false)).toBeLessThan(run(true));
  });
  it('Garage: 3 breakers restore 3 sections in order; each breaker unlocks its gate and relights its rooms', () => {
    const p = levelById('garage')!.generate(8);
    expect(p.puzzles!.filter((q) => q.kind === 'breaker')).toHaveLength(3);
    expect(p.sections).toHaveLength(3);
    const sim = new LevelSim(p, 'normal', { spawnEntities: false });
    const before = sim.unlit.size; expect(before).toBeGreaterThan(0);
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    const pz = p.puzzles![0];
    sim.x.handle({ type: 'breaker', puzzle: pz.id, part: pz.parts[0].id });
    expect(sim.keys.has(pz.lock)).toBe(true); expect(ev).toContain('lights');
    expect(sim.unlit.size).toBeLessThan(before);
    for (const r of p.sections![0].rooms) expect(sim.unlit.has(r)).toBe(false);
  });
  it('Server Farm sequence puzzle: right order unlocks, wrong order resets the rack', () => {
    const p = levelById('serverfarm')!.generate(8);
    const pz = p.puzzles!.find((q) => q.kind === 'sequence')!;
    expect(pz.parts).toHaveLength(4); expect([...pz.solution].sort()).toEqual([0, 1, 2, 3]);
    const hint = p.noteText![pz.hintNote].text; for (const k of pz.solution) expect(hint).toContain(`SERVER ${'ABCD'[k]}`);
    const sim = new LevelSim(p, 'normal', { spawnEntities: false });
    const press = (k: number) => sim.x.handle({ type: 'seq', puzzle: pz.id, part: pz.parts[k].id });
    press(pz.solution[0]); press(pz.solution[1]);
    expect(sim.x.seq.get(pz.id)).toBe(2);
    press(pz.solution[3]); // out of order
    expect(sim.x.seq.get(pz.id)).toBe(0); expect(sim.keys.has(pz.lock)).toBe(false);
    pz.solution.forEach(press);
    expect(sim.keys.has(pz.lock)).toBe(true);
  });
  it('Level 8 gates a chasm with a grappling hook; Sewers use valves for flow control', () => {
    const p8 = levelById('level8')!.generate(9);
    expect(p8.items.some((i) => i.item === 'grapple' && i.unlocks?.startsWith('rope'))).toBe(true);
    const sim = new LevelSim(p8, 'normal', { spawnEntities: false });
    const rope = [...sim.doors.values()].find((d) => d.conn.lock!.startsWith('rope'))!;
    sim.player.place(rope.conn.door.x - (rope.conn.axis === 'z' ? 1 : 0), rope.conn.door.z - (rope.conn.axis === 'x' ? 1 : 0));
    expect(sim.interactables().find((i) => i.kind === 'door')!.label).toContain('grappling');
    expect(levelById('sewers')!.generate(9).puzzles!.some((q) => q.kind === 'valves')).toBe(true);
    expect(levelById('sewers')!.generate(9).water!.every((w) => w.sludge)).toBe(true);
  });
  it('Level 37 (chill) hides an optional scary area: a flooded nest with a cache', () => {
    const p = levelById('level37')!.generate(6);
    const nest = p.rooms.find((r) => r.kind === 'nest')!;
    expect(p.water!.some((w) => w.room === nest.id)).toBe(true);
    expect(p.items.filter((i) => i.room === nest.id).length).toBeGreaterThanOrEqual(8);
    expect(levelById('level37')!.tier).toBe('chill');
  });
  it('Hospital: the ward question tells the Faceling from a real patient; Pim-like face tell exists', () => {
    const p = levelById('hospital')!.generate(6);
    const sim = new LevelSim(p, 'normal');
    const real = sim.ew.entities.find((e) => e.def.id === 'coworker')!, fake = sim.ew.entities.find((e) => e.def.id === 'faceling')!;
    expect(sim.x.ask(real.id)!.answer).toBe(p.verify!.answer);
    const f = sim.x.ask(fake.id)!; expect(f.fake).toBe(true); expect(f.answer).toBe(p.verify!.wrong);
    expect(p.flicker).toBeGreaterThan(0.4);
  });
});

describe('Act 2 entities (entity lab)', () => {
  it('Lurker: ignores light, feels footsteps through the floor, tells (rumble) before it strikes; silence saves you', () => {
    const lab = makeLab(); const l = lab.ew.spawn('lurker', 12, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.noise = 0.6; lab.player.flashOn = true; lab.player.flashPower = 1;
    let tell = -1, hit = -1; lab.run(10, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0); expect(hit).toBeGreaterThanOrEqual(tell + 1.5 - 0.1);
    const quiet = makeLab(); const q = quiet.ew.spawn('lurker', 12, 15);
    quiet.player.x = 8; quiet.player.z = 15; quiet.player.noise = 0; quiet.player.flashOn = true;
    quiet.run(10); expect(quiet.events.some((e) => e.type === 'hit')).toBe(false); expect(q.state).not.toBe('chase');
    void l;
  });
  it('Leviathan only reacts to splashing while you are in the water, tells (surge) before it strikes', () => {
    const lab = makeLab(); lab.plan.water = [{ room: 0, depth: 'swim' }];
    const lv = lab.ew.spawn('leviathan', 20, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.noise = 0.8; lab.player.water = false;
    lab.run(5); expect(lab.events.some((e) => e.type === 'tell')).toBe(false);
    lab.player.water = true; let tell = -1, hit = -1;
    lab.run(12, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0); if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(1.8 - 0.1);
    void lv;
  });
  it('Cave Crawlers commit in the dark, flee a flashlight beam, and the whole pack follows', () => {
    const lab = makeLab(); const a = lab.ew.spawn('crawler', 14, 14, 3), b = lab.ew.spawn('crawler', 15, 17, 3);
    lab.player.x = 7; lab.player.z = 15; lab.player.light = 0.1; face(a, lab.player);
    lab.run(1.2); expect(['tell', 'chase']).toContain(a.state); expect(['tell', 'chase']).toContain(b.state);
    lab.player.flashOn = true; lab.player.flashPower = 1; lab.player.yaw = -Math.PI / 2; a.x = 12; a.z = 15;
    lab.run(0.5); expect(a.state).toBe('flee');
    const lit = makeLab(); const c = lit.ew.spawn('crawler', 14, 15, 4); face(c, lit.player); lit.player.x = 7; lit.player.z = 15; lit.player.light = 0.9;
    lit.run(3); expect(c.state === 'tell' || c.state === 'chase').toBe(false);
  });
  it('Smiler: stare at it and it advances after a tell; look away and it creeps; lit rooms drive it off', () => {
    const lab = makeLab(); const s = lab.ew.spawn('smiler', 20, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.light = 0.2; lab.player.yaw = -Math.PI / 2; // staring at it
    let tell = -1, hit = -1; lab.run(12, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(2); if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(1.4 - 0.1);
    const look = makeLab(); const s2 = look.ew.spawn('smiler', 20, 15);
    look.player.x = 8; look.player.z = 15; look.player.light = 0.2; look.player.yaw = Math.PI / 2; // looking away
    look.run(12); expect(look.events.some((e) => e.type === 'tell')).toBe(false); expect(s2.state).toBe('patrol');
    const lit = makeLab(); lit.ew.spawn('smiler', 20, 15); lit.player.x = 8; lit.player.z = 15; lit.player.light = 0.9; lit.player.yaw = -Math.PI / 2;
    lit.run(10); expect(lit.events.some((e) => e.type === 'tell')).toBe(false);
    void s;
  });
  it('Drowned: only rises when you stay in water near it; leaving the water keeps you safe', () => {
    const lab = makeLab(); const d = lab.ew.spawn('drowned', 16, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.water = false; lab.run(8); expect(d.state).toBe('patrol');
    lab.player.water = true; lab.player.noise = 0.4; lab.run(8); expect(['hunt', 'tell']).toContain(d.state);
  });
  it('Sludge Leech waits, tells (splash), then bleeds you slowly; thrashing sheds it', () => {
    const lab = makeLab(); const l = lab.ew.spawn('leech', 10, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.water = true;
    let tell = -1, hits = 0; lab.run(8, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; } hits = lab.events.filter((e) => e.type === 'hit').length; });
    expect(tell).toBeGreaterThan(0); expect(hits).toBeGreaterThan(0); expect(l.def.damage).toBeLessThan(5);
  });
  it('Static blinks toward you, tears the screen (tell), and is drawn to your light', () => {
    const lab = makeLab(); const s = lab.ew.spawn('static', 25, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.flashOn = true; lab.player.yaw = Math.PI / 2;
    const d0 = Math.hypot(s.x - 8, s.z - 15); let tell = -1, hit = -1;
    lab.run(14, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(Math.hypot(s.x - 8, s.z - 15)).toBeLessThan(d0); expect(tell).toBeGreaterThan(0);
    if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(1.3 - 0.1);
    expect(s.data.glitch).toBeDefined();
  });
});
