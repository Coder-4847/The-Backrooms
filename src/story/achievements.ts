/** Achievements (spec 8.6/Phase 5): a data table of predicates over the profile + current slot. Pure and testable. */
import type { Profile, SlotData } from '../core/save';
import { CAMPAIGN } from '../levels/campaign';

export interface Achievement { id: string; name: string; desc: string; test: (p: Profile, s: SlotData | null) => boolean }

const done = (s: SlotData | null, id: string) => !!s?.completed[id];
const has = (p: Profile, id: string) => p.achievements.includes(id);
const ENDINGS = ['escape', 'join', 'sacrifice', 'loop', 'true', 'secret'];

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_noclip', name: 'First Noclip', desc: 'Escape Level 0.', test: (_p, s) => done(s, 'level0') },
  { id: 'act1', name: 'Almond Outpost', desc: 'Finish the Schoolhouse.', test: (_p, s) => done(s, 'schoolhouse') },
  { id: 'act2', name: 'The Waystation', desc: 'Finish the Server Farm.', test: (_p, s) => done(s, 'serverfarm') },
  { id: 'act3', name: 'The Gantry', desc: 'Run for your life and survive.', test: (_p, s) => done(s, 'chase') },
  { id: 'any_ending', name: 'The Seventh Chair', desc: 'See any ending.', test: (p) => p.endings.length > 0 },
  ...ENDINGS.map((e) => ({ id: `end_${e}`, name: `Ending: ${e}`, desc: `See the ${e} ending.`, test: (p: Profile) => p.endings.includes(e) })),
  { id: 'all_endings', name: 'Every Door', desc: 'See all six endings.', test: (p) => ENDINGS.every((e) => p.endings.includes(e)) },
  { id: 'anchors', name: 'Five Small Things', desc: 'Find all five Anchors.', test: (_p, s) => (Number(s?.flags.anchors) || 0) >= 5 },
  { id: 'secret', name: 'The Hum Forgets', desc: 'Make the hum skip a beat.', test: (_p, s) => !!s?.flags.secret },
  { id: 'nightmare', name: 'Unbroken', desc: 'Finish the game on Nightmare or Hardcore.', test: (p) => (p.completedOn.finale ?? []).some((d) => d === 'nightmare' || d === 'hardcore') },
  { id: 'journal20', name: 'Archivist', desc: 'Collect 20 journal entries.', test: (p) => p.journal.length >= 20 },
  { id: 'crafter', name: 'Handy', desc: 'Craft 5 things.', test: (p) => (p.counters?.crafted ?? 0) >= 5 },
  { id: 'bestiary10', name: 'Field Guide', desc: 'Catalogue 10 entities.', test: (p) => Object.keys(p.bestiary).length >= 10 },
  { id: 'all_levels', name: 'Every Level', desc: 'Clear all 24 levels before the Finale.', test: (_p, s) => CAMPAIGN.slice(0, 24).every((c) => done(s, c.id)) },
  { id: 'speedrunner', name: 'Hurry Up', desc: 'Finish a speedrun.', test: (p) => Object.keys(p.bestTimes).some((k) => k.startsWith('speedrun:')) },
];

/** Evaluate everything; returns newly unlocked achievements (and records them). */
export function checkAchievements(p: Profile, s: SlotData | null): Achievement[] {
  const fresh = ACHIEVEMENTS.filter((a) => !has(p, a.id) && a.test(p, s));
  for (const a of fresh) p.achievements.push(a.id);
  return fresh;
}

/** Cosmetics and titles unlocked by progress (Phase 5: New Game+ carries these). */
export function unlocksFor(ending: string, difficulty: string, p: Profile): { cosmetics: string[]; titles: string[] } {
  const cosmetics: string[] = ['lens:amber'], titles: string[] = ['Survivor'];
  if (difficulty === 'nightmare' || difficulty === 'hardcore') { cosmetics.push('lens:gold'); titles.push('Unbroken'); }
  const all = ['escape', 'join', 'sacrifice', 'loop', 'true', 'secret'];
  if (all.every((e) => e === ending || p.endings.includes(e))) { cosmetics.push('lens:mono'); titles.push('Completionist'); }
  if (ending === 'true') titles.push('Anchor');
  return { cosmetics, titles };
}
