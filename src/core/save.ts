/**
 * Save system (spec 4.5). Three slots + a global profile that survives slot deletion.
 * Corruption-safe writes: write to a temp key, read it back and verify, then swap into place
 * (the previous good copy is kept as one rolling backup). Versioned schema with migrations.
 */
import type { KV } from './storage';
import type { DifficultyId } from './difficulty';

export const SAVE_VERSION = 3;
export const PROFILE_VERSION = 1;
export const SLOT_COUNT = 3;

/** `stash` only exists in saves from before the hub was removed; loading folds it into the backpack. */
export interface InventoryState { hotbar: (string | null)[]; backpack: { id: string; n: number }[]; stash?: { id: string; n: number }[] }
export interface PlayerStats { health: number; stamina: number; sanity: number; hunger: number; thirst: number }

export interface SlotData {
  version: number;
  slot: number;
  name: string;
  difficulty: DifficultyId;
  runSeed: string;
  levelSeeds: Record<string, number>;
  /** Furthest campaign level index reached (0-based). Levels up to this one can be replayed from the menu. */
  frontier: number;
  completed: Record<string, { bestTime: number; difficulty: DifficultyId }>;
  /** Last checkpoint snapshot (level id + waypoint index + stats at that moment). */
  checkpoint: {
    levelId: string; waypoint: number; time: number; inventory: InventoryState; stats: PlayerStats;
    /** Everything needed to rebuild the level at this checkpoint (seed text, mode, snapshot of pickups/doors/keys). */
    seed?: string; mode?: 'campaign' | 'replay'; difficulty?: DifficultyId; index?: number; deaths?: number; sim?: unknown;
  } | null;
  inventory: InventoryState;
  stats: PlayerStats;
  npcs: Record<string, unknown>;
  flags: Record<string, boolean | number | string>;
  notesFound: string[];
  encounters: string[];
  manualSavesThisLevel: number;
  playtime: number;
  createdAt: number;
  updatedAt: number;
  thumbnail: string | null;
}

export interface Profile {
  version: number;
  settings: Record<string, unknown>;
  endings: string[];
  bestiary: Record<string, { discovered: number; learned: string[] }>;
  journal: string[];
  cosmetics: string[];
  titles: string[];
  bestTimes: Record<string, number>;
  completedOn: Record<string, DifficultyId[]>;
  achievements: string[];
  ngPlus: string[];
  firstLaunchAck: boolean;
  /** Misc counters (crafts, hints shown, ...). Optional so old profiles load. */
  counters?: Record<string, number>;
  lastBenchmarkTier: string | null;
}

export function newInventory(): InventoryState { return { hotbar: [null, null, null, null], backpack: [] }; }
export function newStats(): PlayerStats { return { health: 100, stamina: 100, sanity: 100, hunger: 100, thirst: 100 }; }

export function newSlot(slot: number, difficulty: DifficultyId, runSeed: string, now = Date.now()): SlotData {
  return {
    version: SAVE_VERSION, slot, name: `Wanderer ${slot}`, difficulty, runSeed, levelSeeds: {}, frontier: 0, completed: {},
    checkpoint: null, inventory: newInventory(), stats: newStats(), npcs: {}, flags: {}, notesFound: [], encounters: [],
    manualSavesThisLevel: 0, playtime: 0, createdAt: now, updatedAt: now, thumbnail: null,
  };
}

export function newProfile(): Profile {
  return {
    version: PROFILE_VERSION, settings: {}, endings: [], bestiary: {}, journal: [], cosmetics: [], titles: [],
    bestTimes: {}, completedOn: {}, achievements: [], ngPlus: [], firstLaunchAck: false, lastBenchmarkTier: null,
  };
}

/** Migrations: each takes data at version N and returns version N+1. Add one per schema change. */
const SLOT_MIGRATIONS: Record<number, (d: any) => any> = {
  // v1 -> v2: added manualSavesThisLevel + thumbnail
  1: (d) => ({ ...d, version: 2, manualSavesThisLevel: d.manualSavesThisLevel ?? 0, thumbnail: d.thumbnail ?? null }),
  // v2 -> v3: the hub (and its stash lockers) was removed: stashed items join the backpack
  2: (d) => {
    const fold = (inv: any) => (inv ? { ...inv, backpack: [...(inv.backpack ?? []), ...(inv.stash ?? [])], stash: [] } : inv);
    return { ...d, version: 3, inventory: fold(d.inventory), checkpoint: d.checkpoint ? { ...d.checkpoint, inventory: fold(d.checkpoint.inventory) } : d.checkpoint };
  },
};
const PROFILE_MIGRATIONS: Record<number, (d: any) => any> = {};

function migrate<T extends { version: number }>(data: any, target: number, table: Record<number, (d: any) => any>): T {
  let d = data;
  while (d.version < target) {
    const step = table[d.version];
    if (!step) throw new Error(`no migration from v${d.version}`);
    d = step(d);
  }
  return d as T;
}

export const slotKey = (n: number) => `slot${n}`;
export const PROFILE_KEY = 'profile';

export class SaveManager {
  constructor(private kv: KV) {}
  get storageKind() { return this.kv.kind; }

  /** Atomic write: temp -> verify -> move current to backup -> swap. */
  private async safeWrite(key: string, json: string): Promise<void> {
    const tmp = key + '.tmp';
    await this.kv.set(tmp, json);
    if ((await this.kv.get(tmp)) !== json) throw new Error('write verification failed');
    const prev = await this.kv.get(key);
    if (prev !== null) await this.kv.set(key + '.bak', prev);
    await this.kv.set(key, json);
    await this.kv.delete(tmp);
  }

  /** Read a key, falling back to its backup if the main copy is missing or corrupt. */
  private async safeRead<T extends { version: number }>(key: string, target: number, table: Record<number, (d: any) => any>): Promise<T | null> {
    for (const k of [key, key + '.bak']) {
      const raw = await this.kv.get(k);
      if (raw === null) continue;
      try { return migrate<T>(JSON.parse(raw), target, table); } catch { /* try the backup */ }
    }
    return null;
  }

  async loadSlot(n: number): Promise<SlotData | null> { return this.safeRead<SlotData>(slotKey(n), SAVE_VERSION, SLOT_MIGRATIONS); }

  async saveSlot(data: SlotData): Promise<void> {
    data.updatedAt = Date.now();
    await this.safeWrite(slotKey(data.slot), JSON.stringify(data));
  }

  async deleteSlot(n: number): Promise<void> {
    for (const k of [slotKey(n), slotKey(n) + '.bak', slotKey(n) + '.tmp']) await this.kv.delete(k);
  }

  async listSlots(): Promise<(SlotData | null)[]> {
    return Promise.all(Array.from({ length: SLOT_COUNT }, (_, i) => this.loadSlot(i + 1)));
  }

  async loadProfile(): Promise<Profile> {
    const p = await this.safeRead<Profile>(PROFILE_KEY, PROFILE_VERSION, PROFILE_MIGRATIONS);
    return { ...newProfile(), ...(p ?? {}) };
  }

  async saveProfile(p: Profile): Promise<void> { await this.safeWrite(PROFILE_KEY, JSON.stringify(p)); }

  /** Export a slot (n) or everything (null) as a JSON string. */
  async exportData(n: number | null): Promise<string> {
    if (n !== null) return JSON.stringify({ kind: 'noclip-slot', slot: await this.loadSlot(n) });
    return JSON.stringify({ kind: 'noclip-all', profile: await this.loadProfile(), slots: await this.listSlots() });
  }

  /** Import previously exported data. `targetSlot` redirects a single-slot import. */
  async importData(json: string, targetSlot?: number): Promise<void> {
    const obj = JSON.parse(json);
    if (obj.kind === 'noclip-slot' && obj.slot) {
      const s = migrate<SlotData>(obj.slot, SAVE_VERSION, SLOT_MIGRATIONS);
      if (targetSlot) s.slot = targetSlot;
      await this.saveSlot(s);
    } else if (obj.kind === 'noclip-all') {
      await this.saveProfile(migrate<Profile>(obj.profile, PROFILE_VERSION, PROFILE_MIGRATIONS));
      for (const s of obj.slots as (SlotData | null)[]) if (s) await this.saveSlot(migrate<SlotData>(s, SAVE_VERSION, SLOT_MIGRATIONS));
    } else throw new Error('unrecognised save file');
  }

  /** "Delete data": wipes all slots and the profile. */
  async wipeAll(): Promise<void> {
    for (const k of await this.kv.keys()) await this.kv.delete(k);
  }

  /** Hardcore permadeath: delete the slot, keep the profile (endings, bestiary, unlocks). */
  async permadeath(n: number): Promise<void> { await this.deleteSlot(n); }

  // ---- gameplay-facing helpers (pure state transitions) ----

  /** Level completion: record best time and advance the frontier (the furthest level reached, which can be replayed). */
  static completeLevel(s: SlotData, levelIndex: number, levelId: string, time: number, totalLevels: number): void {
    const prev = s.completed[levelId];
    if (!prev || time < prev.bestTime) s.completed[levelId] = { bestTime: time, difficulty: s.difficulty };
    s.frontier = Math.min(Math.max(s.frontier, levelIndex + 1), totalLevels - 1);
    s.checkpoint = null;
    s.manualSavesThisLevel = 0;
  }

  /** Whether a manual save is currently allowed under the difficulty rules. */
  static canManualSave(s: SlotData, rule: 'unlimited' | 'limitedPerLevel' | 'none', limit: number, atSafeSpot: boolean): boolean {
    if (!atSafeSpot || rule === 'none') return false;
    return rule === 'unlimited' || s.manualSavesThisLevel < limit;
  }
}
