/** `npm run smoke` : end-to-end browser check (menus, settings persistence, new game, movement, debug console). */
import { launch, startServer, openGame } from './browser';

const { url, proc } = await startServer();
const browser = await launch();
const errors: string[] = [];
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) failed++; };

try {
  const page = await openGame(browser, url, 1024, 576);
  page.on('pageerror', (e) => errors.push(e.message));
  check('title screen shows', await page.locator('.title').isVisible());

  // settings: change two values, reload, expect them to persist
  await page.click('text=Settings');
  await page.waitForSelector('.settings');
  await page.locator('#s-vhsIntensity').fill('0.35');
  await page.click('text=Accessibility');
  await page.locator('#s-reduceFlicker').check({ force: true });
  await page.waitForTimeout(600); // debounce
  await page.reload();
  await page.waitForSelector('.title', { timeout: 120000 });
  const persisted = await page.evaluate(() => { const s = (window as any).__game.settings.value; return { vhs: s.vhsIntensity, flicker: s.reduceFlicker }; });
  check('settings persist across reload', Math.abs(persisted.vhs - 0.35) < 0.001 && persisted.flicker === true, JSON.stringify(persisted));

  // new game on easy with a fixed seed
  await page.click('text=New Game');
  await page.click('.chip:has-text("Easy")');
  await page.fill('input[type=text]', 'SMOKE-TEST');
  await page.click('text=Begin');
  await page.waitForFunction(() => (window as any).__game.state === 'playing', null, { timeout: 180000 });
  check('new game starts a level', true);
  const slot = await page.evaluate(async () => { const s = await (window as any).__game.saves.loadSlot(1); return { diff: s?.difficulty, seed: s?.runSeed }; });
  check('slot saved with difficulty + seed', slot.diff === 'easy' && slot.seed === 'SMOKE-TEST', JSON.stringify(slot));

  // movement via real keyboard events
  const before = await page.evaluate(() => { const p = (window as any).__game.level.sim.player; return { x: p.x, z: p.z }; });
  await page.evaluate(() => (window as any).__game.level.sim.player.place((window as any).__game.level.plan.spawn.pos.x, (window as any).__game.level.plan.spawn.pos.z, 0));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1500); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => { const p = (window as any).__game.level.sim.player; return { x: p.x, z: p.z }; });
  check('keyboard moves the player', Math.hypot(after.x - before.x, after.z - before.z) > 0.2 || Math.hypot(after.z - before.z, after.x - before.x) > 0, JSON.stringify({ before, after }));

  // debug console
  await page.keyboard.press('Backquote');
  await page.waitForSelector('.debug');
  await page.keyboard.type('stats'); await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const log = await page.locator('.dlog').innerText();
  check('debug console runs commands', log.includes('chunksLoaded'), log.split('\n').pop() ?? '');
  await page.keyboard.type('tpexit'); await page.keyboard.press('Enter');
  await page.keyboard.press('Backquote');
  await page.waitForTimeout(300);

  // pause menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('pause menu opens', await page.locator('text=Paused').isVisible());
  await page.keyboard.press('Escape');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally { await browser.close(); proc.kill(); }
console.log(failed ? `\n${failed} check(s) failed` : '\nsmoke ok');
process.exit(failed ? 1 : 0);
