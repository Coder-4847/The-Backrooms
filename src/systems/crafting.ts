/**
 * Crafting (spec 5.5): simple, discoverable recipes. A recipe is "discovered" the first time the
 * player holds all its ingredients; kitchen recipes need the hub kitchen. Pure and testable.
 */
import type { Inventory } from './inventory';

export interface Recipe { id: string; name: string; in: Record<string, number>; out: Record<string, number>; station?: 'kitchen'; hint: string }

export const RECIPES: Recipe[] = [
  { id: 'rattle', name: 'Rattle bottle', in: { bottle: 1, rag: 1 }, out: { distraction: 1 }, hint: 'A rag stuffed in a bottle makes a loud, throwable distraction.' },
  { id: 'tripline', name: 'Tripline alarm', in: { can: 2, rope: 1 }, out: { tripline: 1 }, hint: 'Cans on a cord. Something stepping on it will clatter them.' },
  { id: 'marker', name: 'Marker glowstick', in: { glowstick: 1, rope: 1 }, out: { glowstick: 1 }, hint: 'Tie a glowstick to a cord to mark a route (lasts like a normal glowstick).' },
  { id: 'purify', name: 'Purify water', in: { dirty_water: 1, purify_tablet: 1 }, out: { bottled_water: 1 }, hint: 'A tablet makes dirty water safe.' },
  { id: 'forge', name: 'Forge a hall pass', in: { paper: 1, marker_pen: 1 }, out: { forged_pass: 1 }, hint: 'Paper and a marker. Convincing at a glance.' },
  { id: 'medkit', name: 'Field dressing', in: { bandage: 1, rag: 1 }, out: { bandage: 2 }, hint: 'Clean the rag, cut it up: one bandage becomes two.' },
  { id: 'meal', name: 'Cook a meal', in: { canned_food: 1, can_opener: 1 }, out: { cooked_meal: 1, can_opener: 1 }, station: 'kitchen', hint: 'Best value food. Needs the hub kitchen.' },
  { id: 'stew', name: 'Hot almond stew', in: { canned_food: 1, almond_water: 1 }, out: { cooked_meal: 2 }, station: 'kitchen', hint: 'Almond water in the pot stretches a can into two meals.' },
];

export const canCraft = (inv: Inventory, r: Recipe, atKitchen: boolean): boolean =>
  (!r.station || (r.station === 'kitchen' && atKitchen)) && Object.entries(r.in).every(([id, n]) => inv.count(id) >= n);

/** Consume inputs, add outputs. Returns false (and changes nothing) if it cannot be done or the pack is full. */
export function craft(inv: Inventory, r: Recipe, atKitchen: boolean): boolean {
  if (!canCraft(inv, r, atKitchen)) return false;
  const snap = inv.toState();
  for (const [id, n] of Object.entries(r.in)) inv.remove(id, n);
  for (const [id, n] of Object.entries(r.out)) {
    if (inv.add(id, n) > 0) { // no room: roll everything back
      inv.stacks = [];
      for (const b of snap.backpack) inv.add(b.id, b.n);
      inv.hotbar = [...snap.hotbar];
      return false;
    }
  }
  return true;
}

/** Recipes the player has "discovered" (held all ingredients at least once). */
export function discover(inv: Inventory, known: Set<string>): string[] {
  const fresh: string[] = [];
  for (const r of RECIPES) if (!known.has(r.id) && Object.entries(r.in).every(([id, n]) => inv.count(id) >= n)) { known.add(r.id); fresh.push(r.id); }
  return fresh;
}
