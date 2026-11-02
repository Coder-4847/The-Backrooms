/** `npm run smoke` : end-to-end browser check of menus, settings, saves, hub, Level 0, death, completion. */
import { launch, startServer, openGame } from './browser';

const { url, proc } = await startServer();
const browser = await launch();
const errors: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

try {
  const page = await openGame(browser, url, 1024, 576);
  page.on('pageerror', (e) => errors.push(e.message));
  const ev = <T>(fn: () => T) => page.evaluate(fn);
  const waitState = (s: string, ms = 180000) => page.waitForFunction((st) => (window as any).__game.state === st, s, { timeout: ms });
  check('title screen shows', await page.locator('.title').isVisible());

  await page.click('text=Settings'); await page.waitForSelector('.settings');
  await page.locator('#s-vhsIntensity').fill('0.35');
  await page.click('text=Accessibility'); await page.locator('#s-reduceFlicker').check({ force: true });
  await page.waitForTimeout(600); await page.reload(); await page.waitForSelector('.title', { timeout: 120000 });
  const persisted = await ev(() => { const s = (window as any).__game.settings.value; return { vhs: s.vhsIntensity, flicker: s.reduceFlicker }; });
  check('settings persist across reload', Math.abs(persisted.vhs - 0.35) < 0.001 && persisted.flicker === true);

  await page.click('text=New Game'); await page.click('.chip:has-text("Normal")'); await page.fill('input[type=text]', 'SMOKE-1'); await page.click('text=Begin');
  await waitState('playing');
  check('new game lands in the Central Hub', await ev(() => (window as any).__game.flow.inHub === true));
  const hub = await ev(() => { const p = (window as any).__game.level.plan; return { doors: p.hub.doors.length, npcs: p.hub.npcs.length, stations: p.hub.stations.length }; });
  check('hub has doors, 3 survivors, stations', hub.doors >= 4 && hub.npcs === 3 && hub.stations >= 7, JSON.stringify(hub));
  check('starter inventory (flashlight, camcorder)', await ev(() => { const i = (window as any).__game.level.sim.inv; return i.has('flashlight') && i.has('camcorder'); }));

  // talk to Marlow and take the battery
  await ev(() => { const g = (window as any).__game; const n = g.level.plan.hub.npcs[0]; g.level.sim.player.place(n.pos.x + 1.2, n.pos.z); });
  await page.keyboard.press('KeyE'); await page.waitForSelector('.dialogue');
  await page.click('text=I will take that battery.'); await page.waitForTimeout(300);
  check('dialogue gives an item', await ev(() => (window as any).__game.level.sim.inv.count('battery')) === 2);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);

  // inventory panel
  await page.keyboard.press('KeyI'); await page.waitForSelector('.inv-grid');
  check('inventory panel opens with stacks', (await page.locator('.stack').count()) >= 3);
  await page.keyboard.press('KeyI'); await page.waitForTimeout(200);

  // open the Level 0 door and step through
  await ev(() => { const g = (window as any).__game; const d = g.level.plan.hub.doors[0]; g.level.sim.player.place(d.pos.x, d.side === 'N' ? -0.4 : 6.4); g.level.sim.player.yaw = 0; });
  await page.keyboard.press('KeyE'); await page.waitForSelector('text=Step through');
  await page.click('text=Step through');
  await waitState('playing');
  check('Level 0 loads from the door', await ev(() => (window as any).__game.level.def.id) === 'level0');
  const l0 = await ev(() => { const L = (window as any).__game.level; return { rooms: L.plan.rooms.length, ents: L.sim.ew.entities.length, hides: L.plan.hides.length, tier: (window as any).__game.tier().id }; });
  check('Level 0 has rooms, entities, lockers', l0.rooms > 30 && l0.ents >= 3 && l0.hides > 5, JSON.stringify(l0));

  // hide in a locker, then leave
  await ev(() => { const g = (window as any).__game; const L = g.level; L.sim.ew.entities.length = 0; const h = L.plan.hides[0]; L.sim.player.place(h.pos.x - Math.sin(h.yaw) * 1.1, h.pos.z - Math.cos(h.yaw) * 1.1, h.yaw); });
  await page.keyboard.press('KeyE'); await page.waitForTimeout(250);
  check('hiding works', await ev(() => !!(window as any).__game.level.sim.hidden) && await ev(() => document.body.classList.contains('hiding')));
  await page.keyboard.press('KeyE'); await page.waitForTimeout(250);

  // spawn a hound next to the player and check the tell happens before damage (fairness) on the live game
  await ev(() => { const g = (window as any).__game; const L = g.level; L.sim.player.god = false; L.sim.director.phase = 'build'; const p = L.sim.player; const e = L.sim.ew.spawn('hound', p.x - Math.sin(p.yaw) * 5, p.z - Math.cos(p.yaw) * 5, 99); e.yaw = p.yaw + Math.PI; (window as any).__log = []; L.sim.listeners.push((x: any) => (window as any).__log.push([x.type, L.sim.time])); });
  await page.waitForTimeout(5000);
  const log = (await ev(() => (window as any).__log)) as [string, number][];
  const tell = log.find((x) => x[0] === 'tell'), hit = log.find((x) => x[0] === 'hit');
  check('hound telegraphs before biting', !!tell && (!hit || hit[1] > tell[1] + 1), JSON.stringify(log.slice(0, 4)));

  // death -> rewind -> reload at checkpoint/start with the run intact
  await ev(() => { const g = (window as any).__game; g.level.sim.ew.entities.length = 0; g.level.sim.player.god = false; g.level.sim.stats.damage(1000, g.level.sim.diff); });
  await page.waitForSelector('.rewind', { timeout: 20000 });
  check('death shows the tape rewind', true);
  await waitState('playing');
  await page.waitForFunction(() => !document.querySelector('.rewind'), null, { timeout: 60000 });
  check('respawned alive in Level 0', await ev(() => { const g = (window as any).__game; return g.level.def.id === 'level0' && !g.level.sim.dead && g.level.sim.stats.health > 0; }));

  // pick up a note: the reader opens and the journal keeps it
  await ev(() => { const L = (window as any).__game.level; L.sim.ew.entities.length = 0; const n = L.plan.items.find((i: any) => i.kind === 'note'); L.sim.player.place(n.pos.x + 0.6, n.pos.z); });
  await page.keyboard.press('KeyE'); await page.waitForSelector('.paper', { timeout: 20000 });
  check('notes open a reader', true);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  // finish the level: walk to the exit marker and interact -> back to the hub with the frontier advanced
  await ev(() => { const g = (window as any).__game; const L = g.level; L.sim.ew.entities.length = 0; L.sim.player.god = true; L.teleport(L.plan.exit.pos.x - 1.2, L.plan.exit.pos.z); });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => (window as any).__game.flow.inHub === true && (window as any).__game.state === 'playing', null, { timeout: 120000 });
  const slot = await ev(async () => { const s = await (window as any).__game.saves.loadSlot(1); return { frontier: s.frontier, done: Object.keys(s.completed) }; });
  check('level completion saved and unlocked the next door', slot.frontier === 1 && slot.done.includes('level0'), JSON.stringify(slot));
  check('journal found notes are kept', (await ev(() => (window as any).__game.knownNotes().length)) >= 1);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); proc.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nsmoke ok');
process.exit(failed ? 1 : 0);
