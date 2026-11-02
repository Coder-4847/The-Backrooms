/** `npm run shots [-- --levels=testroom,placeholder --tiers=ultra,high,medium,low,potato --seed=7]` : fixed-seed screenshots into ./shots */
import { mkdirSync } from 'node:fs';
import { launch, startServer, openGame } from './browser';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const levels = arg('levels', 'testroom,placeholder').split(',');
const tiers = arg('tiers', 'ultra,high,medium,low,potato').split(',');
const seed = Number(arg('seed', '7'));
mkdirSync('shots', { recursive: true });

const { url, proc } = await startServer();
const browser = await launch();
try {
  const page = await openGame(browser, url, 1024, 576);
  for (const level of levels) for (const tier of tiers) {
    const t0 = Date.now();
    await page.evaluate(async ({ level, tier, seed }) => {
      const g = (window as any).__game;
      g.settings.set('tier', tier);
      await g.startLevel(level, seed, 'normal');
      const p = g.level.sim.player; const plan = g.level.plan;
      p.god = true;
      // fixed vantage: spawn point looking into the room
      p.place(plan.spawn.pos.x, plan.spawn.pos.z, 0.35);
      g.level.flashOn = tier !== 'potato';
    }, { level, tier, seed });
    // let post-processing/shadows settle for a handful of frames
    await page.evaluate(() => new Promise<void>((r) => { let n = 0; const f = () => (++n >= 4 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
    await page.screenshot({ path: `shots/${level}-${tier}.png`, timeout: 300000 });
    console.log(`shot ${level}/${tier} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    await page.evaluate(() => (window as any).__game.showMenu());
  }
} finally { await browser.close(); proc.kill(); }
