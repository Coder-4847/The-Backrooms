/** Item data table (spec 5.2-5.5). Adding an item = one entry. Grid size is in backpack cells. */
export type ItemKind = 'tool' | 'consumable' | 'key' | 'light' | 'document' | 'misc';

export interface UseEffect { health?: number; sanity?: number; hunger?: number; thirst?: number; battery?: number; /** seconds of light */ glow?: number }

export interface ItemDef {
  id: string; name: string; kind: ItemKind;
  w: number; h: number; weight: number; stack: number;
  use?: UseEffect;
  /** Counts as "secured" and is never lost on death (keys, core tools). */
  essential?: boolean;
  desc: string;
}

const I = (d: ItemDef): [string, ItemDef] => [d.id, d];

export const ITEMS: Record<string, ItemDef> = Object.fromEntries([
  I({ id: 'flashlight', name: 'Flashlight', kind: 'tool', w: 1, h: 2, weight: 0.4, stack: 1, essential: true, desc: 'Press G to toggle. Shake it (wiggle the mouse) to squeeze out a little charge.' }),
  I({ id: 'camcorder', name: 'Camcorder', kind: 'tool', w: 2, h: 1, weight: 0.6, stack: 1, essential: true, desc: 'Night vision on V. Has its own battery.' }),
  I({ id: 'battery', name: 'Battery', kind: 'consumable', w: 1, h: 1, weight: 0.1, stack: 4, use: { battery: 60 }, desc: 'Recharges the flashlight.' }),
  I({ id: 'almond_water', name: 'Almond Water', kind: 'consumable', w: 1, h: 1, weight: 0.5, stack: 4, use: { sanity: 25, thirst: 35, health: 5 }, desc: 'Sweet and faintly wrong. Calms the mind.' }),
  I({ id: 'cracker', name: 'Crackers', kind: 'consumable', w: 1, h: 1, weight: 0.2, stack: 4, use: { hunger: 22 }, desc: 'Dry. Better than nothing.' }),
  I({ id: 'bandage', name: 'Bandage', kind: 'consumable', w: 1, h: 1, weight: 0.1, stack: 4, use: { health: 30 }, desc: 'Stops the bleeding.' }),
  I({ id: 'glowstick', name: 'Glowstick', kind: 'light', w: 1, h: 1, weight: 0.1, stack: 4, use: { glow: 240 }, desc: 'Snap to light a spot for a few minutes.' }),
  I({ id: 'flare', name: 'Flare', kind: 'light', w: 1, h: 1, weight: 0.2, stack: 3, use: { glow: 60 }, desc: 'Burns bright for a minute. Hounds scatter from it; some things are drawn to it.' }),
  I({ id: 'fuse1', name: 'Fuse (red)', kind: 'key', w: 1, h: 1, weight: 0.2, stack: 1, essential: true, desc: 'A heavy ceramic fuse. Fits a transformer bay.' }),
  I({ id: 'fuse2', name: 'Fuse (blue)', kind: 'key', w: 1, h: 1, weight: 0.2, stack: 1, essential: true, desc: 'A heavy ceramic fuse. Fits a transformer bay.' }),
  I({ id: 'fuse3', name: 'Fuse (white)', kind: 'key', w: 1, h: 1, weight: 0.2, stack: 1, essential: true, desc: 'A heavy ceramic fuse. Fits a transformer bay.' }),
  I({ id: 'grapple', name: 'Grappling hook', kind: 'tool', w: 1, h: 2, weight: 1.0, stack: 1, essential: true, desc: 'Rope and a hook. Crosses chasms where you can anchor it.' }),
  I({ id: 'crowbar', name: 'Crowbar', kind: 'tool', w: 1, h: 2, weight: 1.2, stack: 1, essential: true, desc: 'Pries stuck doors and vents. Loud.' }),
  I({ id: 'rag', name: 'Rag', kind: 'misc', w: 1, h: 1, weight: 0.1, stack: 4, desc: 'Oily cloth. Useful in crafting.' }),
  I({ id: 'bottle', name: 'Empty bottle', kind: 'misc', w: 1, h: 1, weight: 0.2, stack: 4, desc: 'Glass. Breaks loudly when thrown.' }),
  I({ id: 'can', name: 'Tin can', kind: 'misc', w: 1, h: 1, weight: 0.2, stack: 6, desc: 'Empty and rattly.' }),
  I({ id: 'rope', name: 'Rope', kind: 'misc', w: 1, h: 1, weight: 0.4, stack: 3, desc: 'A few metres of cord.' }),
  I({ id: 'paper', name: 'Blank paper', kind: 'misc', w: 1, h: 1, weight: 0.05, stack: 4, desc: 'Clean enough to write on.' }),
  I({ id: 'marker_pen', name: 'Marker pen', kind: 'misc', w: 1, h: 1, weight: 0.05, stack: 1, desc: 'Still has ink.' }),
  I({ id: 'purify_tablet', name: 'Purifying tablet', kind: 'misc', w: 1, h: 1, weight: 0.05, stack: 4, desc: 'Makes dirty water drinkable.' }),
  I({ id: 'dirty_water', name: 'Dirty water', kind: 'misc', w: 1, h: 1, weight: 0.5, stack: 3, use: { thirst: 15, health: -8 }, desc: 'Drinkable, barely. Better purified.' }),
  I({ id: 'canned_food', name: 'Canned food', kind: 'misc', w: 1, h: 1, weight: 0.4, stack: 3, desc: 'Needs an opener or a crowbar.' }),
  I({ id: 'can_opener', name: 'Can opener', kind: 'tool', w: 1, h: 1, weight: 0.1, stack: 1, essential: true, desc: 'Opens cans. Cooking uses it.' }),
  I({ id: 'cooked_meal', name: 'Cooked meal', kind: 'consumable', w: 1, h: 1, weight: 0.4, stack: 2, use: { hunger: 60, health: 10, sanity: 8 }, desc: 'Hot, salty, real.' }),
  I({ id: 'bottled_water', name: 'Clean water', kind: 'consumable', w: 1, h: 1, weight: 0.5, stack: 3, use: { thirst: 45 }, desc: 'Purified.' }),
  I({ id: 'distraction', name: 'Rattle bottle', kind: 'misc', w: 1, h: 1, weight: 0.3, stack: 3, desc: 'Throw it to draw attention (T).' }),
  I({ id: 'tripline', name: 'Tripline alarm', kind: 'light', w: 1, h: 1, weight: 0.6, stack: 2, use: { glow: 0 }, desc: 'Cans on a cord. Use to set it: it clatters when something crosses.' }),
  I({ id: 'radio', name: 'Radio', kind: 'tool', w: 1, h: 2, weight: 0.6, stack: 1, essential: true, desc: 'Use: broadcasts a lure for 20 s (loud, draws hounds). Static hisses near entities.' }),
  I({ id: 'hall_pass', name: 'Hall pass', kind: 'document', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Signed, stamped, valid.' }),
  I({ id: 'forged_pass', name: 'Forged pass', kind: 'document', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Convincing at a glance. It does not always pass inspection.' }),
  I({ id: 'key1', name: 'Brass key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a door nearby.' }),
  I({ id: 'key2', name: 'Steel key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a heavier door.' }),
  I({ id: 'key3', name: 'Cold key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a door nearby.' }),
]);

export const itemDef = (id: string): ItemDef => ITEMS[id] ?? { id, name: id.replace(/_/g, ' '), kind: 'tool', w: 1, h: 1, weight: 0.1, stack: 1, desc: '' };
