/**
 * `npm run balance [-- --seeds=3]` : balance report. The bot is dumb (it walks straight through entities,
 * sprints in bursts, never hides or uses items), so deaths here mean "pressure exists", not "unfair".
 * Runs every campaign level x difficulty with active entities and NO god mode.
 */
import { LEVELS, levelById } from '../src/levels/registry';
import { runBot } from '../src/levels/bot';
import type { DifficultyId } from '../src/core/difficulty';

const arg = (n: string, d: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const seeds = Number(arg('seeds', '3'));
const diffs: DifficultyId[] = ['easy', 'normal', 'nightmare'];
console.log(`\nBalance report (${seeds} seeds, dumb bot, active entities, no god mode)\n`);
console.log('level'.padEnd(14) + diffs.map((d) => d.padEnd(12)).join('') + 'median sim time');
for (const def of LEVELS.filter((l) => !l.dev && l.id !== 'finale')) {
  const times: number[] = []; let row = def.id.padEnd(14);
  for (const d of diffs) {
    let ok = 0;
    for (let i = 0; i < seeds; i++) { const r = runBot(def.generate(4000 + i * 389), { difficulty: d, mode: 'active', god: false, sprint: true, maxSeconds: 900 }); if (r.completed) { ok++; times.push(r.seconds); } }
    row += `${ok}/${seeds} clear`.padEnd(12);
  }
  times.sort((a, b) => a - b);
  console.log(row + (times.length ? `${Math.round(times[Math.floor(times.length / 2)])} s` : '-'));
  void levelById;
}
console.log('');
