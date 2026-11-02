import { describe, expect, it } from 'vitest';
import { levelById, LEVELS, isImplemented, CAMPAIGN } from '../src/levels/registry';
import { LevelSim } from '../src/levels/sim';
import { runBot } from '../src/levels/bot';
import { validatePlan } from '../src/gen/validate';
import { makeLab } from '../src/entities/lab';
import { RECIPES, canCraft, craft, discover } from '../src/systems/crafting';
import { Inventory } from '../src/systems/inventory';
import { emptyFrame } from '../src/core/input/logic';
import { DIFFICULTIES } from '../src/core/difficulty';
import { NOTES } from '../src/story/notes';
import { StaticWorld } from '../src/core/collision';
import { indexChunks, meshChunk } from '../src/gen/mesher';

const ACT1 = ['level1', 'level2', 'level3', 'level4', 'level5', 'schoolhouse'];
const face = (e: { x: number; z: number; yaw: number }, t: { x: number; z: number }) => { e.yaw = Math.atan2(-(t.x - e.x), -(t.z - e.z)); };

describe('Act 1 levels', () => {
  it('registers all six, in campaign order after Level 0', () => {
    for (const id of ACT1) expect(isImplemented(id), id).toBe(true);
    expect(CAMPAIGN.slice(0, 7).map((c) => c.id)).toEqual(['level0', ...ACT1]);
    expect(LEVELS.filter((l) => !l.dev).length).toBeGreaterThanOrEqual(7);
  });
  it('each level has a distinct look and the right ecology', () => {
    const looks = new Set(ACT1.map((id) => JSON.stringify(levelById(id)!.look.fogColor)));
    expect(looks.size).toBe(ACT1.length);
    const ents = (id: string) => [...new Set(levelById(id)!.generate(11).entitySlots.map((s) => s.entity))].sort();
    expect(ents('level1')).toEqual(['companion', 'hound']);
    expect(ents('level2')).toEqual(['hound', 'howler']);
    expect(ents('level3')).toEqual([]);                       // entity-free
    expect(ents('level4')).toContain('skinstealer'); expect(ents('level4')).toContain('coworker');
    expect(ents('level5')).toEqual(['hound']);                // plus the Concierge, summoned by rules
    expect(ents('schoolhouse')).toEqual(['monitor']);
  });
  it('each level validates (props never block anything) on 60 seeds', () => {
    for (const id of ACT1) { const def = levelById(id)!; for (let s = 0; s < 60; s++) { const e = validatePlan(def, def.generate(s * 911 + 7)); expect(e, `${id} seed ${s}`).toEqual([]); } }
  }, 60000);
  it('Level 2 valve puzzle: solvable only by the right settings, hint note states them', () => {
    const plan = levelById('level2')!.generate(5);
    const pz = plan.puzzles![0];
    expect(pz.parts).toHaveLength(3);
    const hint = plan.noteText![pz.hintNote].text;
    for (const v of pz.solution) expect(hint).toContain(String(v));
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const lockedDoor = [...sim.doors.values()].find((d) => d.conn.lock === pz.lock)!;
    expect(sim.keys.has(pz.lock)).toBe(false);
    pz.parts.forEach((pt, i) => { for (let k = 0; k < pz.solution[i]; k++) sim.x.handle({ type: 'valve', puzzle: pz.id, part: pt.id }); });
    expect(sim.keys.has(pz.lock)).toBe(true); expect(lockedDoor.open).toBe(false);
    // wrong combo does not solve
    const sim2 = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim2.x.handle({ type: 'valve', puzzle: pz.id, part: pz.parts[0].id });
    expect(sim2.keys.has(pz.lock)).toBe(pz.solution[0] === 1 && pz.solution[1] === 0 && pz.solution[2] === 0);
  });
  it('Level 3 uses fuses as stages; Level 1 uses a crowbar; items exist for every lock', () => {
    const p3 = levelById('level3')!.generate(9);
    expect(p3.connections.filter((c) => c.lock).every((c) => c.lock!.startsWith('fuse'))).toBe(true);
    expect(p3.items.filter((i) => i.kind === 'key').map((i) => i.item).sort()).toEqual(['fuse1', 'fuse2', 'fuse3']);
    const p1 = levelById('level1')!.generate(9);
    expect(p1.items.find((i) => i.kind === 'key')!.item).toBe('crowbar');
    expect(p1.items.some((i) => i.item === 'radio')).toBe(true);
  });
  it('Level 3 has a big stockroom behind the last gate', () => {
    const p = levelById('level3')!.generate(9);
    const best = Math.max(...p.rooms.filter((r) => r.kind === 'supply').map((r) => p.items.filter((i) => i.room === r.id && i.kind === 'loot').length));
    expect(best).toBeGreaterThanOrEqual(12);
  });
  it('Level 5 posts 4 rules, exactly 2 enforceable, each with a register clue, and the clues disagree for false rules', () => {
    for (let s = 0; s < 20; s++) {
      const p = levelById('level5')!.generate(s * 3 + 1);
      expect(p.rules).toHaveLength(4);
      expect(p.rules!.filter((r) => r.real)).toHaveLength(2);
      expect(p.rules!.find((r) => r.kind === 'noKnock')!.real).toBe(false);
      for (let i = 0; i < 4; i++) { expect(p.noteText![`rule_post${i}`].text).toBe(p.rules![i].text); expect(p.noteText![`rule_clue${i}`]).toBeDefined(); }
    }
  });
  it('breaking a real rule summons the Concierge; false rules and quiet play do not', () => {
    const plan = levelById('level5')!.generate(4);
    const real = plan.rules!.find((r) => r.real && r.kind === 'noRunning') ?? plan.rules!.find((r) => r.real && r.kind !== 'noKnock')!;
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const hall = plan.rooms.find((r) => r.kind === 'hall')!;
    expect(hall).toBeDefined();
    sim.player.place(hall.x + hall.w / 2, hall.z + hall.d / 2); sim.room = hall.id;
    const f = emptyFrame(); const events: string[] = []; sim.listeners.push((e) => events.push(e.type));
    if (real.kind === 'noLight') { sim.flash.on = true; } else if (real.kind === 'noRunning') { f.moveY = 1; f.down.Sprint = true; }
    else { f.moveY = 1; f.down.Sprint = true; }
    for (let i = 0; i < 90; i++) { sim.player.yaw += 0.02; sim.step(f); }
    expect(events).toContain('violation'); expect(sim.ew.entities.some((e) => e.def.id === 'concierge')).toBe(true);
    const calm = new LevelSim(plan, 'normal', { spawnEntities: false }); calm.player.place(hall.x + hall.w / 2, hall.z + hall.d / 2); calm.room = hall.id; calm.flash.on = false;
    for (let i = 0; i < 300; i++) calm.step(emptyFrame());
    expect(calm.ew.entities.length).toBe(0);
  });
  it('the bot completes all six Act 1 levels on 12 seeds each (active entities set to observe)', () => {
    for (const id of ACT1) { const def = levelById(id)!; for (let i = 0; i < 12; i++) { const plan = def.generate(500 + i * 337); const r = runBot(plan, { visitWaypoints: true }); expect(r.completed, `${id} ${500 + i * 337}: ${r.reason}`).toBe(true); } }
  }, 120000);
  it('props are solid: you cannot walk through a rack', () => {
    const plan = levelById('level1')!.generate(3);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    const rack = plan.props!.find((p) => p.kind === 'rack')!;
    const x = rack.x, z = rack.z + (rack.d / 2 + 1.2);
    sim.player.place(x, z, 0); // facing -z (toward the rack)
    const f = emptyFrame(); f.moveY = 1; for (let i = 0; i < 120; i++) sim.step(f);
    expect(Math.abs(sim.player.z - rack.z)).toBeGreaterThan(rack.d / 2 + 0.25);
    void StaticWorld; void indexChunks; void meshChunk;
  });
  it('notes referenced by Act 1 levels exist', () => {
    for (const id of ACT1) for (const i of levelById(id)!.generate(2).items.filter((x) => x.kind === 'note')) expect(NOTES[i.item] ?? levelById(id)!.generate(2).noteText?.[i.item], `${id}:${i.item}`).toBeDefined();
  });
});

describe('new entities (entity lab)', () => {
  it('Howler is blind: ignores you while you are silent, hunts a loud player, and a thrown noise draws it away', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('howler', 25, 15); face(h, lab.player);
    lab.player.x = 8; lab.player.z = 15;
    lab.run(5); // silent and in plain view
    expect(['patrol']).toContain(h.state);
    lab.noise.emit(0, 8, 15, 1);
    lab.run(2);
    expect(['investigate', 'tell', 'chase']).toContain(h.state);
    // distraction: noise elsewhere keeps pulling it toward the decoy
    const lab2 = makeLab(); const h2 = lab2.ew.spawn('howler', 20, 15);
    lab2.player.x = 5; lab2.player.z = 5; lab2.player.hidden = true;
    lab2.noise.emit(0, 35, 25, 1);
    lab2.run(4);
    expect(Math.hypot(h2.x - 35, h2.z - 25)).toBeLessThan(Math.hypot(20 - 35, 15 - 25));
  });
  it('Howler screams (tell) before it attacks and the scream alerts a hound across the room', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('howler', 14, 15); const dog = lab.ew.spawn('hound', 35, 25, 7);
    lab.player.x = 8; lab.player.z = 15; lab.player.noise = 1;
    let tell = -1, hit = -1;
    lab.run(8, (t) => { lab.noise.emit(0, lab.player.x, lab.player.z, 1); for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0);
    if (hit > 0) expect(hit - tell).toBeGreaterThanOrEqual(1.4 - 0.1);
    expect(['investigate', 'tell', 'chase', 'search']).toContain(dog.state);
    void h;
  });
  it('a quiet, crouched, breath-held player escapes the Howler', () => {
    const lab = makeLab();
    const h = lab.ew.spawn('howler', 12, 15);
    lab.player.x = 8; lab.player.z = 15; lab.player.noise = 0;
    lab.run(10);
    expect(lab.events.some((e) => e.type === 'hit')).toBe(false); expect(h.state).not.toBe('chase');
  });
  it('Skin-stealer: approaches like a coworker, is revealed by a sustained light, tells before it attacks', () => {
    const lab = makeLab();
    const ss = lab.ew.spawn('skinstealer', 22, 15); face(ss, lab.player);
    lab.player.x = 10; lab.player.z = 15; lab.player.yaw = -Math.PI / 2; // looking at it
    lab.run(3);
    expect(ss.data.disguised).not.toBe(false); // looks friendly
    lab.player.flashOn = true; lab.player.flashPower = 1;
    let revealed = false; lab.run(4, () => { if (ss.data.disguised === false) revealed = true; });
    expect(revealed).toBe(true);
    // attack path: close and unobserved -> tell precedes the hit
    const lab2 = makeLab(); const s2 = lab2.ew.spawn('skinstealer', 8, 15);
    lab2.player.x = 6.8; lab2.player.z = 15; lab2.player.yaw = Math.PI / 2;
    let tell = -1, hit = -1; lab2.run(14, (t) => { for (const e of lab2.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0); expect(hit).toBeGreaterThan(tell + 1.5 * DIFFICULTIES.normal.tellTime - 0.2);
    void s2;
  });
  it('Concierge rings the bell (tell) before attacking and is slower than a sprint', () => {
    const lab = makeLab();
    const c = lab.ew.spawn('concierge', 30, 15); c.data.life = 70;
    lab.player.x = 8; lab.player.z = 15;
    let tell = -1, hit = -1; lab.run(25, (t) => { for (const e of lab.events) { if (e.type === 'tell' && tell < 0) tell = t; if (e.type === 'hit' && hit < 0) hit = t; } });
    expect(tell).toBeGreaterThan(0); expect(hit).toBeGreaterThanOrEqual(tell + 1.8 - 0.1);
    expect(c.def.run).toBeLessThan(4.0);
  });
  it('Concierge despawns after its life runs out', () => {
    const lab = makeLab({ mode: 'observe' }); const c = lab.ew.spawn('concierge', 30, 15); c.data.life = 3;
    lab.player.hidden = true; lab.run(5);
    expect(lab.ew.entities.includes(c)).toBe(false);
  });
  it('Hall Monitor: a real pass is only inspected, no pass means a whistle tell then a chase, forged passes sometimes fail', () => {
    const run = (pass: 'none' | 'real' | 'forged', seed = 5) => { const lab = makeLab({ seed }); lab.ctx.pass = pass; const m = lab.ew.spawn('monitor', 14, 15); face(m, lab.player); lab.player.x = 7; lab.player.z = 15; let chased = false, tell = false, hit = false; lab.run(8, () => { if (m.state === 'chase') chased = true; for (const e of lab.events) { if (e.type === 'tell') tell = true; if (e.type === 'hit') hit = true; } }); return { chased, tell, hit, state: m.state }; };
    expect(run('real')).toMatchObject({ chased: false, tell: false, hit: false });
    expect(run('none')).toMatchObject({ tell: true, chased: true });
    const fails = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((s) => run('forged', s).tell).length;
    expect(fails).toBeGreaterThan(0); expect(fails).toBeLessThan(12);
  });
  it('Companion follows, panics (noisy) near a hunter, and can be lost', () => {
    const lab = makeLab();
    const c = lab.ew.spawn('companion', 5, 5); c.data.following = true; c.data.hp = 100;
    lab.player.x = 30; lab.player.z = 20;
    lab.run(12);
    expect(Math.hypot(c.x - 30, c.z - 20)).toBeLessThan(5);
    const dog = lab.ew.spawn('hound', 30, 8); dog.state = 'chase';
    lab.noise.events.length = 0;
    lab.run(3);
    expect(c.data.panic).toBe(true);
    expect(lab.noise.events.length).toBeGreaterThan(0);
  });
});

describe('crafting, tools and sim extras', () => {
  it('recipes are discovered when ingredients are held, and crafting is atomic', () => {
    const inv = new Inventory();
    const known = new Set<string>();
    expect(discover(inv, known)).toEqual([]);
    inv.add('bottle'); inv.add('rag');
    expect(discover(inv, known)).toContain('rattle');
    const r = RECIPES.find((x) => x.id === 'rattle')!;
    expect(canCraft(inv, r, false)).toBe(true);
    expect(craft(inv, r, false)).toBe(true);
    expect(inv.has('bottle')).toBe(false); expect(inv.count('distraction')).toBe(1);
    expect(craft(inv, r, false)).toBe(false);
  });
  it('kitchen recipes need the kitchen; a full backpack rolls a craft back', () => {
    const inv = new Inventory(); inv.add('canned_food'); inv.add('can_opener');
    const meal = RECIPES.find((x) => x.id === 'meal')!;
    expect(canCraft(inv, meal, false)).toBe(false); expect(canCraft(inv, meal, true)).toBe(true);
    const full = new Inventory(); full.add('rag', 1); full.add('bottle', 1);
    for (let i = 0; i < 30; i++) full.add('flashlight');
    const snapshot = JSON.stringify(full.toState().backpack);
    const rattle = RECIPES.find((x) => x.id === 'rattle')!;
    if (!craft(full, rattle, false)) expect(JSON.stringify(full.toState().backpack)).toBe(snapshot);
  });
  it('throwing a distraction makes noise where it lands and draws hounds', () => {
    const plan = levelById('level1')!.generate(8);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.inv.add('distraction');
    const f = emptyFrame(); f.pressed.Throw = true; const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    sim.step(f);
    expect(ev).toContain('throw'); expect(sim.inv.has('distraction')).toBe(false);
    expect(sim.noise.events.length).toBeGreaterThan(0);
  });
  it('a tripline clatters when an entity crosses it, then is used up', () => {
    const plan = levelById('level1')!.generate(8);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.inv.add('tripline'); sim.inv.hotbar[3] = 'tripline'; sim.inv.selected = 3;
    const ev: string[] = []; sim.listeners.push((e) => ev.push(e.type));
    sim.useHeld(); expect(sim.x.triplines).toHaveLength(1);
    sim.ew.spawn('hound', sim.player.x + 0.3, sim.player.z, 1);
    sim.step(emptyFrame());
    expect(ev).toContain('alarm'); expect(sim.x.triplines).toHaveLength(0);
  });
  it('the radio lures for 20 s then cools down', () => {
    const plan = levelById('level1')!.generate(8);
    const sim = new LevelSim(plan, 'normal', { spawnEntities: false });
    sim.inv.add('radio'); sim.inv.hotbar[3] = 'radio'; sim.inv.selected = 3;
    expect(sim.useHeld()).toBe(true); expect(sim.x.radio).not.toBeNull();
    expect(sim.useHeld()).toBe(false); // still on / cooling down
    const f = emptyFrame(); for (let i = 0; i < 21 * 60; i++) sim.step(f);
    expect(sim.x.radio).toBeNull();
    expect(sim.useHeld()).toBe(false); // 60 s cooldown
  });
  it('talking to the real coworker passes the badge test; the Skin-stealer fails it and is revealed', () => {
    const plan = levelById('level4')!.generate(6);
    const sim = new LevelSim(plan, 'normal');
    const real = sim.ew.entities.find((e) => e.def.id === 'coworker')!, fake = sim.ew.entities.find((e) => e.def.id === 'skinstealer')!;
    const a = sim.x.ask(real.id)!, b = sim.x.ask(fake.id)!;
    expect(a.fake).toBe(false); expect(a.answer).toBe(plan.verify!.answer);
    expect(b.fake).toBe(true); expect(b.answer).toBe(plan.verify!.wrong); expect(b.answer).not.toBe(plan.verify!.answer);
    expect(fake.data.reveal).toBe(true);
    expect(plan.noteText!.l4_cork.text).toContain(plan.verify!.answer);
  });
  it('recruiting Pim makes the companion follow; a hunter hitting it can kill it', () => {
    const plan = levelById('level1')!.generate(8);
    const sim = new LevelSim(plan, 'normal');
    const pim = sim.ew.entities.find((e) => e.def.id === 'companion')!;
    sim.player.place(pim.x + 1, pim.z);
    const events: string[] = []; sim.listeners.push((e) => { if (e.type === 'companion') events.push(e.what); });
    sim.x.handle({ type: 'recruit', id: pim.id });
    expect(sim.x.companion).toBe(pim); expect(events).toContain('recruited');
    sim.ew.entities = sim.ew.entities.filter((e) => e === pim);
    for (let i = 0; i < 4; i++) { const dog = sim.ew.spawn('hound', pim.x + 0.4, pim.z, 5 + i); dog.state = 'chase'; sim.player.place(pim.x + 6, pim.z); sim.step(emptyFrame()); }
    expect(events).toContain('lost'); expect(sim.x.companion).toBeNull();
  });
  it('lock hints name the right tool per lock style', () => {
    const sim = new LevelSim(levelById('level3')!.generate(2), 'normal', { spawnEntities: false });
    const d = [...sim.doors.values()][0];
    sim.player.place(d.conn.door.x - (d.conn.axis === 'z' ? 1 : 0), d.conn.door.z - (d.conn.axis === 'x' ? 1 : 0));
    expect(sim.interactables().find((i) => i.kind === 'door')!.label).toContain('fuse');
  });
});
