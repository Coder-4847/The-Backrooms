/** `npm run validate:levels [-- --seeds=200 --level=id]` : pass/fail table over many seeds. */
import { LEVELS } from '../src/levels/registry';
import { validateLevel } from '../src/gen/validate';
import { DEFAULT_SEEDS, optionsFor } from './validate-config';
import { runBot } from '../src/levels/bot';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const seeds = Number(arg('seeds') ?? DEFAULT_SEEDS);
const only = arg('level');

let bad = 0;
console.log(`\nLevel validation (${seeds} seeds each)\n`);
console.log('level'.padEnd(16) + 'result'.padEnd(8) + 'failed'.padEnd(8) + 'bot'.padEnd(10) + 'ms');
for (const def of LEVELS.filter((l) => !only || l.id === only)) {
  const r = validateLevel(def, seeds, optionsFor(def.id));
  // the autopilot bot must be able to finish the level through the real simulation
  const botSeeds = Math.min(seeds, 40);
  let botOk = 0;
  for (let i = 0; i < botSeeds; i++) {
    const res = runBot(def.generate(1000 + i * 7919), { visitWaypoints: true });
    if (res.completed) botOk++; else r.failures.push({ seed: 1000 + i * 7919, errors: [`bot failed: ${res.reason}`] });
  }
  console.log(def.id.padEnd(16) + (r.failures.length ? 'FAIL' : 'pass').padEnd(8) + String(r.failures.length).padEnd(8) + `${botOk}/${botSeeds}`.padEnd(10) + Math.round(r.ms));
  for (const f of r.failures.slice(0, 5)) console.log(`   seed ${f.seed}: ${f.errors.slice(0, 3).join('; ')}`);
  if (r.failures.length) bad++;
}
console.log(bad ? `\n${bad} level(s) FAILED\n` : '\nAll levels passed\n');
process.exit(bad ? 1 : 0);
