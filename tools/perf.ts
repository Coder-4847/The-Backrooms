/**
 * `npm run perf [-- --levels=placeholder --tiers=ultra,high,medium,low,potato --seconds=8 --throttle=4]`
 * Scripted flythrough per level and tier; prints a table and checks the spec 6.4 budgets.
 * Frame-time budgets are only judged on a real GPU: software renderers (SwiftShader) are flagged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, startServer, openGame } from './browser';
import type { PerfResult } from '../src/core/perf';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const levels = arg('levels', 'placeholder').split(',');
const tiers = arg('tiers', 'ultra,high,medium,low,potato').split(',');
const seconds = Number(arg('seconds', '8'));
const throttle = Number(arg('throttle', '1'));
const maxFrames = Number(arg('maxFrames', '400'));

const BUDGET: Record<string, { calls: number; tris: number; heapMb: number }> = {
  ultra: { calls: 1500, tris: 4_000_000, heapMb: 1500 }, high: { calls: 1500, tris: 3_000_000, heapMb: 1500 }, medium: { calls: 1000, tris: 1_500_000, heapMb: 1500 },
  low: { calls: 400, tris: 600_000, heapMb: 600 }, potato: { calls: 150, tris: 150_000, heapMb: 600 },
};
const FRAME_MS: Record<string, number> = { ultra: 12, high: 16.7, medium: 16.7, low: 22, potato: 33.3 };

const { url, proc } = await startServer();
const browser = await launch();
const results: PerfResult[] = [];
try {
  const page = await openGame(browser, url);
  if (throttle > 1) { const c = await page.context().newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
  for (const level of levels) for (const tier of tiers) {
    const r = (await page.evaluate((o) => (window as any).__runPerf(o), { level, seed: 1234, tier, seconds, maxFrames })) as PerfResult;
    results.push(r);
    await page.evaluate(() => (window as any).__game.showMenu());
  }
} finally { await browser.close(); proc.kill(); }

console.log(`\nPerf (${seconds}s flythrough per row${throttle > 1 ? `, CPU throttle x${throttle}` : ''})`);
console.log(results[0] ? `GPU: ${results[0].gpu}${results[0].software ? '  [SOFTWARE RENDERER: frame times are NOT representative]' : ''}` : '');
console.log(['level', 'tier', 'frames', 'avg ms', 'p99 ms', 'fps', '1%low', 'draws', 'tris', 'load ms', 'chunk ms', 'heap MB', 'scale'].map((h) => h.padEnd(10)).join(''));
let bad = 0;
for (const r of results) {
  console.log([r.level, r.tier, r.frames, r.avgMs.toFixed(1), r.p99Ms.toFixed(1), r.fps.toFixed(0), r.low1Fps.toFixed(0), `${r.callsAvg.toFixed(0)}/${r.callsMax}`, `${(r.trisAvg / 1000).toFixed(0)}k`, r.loadMs.toFixed(0), `${r.chunkAvgMs.toFixed(1)}/${r.chunkMaxMs.toFixed(0)}`, r.heapMb.toFixed(0), r.scale.toFixed(2)].map((c) => String(c).padEnd(10)).join(''));
  const b = BUDGET[r.tier];
  const issues: string[] = [];
  if (r.callsMax > b.calls) issues.push(`draw calls ${r.callsMax} > ${b.calls}`);
  if (r.trisMax > b.tris) issues.push(`triangles ${r.trisMax} > ${b.tris}`);
  if (r.heapMb > b.heapMb) issues.push(`heap ${r.heapMb.toFixed(0)}MB > ${b.heapMb}`);
  if (!r.software && r.avgMs > FRAME_MS[r.tier]) issues.push(`frame ${r.avgMs.toFixed(1)}ms > ${FRAME_MS[r.tier]}`);
  if (issues.length) { bad++; console.log(`   over budget: ${issues.join('; ')}`); }
}
mkdirSync('reports', { recursive: true });
writeFileSync('reports/perf.json', JSON.stringify(results, null, 2));
console.log(bad ? `\n${bad} row(s) over budget\n` : '\nAll rows within budget\n');
process.exit(bad ? 1 : 0);
