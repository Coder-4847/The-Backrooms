/**
 * The single difficulty data table (spec 5.7). Every number the game uses to scale pressure
 * lives here so it is easy to tune and easy to test. Difficulty never changes layouts.
 */

export type DifficultyId = 'easy' | 'normal' | 'hard' | 'nightmare' | 'hardcore';
export type DeathPenalty = 'keepAll' | 'loseUnsecured' | 'loseMost' | 'loseAllCarried' | 'permadeath';
export type ScareIntensity = 'relaxed' | 'standard' | 'brutal';

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  intent: string;
  description: string;
  /** 0 = off. Multiplier on hunger/thirst drain. */
  hungerRate: number;
  /** Multiplier on loot quantity. */
  supply: number;
  entitySpeed: number;
  entityPerception: number;
  /** Multiplier on the warning time entities give (bigger = more forgiving). */
  tellTime: number;
  sanityDrain: number;
  batteryDrain: number;
  damageTaken: number;
  deathPenalty: DeathPenalty;
  /** Waypoint (mid-level checkpoint) count range: [short level, big level]. */
  waypoints: [number, number];
  manualSave: 'unlimited' | 'limitedPerLevel' | 'none';
  /** Manual saves allowed per level when `limitedPerLevel`. */
  manualSaveLimit: number;
  /** Director: 1 = standard breathers; <1 fewer breathers; also extra ambush weight. */
  breather: number;
  ambush: number;
  /** Whether dying wipes the slot. */
  permadeath: boolean;
}

export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare', 'hardcore'];

export const DIFFICULTIES: Record<DifficultyId, DifficultyDef> = {
  easy: {
    id: 'easy', label: 'Easy', intent: 'Explore and enjoy the atmosphere',
    description: 'No hunger or thirst. Plentiful supplies, slow entities, long warnings. You keep everything when you die.',
    hungerRate: 0, supply: 1.5, entitySpeed: 0.8, entityPerception: 0.8, tellTime: 1.5,
    sanityDrain: 0.6, batteryDrain: 0.6, damageTaken: 0.6, deathPenalty: 'keepAll',
    waypoints: [3, 3], manualSave: 'unlimited', manualSaveLimit: 99, breather: 1.5, ambush: 0.5, permadeath: false,
  },
  normal: {
    id: 'normal', label: 'Normal', intent: 'The intended experience',
    description: 'Slow hunger, balanced supplies, standard entities. Dying costs the supplies you had not secured.',
    hungerRate: 0.6, supply: 1, entitySpeed: 1, entityPerception: 1, tellTime: 1,
    sanityDrain: 1, batteryDrain: 1, damageTaken: 1, deathPenalty: 'loseUnsecured',
    waypoints: [2, 3], manualSave: 'unlimited', manualSaveLimit: 99, breather: 1, ambush: 1, permadeath: false,
  },
  hard: {
    id: 'hard', label: 'Hard', intent: 'Tense, mistakes hurt',
    description: 'Normal-speed hunger, scarce supplies, fast and sharp entities, short warnings. Dying loses most supplies.',
    hungerRate: 1, supply: 0.7, entitySpeed: 1.15, entityPerception: 1.2, tellTime: 0.7,
    sanityDrain: 1.4, batteryDrain: 1.4, damageTaken: 1.5, deathPenalty: 'loseMost',
    waypoints: [2, 2], manualSave: 'unlimited', manualSaveLimit: 99, breather: 0.7, ambush: 1.3, permadeath: false,
  },
  nightmare: {
    id: 'nightmare', label: 'Nightmare', intent: 'Brutal, supplies and nerves tested',
    description: 'Fast hunger, very scarce supplies, very high perception, minimal warnings, rare breathers. Few saves. Dying loses everything carried.',
    hungerRate: 1.5, supply: 0.5, entitySpeed: 1.3, entityPerception: 1.5, tellTime: 0.4,
    sanityDrain: 2, batteryDrain: 2, damageTaken: 2, deathPenalty: 'loseAllCarried',
    waypoints: [1, 2], manualSave: 'limitedPerLevel', manualSaveLimit: 2, breather: 0.3, ambush: 2, permadeath: false,
  },
  hardcore: {
    id: 'hardcore', label: 'Hardcore', intent: 'One life, no mercy',
    description: 'Nightmare pressure with permadeath: the save is deleted and the run ends. No mid-level saves, only level-complete autosaves.',
    hungerRate: 1.5, supply: 0.5, entitySpeed: 1.3, entityPerception: 1.5, tellTime: 0.4,
    sanityDrain: 2, batteryDrain: 2, damageTaken: 2, deathPenalty: 'permadeath',
    waypoints: [0, 0], manualSave: 'none', manualSaveLimit: 0, breather: 0.3, ambush: 2, permadeath: true,
  },
};

export const SCARE_MULTIPLIER: Record<ScareIntensity, number> = { relaxed: 0.7, standard: 1, brutal: 1.35 };

/** Number of waypoints a level of `size` (0..1, from critical path length) offers at a difficulty. */
export function waypointCountFor(d: DifficultyId, size: number): number {
  const [lo, hi] = DIFFICULTIES[d].waypoints;
  return size >= 0.5 ? hi : lo;
}

/** Effective per-level intensity: level dial (0-1) scaled by the scare setting. */
export function effectiveIntensity(levelDial: number, scare: ScareIntensity): number {
  return Math.min(1.5, levelDial * SCARE_MULTIPLIER[scare]);
}

/** Difficulty can be lowered later but never raised mid-run on Hardcore. */
export function canChangeDifficulty(from: DifficultyId, to: DifficultyId): boolean {
  if (from === 'hardcore') return to === 'hardcore';
  if (to === 'hardcore') return false;
  return DIFFICULTY_ORDER.indexOf(to) <= DIFFICULTY_ORDER.indexOf(from);
}
