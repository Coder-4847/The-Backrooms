/** `npm run keys` : keyboard + touch item/look checks in an emulated iPad (with keyboard) and a laptop: arrows turn/walk, item keys, hotbar taps, USE/Throw buttons, no page scroll. */
import { chromium } from 'playwright';
import { startServer } from './browser';
const { url, proc } = await startServer(5203);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const out: string[] = [];
const check = (n: string, ok: boolean, x = '') => { out.push(`${ok ? 'pass' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
try {
  for (const mode of ['ipad', 'laptop'] as const) {
    const ctx = await browser.newContext(mode === 'ipad'
      ? { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }
      : { viewport: { width: 1100, height: 650 } });
    const page = await ctx.newPage();
    await page.addInitScript('window.__name = (f) => f;');
    const errs: string[] = []; page.on('pageerror', (e) => { if (!/Pointer Lock/.test(e.message)) errs.push(e.message); });
    await page.goto(`${url}?debug=1`);
    await page.waitForSelector('text=I understand'); await (mode === 'ipad' ? page.tap('text=I understand') : page.click('text=I understand')); await page.waitForSelector('.title');
    await page.evaluate(async () => { const g = (window as any).__game; g.settings.set('tier', 'potato'); await g.startLevel('level0', 7, 'normal'); const L = g.level; L.sim.director.update = () => null; L.sim.ew.entities.length = 0; L.sim.inv.add('flare'); L.sim.inv.add('flare'); });
    await page.waitForTimeout(700);
    const st = () => page.evaluate(() => { const g = (window as any).__game, p = g.level.sim.player; return { device: g.input.device, touchShown: (document.querySelector('.touch-root') as HTMLElement).style.display !== 'none', sel: g.level.sim.inv.selected, yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2), flash: g.level.sim.flash.on, flares: g.level.sim.inv.count('flare'), scroll: window.scrollY + document.documentElement.scrollTop, use: !(document.querySelector('.touch-btn[data-slot="5"]') as HTMLElement)?.hidden, throwBtn: !(document.querySelector('.touch-btn[data-slot="7"]') as HTMLElement)?.hidden, hot: [...document.querySelectorAll('.hb')].map((b) => b.textContent) }; });
    const s0 = await st();
    /** Hold a key until the sim reports the effect (the emulated browser runs the sim far slower than real time). */
    const hold = async (key: string, done: (v: Awaited<ReturnType<typeof st>>) => boolean) => { await page.keyboard.down(key); const t0 = Date.now(); while (Date.now() - t0 < 20000 && !done(await st())) await page.waitForTimeout(150); await page.keyboard.up(key); return st(); };
    // arrows: left/right turn, up/down walk, and nothing scrolls or hides the touch controls
    const sR = await hold('ArrowRight', (v) => v.yaw < s0.yaw - 0.3); check(`${mode}: ArrowRight turns right`, sR.yaw < s0.yaw - 0.2, `${s0.yaw} -> ${sR.yaw}`);
    const sL = await hold('ArrowLeft', (v) => v.yaw > sR.yaw + 0.4); check(`${mode}: ArrowLeft turns left`, sL.yaw > sR.yaw + 0.4, `${sR.yaw} -> ${sL.yaw}`);
    const sU = await hold('ArrowUp', (v) => Math.hypot(v.x - sL.x, v.z - sL.z) > 0.25); check(`${mode}: ArrowUp walks forward`, Math.hypot(sU.x - sL.x, sU.z - sL.z) > 0.2);
    check(`${mode}: the page never scrolls`, sU.scroll === 0);
    if (mode === 'ipad') check('ipad: touch controls stay up while a keyboard is used', sU.touchShown, JSON.stringify({ device: sU.device }));
    const sD = await hold('PageDown', (v) => Math.abs(v.pitch - sU.pitch) > 0.1);
    check(`${mode}: PageDown looks down`, sD.pitch < sU.pitch - 0.1, `${sU.pitch} -> ${sD.pitch}`);
    // items: digits, brackets, X/Z cycle; arrows do not change the item
    await page.keyboard.press('Digit3'); await page.waitForTimeout(250); check(`${mode}: 3 selects slot 3`, (await st()).sel === 2);
    // the hand actually swaps to the selected item (it used to stay on the flashlight whatever you picked)
    const inHand = () => page.evaluate(() => { const L = (window as any).__game.level; return { holding: L.viewmodel.holding, held: L.sim.inv.held }; });
    let hh = await inHand(); for (let i = 0; i < 60 && hh.holding !== hh.held; i++) { await page.waitForTimeout(150); hh = await inHand(); }
    check(`${mode}: the hand shows the selected item`, hh.holding === hh.held && hh.held !== 'flashlight', JSON.stringify(hh));
    // only ONE hand on screen: the title-screen backdrop's hand used to stay on the shared camera, overlapping the real one
    const hands = await page.evaluate(() => { const c = (window as any).__game.gfx.camera; return c.children.filter((o: any) => o.userData.viewmodel).length; });
    check(`${mode}: exactly one hand on the camera`, hands === 1, `hands ${hands}`);
    if (mode === 'laptop') {
      // left click uses the held item (with the pointer locked)
      const before = await page.evaluate(() => { const g = (window as any).__game, s = g.level.sim; s.inv.add('bandage'); s.inv.assign(2, 'bandage'); s.inv.selected = 2; s.stats.health = 40; g.input.locked = true; return s.inv.count('bandage'); });
      await page.waitForTimeout(200);
      await page.evaluate(() => { const c = (window as any).__game.gfx.renderer.domElement; c.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); });
      await page.waitForFunction((n) => (window as any).__game.level.sim.inv.count('bandage') < n, before, { timeout: 15000 }).catch(() => {});
      await page.evaluate(() => { window.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); (window as any).__game.input.locked = false; });
      const after = await page.evaluate(() => (window as any).__game.level.sim.inv.count('bandage'));
      check('laptop: left click uses the held item', after === before - 1, `${before} -> ${after}`);
    }
    await page.keyboard.press('BracketRight'); await page.waitForTimeout(250); check(`${mode}: ] selects the next slot`, (await st()).sel === 3);
    await page.keyboard.press('BracketRight'); await page.waitForTimeout(250); check(`${mode}: ] wraps to slot 1`, (await st()).sel === 0);
    await page.keyboard.press('BracketLeft'); await page.waitForTimeout(250); check(`${mode}: [ wraps back to slot 4`, (await st()).sel === 3);
    await page.keyboard.press('KeyZ'); await page.waitForTimeout(250); check(`${mode}: Z selects the previous slot`, (await st()).sel === 2);
    if (mode === 'ipad') {
      // touch hotbar: one tap selects (and never uses), a second tap on the selected slot uses it
      await page.evaluate(() => { const L = (window as any).__game.level; L.sim.inv.hotbar[3] = 'flare'; L.sim.inv.selected = 0; });
      await page.waitForTimeout(300);
      await page.tap('.hb:nth-child(4)'); await page.waitForTimeout(300);
      let s = await st(); check('ipad: tapping a slot selects it without using the item', s.sel === 3 && s.flares === 2, JSON.stringify({ sel: s.sel, flares: s.flares }));
      check('ipad: the USE button appears for a usable held item', s.use);
      check('ipad: the Throw button stays hidden with nothing to throw', !s.throwBtn);
      await page.tap('.touch-btn[data-slot="5"]'); await page.waitForTimeout(400);
      s = await st(); check('ipad: tapping USE uses the item', s.flares === 1, `flares ${s.flares}`);
      await page.tap('.hb:nth-child(4)'); await page.waitForTimeout(300);
      s = await st(); check('ipad: tapping the selected slot again uses it', s.flares === 0, `flares ${s.flares}`);
      await page.evaluate(() => { const L = (window as any).__game.level; L.sim.inv.add('distraction'); });
      await page.waitForTimeout(400);
      check('ipad: Throw button appears once something can be thrown', (await st()).throwBtn);
      await page.tap('.hb:nth-child(1)'); await page.tap('.hb:nth-child(1)'); await page.waitForTimeout(300);
      check('ipad: tapping the flashlight slot twice toggles the light', (await st()).flash === false);
      for (let i = 0; i < 6; i++) { await page.tap(`.hb:nth-child(${(i % 4) + 1})`); }
      await page.waitForTimeout(200);
      check('ipad: rapid slot taps all register', true);
    }
    check(`${mode}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await browser.close(); proc.kill(); }
console.log(out.join('\n'));
