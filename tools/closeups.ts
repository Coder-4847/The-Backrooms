/** `npx tsx tools/closeups.ts [--ents=stick,hound --tier=high --out=shots]`: close-up screenshots of entities and the held items (visual review). */
import { mkdirSync } from 'node:fs';
import { launch, startServer, openGame } from './browser';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const ents = arg('ents', 'stick,hound').split(',').filter(Boolean);
const items = arg('items', '').split(',').filter(Boolean);
const tier = arg('tier', 'high');
const out = arg('out', 'shots');
const tell = process.argv.includes('--tell');
const dist = Number(arg('dist', '2.6'));
mkdirSync(out, { recursive: true });

const { url, proc } = await startServer();
const browser = await launch();
try {
  const page = await openGame(browser, url, 1024, 576);
  await page.evaluate(() => { (window as any).__entLow = { hound: 1, crawler: 1, leech: 1 }; });
  await page.evaluate(async ({ tier }) => { const g = (window as any).__game; g.settings.set('tier', tier); await g.startLevel('level0', 7, 'normal'); }, { tier });
  const settle = () => page.evaluate(() => new Promise<void>((r) => { let n = 0; const f = () => (++n >= 6 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  for (const id of ents) {
    await page.evaluate(({ id, tell, dist }) => {
      const g = (window as any).__game, s = g.level.sim, p = s.player, plan = g.level.plan;
      p.god = true; s.ew.entities.length = 0; s.director.phase = 'quiet';
      p.place(plan.spawn.pos.x, plan.spawn.pos.z, 0.35); p.pitch = (window as any).__entLow?.[id] ? -0.45 : 0;
      const f = { x: -Math.sin(0.35), z: -Math.cos(0.35) };
      const e = s.ew.spawn(id, p.x + f.x * dist, p.z + f.z * dist); e.state = tell ? 'tell' : 'flee'; e.yaw = p.yaw + Math.PI; e.data.observe = true;
      s.ew.update = () => {};
    }, { id, tell, dist });
    await settle();
    await page.screenshot({ path: `${out}/close-${id}-${tier}${tell ? '-tell' : ''}.png`, timeout: 300000 });
    console.log('shot', id);
  }
  for (const id of items) {
    await page.evaluate(({ id }) => { const s = (window as any).__game.level.sim; s.ew.entities.length = 0; s.inv.add(id); const i = s.inv.hotbar.indexOf(id); if (i >= 0) s.inv.selected = i; else { s.inv.hotbar[0] = id; s.inv.selected = 0; } }, { id });
    await settle();
    await page.screenshot({ path: `${out}/held-${id}-${tier}.png`, timeout: 300000 });
    console.log('held', id);
  }
} finally { await browser.close(); proc.kill(); }
