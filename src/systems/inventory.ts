/**
 * Inventory (spec 5.2): 4-slot hotbar (shortcuts to item types) + grid backpack. Items have a grid
 * size and weight; weight slightly lowers stamina regeneration. Pure state, fully testable.
 */
import { itemDef } from './items';
import type { InventoryState } from '../core/save';
import type { Rng } from '../gen/rng';
import type { DeathPenalty } from '../core/difficulty';

export const GRID_W = 6, GRID_H = 4;
export interface Stack { id: string; n: number; x: number; y: number }

export class Inventory {
  stacks: Stack[] = [];
  hotbar: (string | null)[] = [null, null, null, null];
  selected = 0;
  stash: { id: string; n: number }[] = [];

  private occupied(skip?: Stack): boolean[] {
    const g = new Array(GRID_W * GRID_H).fill(false);
    for (const s of this.stacks) {
      if (s === skip) continue;
      const d = itemDef(s.id);
      for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) g[(s.y + dy) * GRID_W + s.x + dx] = true;
    }
    return g;
  }

  canPlace(id: string, x: number, y: number, skip?: Stack): boolean {
    const d = itemDef(id);
    if (x < 0 || y < 0 || x + d.w > GRID_W || y + d.h > GRID_H) return false;
    const g = this.occupied(skip);
    for (let dy = 0; dy < d.h; dy++) for (let dx = 0; dx < d.w; dx++) if (g[(y + dy) * GRID_W + x + dx]) return false;
    return true;
  }

  private findSpot(id: string): { x: number; y: number } | null {
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) if (this.canPlace(id, x, y)) return { x, y };
    return null;
  }

  /** Add items; returns how many did NOT fit. Auto-assigns useful items to free hotbar slots. */
  add(id: string, n = 1): number {
    const d = itemDef(id);
    let left = n;
    for (const s of this.stacks) {
      if (s.id !== id || left <= 0) continue;
      const take = Math.min(left, d.stack - s.n);
      s.n += take; left -= take;
    }
    while (left > 0) {
      const spot = this.findSpot(id);
      if (!spot) break;
      const take = Math.min(left, d.stack);
      this.stacks.push({ id, n: take, ...spot }); left -= take;
    }
    if (left < n && d.kind !== 'key' && !this.hotbar.includes(id)) { const i = this.hotbar.indexOf(null); if (i >= 0) this.hotbar[i] = id; }
    return left;
  }

  count(id: string): number { return this.stacks.reduce((a, s) => a + (s.id === id ? s.n : 0), 0); }
  has(id: string): boolean { return this.count(id) > 0; }

  remove(id: string, n = 1): boolean {
    if (this.count(id) < n) return false;
    let left = n;
    for (const s of [...this.stacks].reverse()) {
      if (s.id !== id || left <= 0) continue;
      const take = Math.min(left, s.n);
      s.n -= take; left -= take;
      if (s.n === 0) this.stacks.splice(this.stacks.indexOf(s), 1);
    }
    return true;
  }

  /** Move a stack to a new cell (drag and drop). */
  move(s: Stack, x: number, y: number): boolean {
    if (!this.canPlace(s.id, x, y, s)) return false;
    s.x = x; s.y = y; return true;
  }

  /** Weight in kg-ish units; stamina regen is scaled by `weightFactor`. */
  get weight(): number { return this.stacks.reduce((a, s) => a + itemDef(s.id).weight * s.n, 0); }
  get weightFactor(): number { return Math.max(0.6, 1 - Math.max(0, this.weight - 4) * 0.04); }

  /** Item id selected on the hotbar, if the player still has some. */
  get held(): string | null { const id = this.hotbar[this.selected]; return id && this.has(id) ? id : null; }

  toState(): InventoryState {
    return { hotbar: [...this.hotbar], backpack: this.stacks.map((s) => ({ id: s.id, n: s.n })), stash: this.stash.map((s) => ({ ...s })) };
  }

  static fromState(st: InventoryState): Inventory {
    const inv = new Inventory();
    for (const b of st.backpack) inv.add(b.id, b.n);
    inv.hotbar = [...st.hotbar];
    inv.stash = st.stash.map((s) => ({ ...s }));
    return inv;
  }

  /** Starting kit for a new run. */
  static starter(): Inventory { const i = new Inventory(); i.add('flashlight'); i.add('camcorder'); i.add('battery', 1); i.add('almond_water', 1); return i; }

  /** Stash transfer helpers (hub lockers). */
  stashIn(id: string, n = 1): boolean {
    if (!this.remove(id, n)) return false;
    const e = this.stash.find((s) => s.id === id);
    if (e) e.n += n; else this.stash.push({ id, n });
    return true;
  }
  stashOut(id: string, n = 1): boolean {
    const e = this.stash.find((s) => s.id === id);
    if (!e || e.n < n || this.add(id, n) > 0) { return false; }
    e.n -= n; if (e.n === 0) this.stash.splice(this.stash.indexOf(e), 1);
    return true;
  }
}

/** Death penalty (spec 5.7) applied to the checkpoint inventory. Essentials (tools, keys) are always kept. */
export function applyDeathPenalty(inv: Inventory, penalty: DeathPenalty, rng: Rng): void {
  const lossRate = penalty === 'loseUnsecured' ? 0.5 : penalty === 'loseMost' ? 0.8 : penalty === 'loseAllCarried' ? 1 : 0;
  if (lossRate === 0) return;
  for (const s of [...inv.stacks]) {
    if (itemDef(s.id).essential) continue;
    let lose = 0;
    for (let i = 0; i < s.n; i++) if (rng.chance(lossRate)) lose++;
    inv.remove(s.id, lose);
  }
}
