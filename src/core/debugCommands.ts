/** Registers the debug console commands against a Game. Kept apart from game.ts for size. */
import { FUTURE_COMMANDS } from './debug';
import { LEVELS, levelById } from '../levels/registry';
import { runBot } from '../levels/bot';
import { TIERS, type TierId } from '../render/quality';
import { parseSeed } from '../gen/rng';
import { DIFFICULTY_ORDER, type DifficultyId } from './difficulty';
import type { Game } from './game';
import type { TierSetting } from './settings';

export function registerDebugCommands(game: Game): void {
  const r = game.debug;
  const lv = () => game.level;
  r.register({ name: 'help', help: 'list commands', run: (_a, api) => { r.list().forEach((c) => api.print(`${c.name.padEnd(11)} ${c.help}${c.phase ? `  [Phase ${c.phase}]` : ''}`)); } });
  r.register({ name: 'level', help: `level <id> [seed] [difficulty] : jump to a level (${LEVELS.map((l) => l.id).join(', ')})`, run: async (a, api) => {
    if (!a[0]) { api.print('usage: level <id> [seed]'); return; }
    await game.startLevel(a[0], a[1] ?? 'DEBUG', (a[2] as DifficultyId) ?? 'normal'); api.print(`loaded ${a[0]}`);
  } });
  r.register({ name: 'seed', help: 'seed : show the current level seed', run: (_a, api) => api.print(lv() ? `level seed ${lv()!.seed}` : 'no level') });
  r.register({ name: 'tier', help: 'tier <auto|ultra|high|medium|low|potato>', run: (a, api) => { game.settings.set('tier', (a[0] ?? 'auto') as TierSetting); api.print(`tier = ${game.tier().id}`); } });
  r.register({ name: 'scale', help: 'scale <0.35-1> : dynamic resolution', run: (a, api) => { game.gfx.setDynamicScale(Math.max(0.35, Math.min(1, Number(a[0] ?? 1)))); api.print(`render scale ${game.gfx.scale.toFixed(2)}`); } });
  r.register({ name: 'noclip', help: 'toggle free-fly camera', run: (_a, api) => { const p = lv()?.sim.player; if (!p) return api.print('no level'); p.noclip = !p.noclip; api.print(`noclip ${p.noclip}`); } });
  r.register({ name: 'god', help: 'toggle god mode', run: (_a, api) => { const p = lv()?.sim.player; if (!p) return api.print('no level'); p.god = !p.god; api.print(`god ${p.god}`); } });
  r.register({ name: 'timescale', help: 'timescale <0.1-20>', run: (a, api) => { game.loop.timeScale = Math.max(0.1, Math.min(20, Number(a[0] ?? 1))); api.print(`time scale ${game.loop.timeScale}`); } });
  r.register({ name: 'fps', help: 'toggle performance stats', run: (_a, api) => { game.settings.set('showFps', !game.settings.value.showFps); api.print(`stats ${game.settings.value.showFps}`); } });
  r.register({ name: 'overlay', help: 'overlay <nav|rooms|path|chunks> [on|off]', run: (a, api) => {
    const name = a[0]; if (!lv() || !name) return api.print('usage: overlay <nav|rooms|path|chunks> [on|off]');
    lv()!.setOverlay(name, a[1] !== 'off'); api.print(`${name} ${a[1] ?? 'on'}`);
  } });
  r.register({ name: 'tp', help: 'tp <x> <z>', run: (a, api) => { if (!lv()) return api.print('no level'); lv()!.teleport(Number(a[0]), Number(a[1])); } });
  r.register({ name: 'tpspawn', help: 'teleport to spawn', run: () => { const l = lv(); if (l) l.teleport(l.plan.spawn.pos.x, l.plan.spawn.pos.z); } });
  r.register({ name: 'tpexit', help: 'teleport next to the exit', run: () => { const l = lv(); if (l) l.teleport(l.plan.exit.pos.x - 1.2, l.plan.exit.pos.z); } });
  r.register({ name: 'tpw', help: 'tpw <n> : teleport to waypoint n', run: (a, api) => { const l = lv(); const w = l?.sim.waypoints[Number(a[0] ?? 0)]; if (!l || !w) return api.print('no such waypoint'); l.teleport(w.pos.x + 1, w.pos.z + 1); } });
  r.register({ name: 'stats', help: 'print level + render stats', run: (_a, api) => { const l = lv(); if (!l) return api.print('no level'); api.print(JSON.stringify({ ...l.stats(), ...game.gfx.stats(), fps: +game.fps.toFixed(1), scale: +game.gfx.scale.toFixed(2), tier: game.tier().id, workers: game.pool.inline ? 'inline' : 'workers' })); } });
  r.register({ name: 'bot', help: 'bot [level] [seed] : headless autopilot run', run: (a, api) => {
    const def = levelById(a[0] ?? lv()?.def.id ?? 'placeholder'); if (!def) return api.print('unknown level');
    const seed = a[1] ? parseSeed(a[1]) : lv()?.seed ?? 1;
    const res = runBot(def.generate(seed), { visitWaypoints: true });
    api.print(res.completed ? `completed in ${res.seconds.toFixed(0)}s sim time` : `FAILED: ${res.reason}`);
  } });
  r.register({ name: 'save', help: 'write the current slot', run: async (_a, api) => { await game.autosave(); api.print('saved'); } });
  r.register({ name: 'difficulty', help: `difficulty <${DIFFICULTY_ORDER.join('|')}>`, run: (a, api) => { game.settings.set('difficulty', (a[0] ?? 'normal') as DifficultyId); api.print(`new-game difficulty ${a[0]}`); } });
  r.register({ name: 'tiers', help: 'list tier definitions', run: (_a, api) => { (Object.keys(TIERS) as TierId[]).forEach((t) => api.print(`${t}: res ${TIERS[t].resolution}, lights ${TIERS[t].lights}, tex ${TIERS[t].textureSize}, post ${TIERS[t].post}`)); } });
  for (const f of FUTURE_COMMANDS) r.register({ name: f.name, help: f.help, phase: f.phase, run: () => {} });
}
