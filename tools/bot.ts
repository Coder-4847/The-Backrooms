/** `npm run bot -- --level=placeholder --seed=123 [--difficulty=normal] [--waypoints]` */
import { levelById, LEVELS } from '../src/levels/registry';
import { runBot } from '../src/levels/bot';
import { parseSeed } from '../src/gen/rng';
import type { DifficultyId } from '../src/core/difficulty';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const id = arg('level') ?? 'placeholder';
const def = levelById(id);
if (!def) { console.error(`unknown level "${id}". Available: ${LEVELS.map((l) => l.id).join(', ')}`); process.exit(2); }
const seed = parseSeed(arg('seed') ?? '123');
const difficulty = (arg('difficulty') ?? 'normal') as DifficultyId;
const plan = def.generate(seed);
const t0 = performance.now();
const r = runBot(plan, { difficulty, visitWaypoints: process.argv.includes('--waypoints') });
console.log(`${def.id} seed=${seed} rooms=${plan.rooms.length} keys=${plan.connections.filter((c) => c.lock).length}`);
console.log(r.completed ? `COMPLETED in ${r.seconds.toFixed(1)}s sim time (estimate ${plan.estSeconds.toFixed(0)}s), keys=${r.keysUsed}, waypoints=${r.waypointsVisited}` : `FAILED: ${r.reason} after ${r.seconds.toFixed(1)}s`);
console.log(`(${Math.round(performance.now() - t0)} ms wall clock)`);
process.exit(r.completed ? 0 : 1);
