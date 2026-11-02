/** Item data table (spec 5.2-5.5). Adding an item = one entry. Grid size is in backpack cells. */
export type ItemKind = 'tool' | 'consumable' | 'key' | 'light' | 'document';

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
  I({ id: 'key1', name: 'Brass key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a door nearby.' }),
  I({ id: 'key2', name: 'Steel key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a heavier door.' }),
  I({ id: 'key3', name: 'Cold key', kind: 'key', w: 1, h: 1, weight: 0.05, stack: 1, essential: true, desc: 'Opens a door nearby.' }),
]);

export const itemDef = (id: string): ItemDef => ITEMS[id] ?? { id, name: id.replace(/_/g, ' '), kind: 'tool', w: 1, h: 1, weight: 0.1, stack: 1, desc: '' };
