import { describe, expect, it } from 'vitest';
import { CAMPAIGN, reachedLevelIndexes } from '../src/levels/registry';
import { MemoryKV } from '../src/core/storage';
import { SAVE_VERSION, SaveManager, newSlot } from '../src/core/save';
import { Inventory } from '../src/systems/inventory';

describe('the campaign without a hub', () => {
  it('a new save has reached only Level 0; finishing a level reaches the next one', () => {
    const s = newSlot(1, 'normal', 'x');
    expect(reachedLevelIndexes(s.frontier)).toEqual([0]);
    SaveManager.completeLevel(s, 0, 'level0', 120, CAMPAIGN.length);
    expect(s.frontier).toBe(1); expect(reachedLevelIndexes(s.frontier)).toEqual([0, 1]);
    SaveManager.completeLevel(s, 1, 'level1', 200, CAMPAIGN.length);
    expect(reachedLevelIndexes(s.frontier)).toEqual([0, 1, 2]);
  });
  it('replaying an earlier level never moves the frontier back', () => {
    const s = newSlot(1, 'normal', 'x'); s.frontier = 5;
    SaveManager.completeLevel(s, 2, 'level2', 99, CAMPAIGN.length);
    expect(s.frontier).toBe(5);
    expect(reachedLevelIndexes(s.frontier)).toHaveLength(6);
  });
  it('the last level never reaches past the end', () => {
    const s = newSlot(1, 'normal', 'x'); s.frontier = CAMPAIGN.length - 1;
    SaveManager.completeLevel(s, CAMPAIGN.length - 1, 'finale', 1, CAMPAIGN.length);
    expect(s.frontier).toBe(CAMPAIGN.length - 1);
    expect(reachedLevelIndexes(s.frontier)).toHaveLength(CAMPAIGN.length);
  });
  it('saves from the hub era load: version bumps and stash items join the backpack (slot and checkpoint)', async () => {
    const kv = new MemoryKV(); const sm = new SaveManager(kv);
    const old = newSlot(1, 'normal', 'seed') as unknown as Record<string, any>;
    old.version = 2; old.frontier = 4;
    old.inventory = { hotbar: [null, null, null, null], backpack: [{ id: 'battery', n: 1 }], stash: [{ id: 'flare', n: 2 }] };
    old.checkpoint = { levelId: 'level4', waypoint: 0, time: 1, inventory: { hotbar: [null, null, null, null], backpack: [], stash: [{ id: 'bandage', n: 1 }] }, stats: old.stats };
    await kv.set('slot1', JSON.stringify(old));
    const s = (await sm.loadSlot(1))!;
    expect(s.version).toBe(SAVE_VERSION); expect(s.frontier).toBe(4);
    const inv = Inventory.fromState(s.inventory);
    expect(inv.count('flare')).toBe(2); expect(inv.count('battery')).toBe(1);
    expect(Inventory.fromState(s.checkpoint!.inventory).count('bandage')).toBe(1);
  });
});
