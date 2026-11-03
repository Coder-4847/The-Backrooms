/** `npm run mobile` : emulated phone (touch, portrait + landscape): UI fits, no horizontal scroll, touch controls appear in play. */
import { chromium } from 'playwright';
import { startServer } from './browser';

const { url, proc } = await startServer();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
let failed = 0;
const check = (n: string, ok: boolean, x = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); if (!ok) failed++; };
try {
  for (const [name, w, h] of [['portrait', 390, 844], ['landscape', 844, 390]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    await page.addInitScript('window.__name = (f) => f;');
    const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${url}?debug=1`);
    await page.waitForSelector('text=I understand', { timeout: 60000 });
    await page.tap('text=I understand'); await page.waitForSelector('.title', { timeout: 120000 });
    const fit = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, touch: matchMedia('(pointer: coarse)').matches }));
    check(`${name}: title fits the screen (no horizontal scroll)`, fit.sw <= fit.iw + 1, JSON.stringify(fit));
    check(`${name}: detected as a touch device`, fit.touch && (await page.evaluate(() => (window as any).__game.input.device)) === 'touch');
    await page.screenshot({ path: `shots/mobile-title-${name}.png` });
    await page.tap('text=New Game'); await page.tap('text=Begin');
    await page.waitForFunction(() => (window as any).__game.state === 'playing', null, { timeout: 180000 });
    await page.waitForTimeout(800);
    const vis = await page.evaluate(() => { const r = document.querySelector('.touch-root') as HTMLElement | null; return { shown: !!r && r.style.display !== 'none', btns: document.querySelectorAll('.touch-btn').length }; });
    check(`${name}: touch controls visible in play`, vis.shown && vis.btns >= 4, JSON.stringify(vis));
    // the contextual interact button: appears only with something in reach, shows the verb, a real tap works
    const btn = await page.evaluate(() => { const b = document.querySelector('.touch-interact') as HTMLElement | null; return b ? { hidden: b.hidden, text: b.textContent, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height } : null; });
    check(`${name}: Interact button is up next to the first door`, !!btn && !btn.hidden && btn.h >= 80, JSON.stringify(btn));
    check(`${name}: objective line tells you what to do`, ((await page.textContent('.objective')) ?? '').toLowerCase().includes('door'), (await page.textContent('.objective')) ?? '');
    await page.screenshot({ path: `shots/mobile-play-${name}.png` });
    await page.tap('.touch-interact');
    await page.waitForSelector('.panel, .screen', { timeout: 5000 }).catch(() => undefined);
    const opened = await page.evaluate(() => (window as any).__game.ui.panelOpen);
    check(`${name}: tapping Interact opens the door panel`, opened === true);
    await page.screenshot({ path: `shots/mobile-door-${name}.png` });
    await page.evaluate(() => (window as any).__game.ui.closePanel());
    // away from everything the button disappears
    await page.evaluate(() => { const p = (window as any).__game.level.sim.player; p.place(p.x, 3, 0); });
    await page.waitForTimeout(900);
    check(`${name}: Interact button hides when nothing is in reach`, await page.evaluate(() => (document.querySelector('.touch-interact') as HTMLElement).hidden));
    check(`${name}: no page errors`, errs.length === 0, errs.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally { await browser.close(); proc.kill(); }
process.exit(failed ? 1 : 0);
