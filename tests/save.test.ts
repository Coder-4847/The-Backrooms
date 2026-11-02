import { describe, expect, it } from 'vitest';
import { MemoryKV } from '../src/core/storage';
import { SaveManager, newSlot, newProfile, SAVE_VERSION, slotKey } from '../src/core/save';

const mk = () => { const kv = new MemoryKV(); return { kv, sm: new SaveManager(kv) }; };

describe('save system', () => {
  it('round-trips a slot exactly', async () => {
    const { sm } = mk();
    const s = newSlot(2, 'hard', 'K7QD-93MX', 1000);
    s.frontier = 3; s.flags.metDoctor = true; s.notesFound.push('n1'); s.inventory.hotbar[0] = 'flashlight'; s.thumbnail = 'data:image/jpeg;base64,AAAA';
    await sm.saveSlot(s);
    const back = await sm.loadSlot(2);
    expect(back).toEqual({ ...s, updatedAt: back!.updatedAt });
    expect((await sm.listSlots()).map((x) => !!x)).toEqual([false, true, false]);
  });
  it('keeps a rolling backup and recovers from a corrupt main copy', async () => {
    const { sm, kv } = mk();
    const s = newSlot(1, 'normal', 'AAAA-1111'); s.playtime = 10; await sm.saveSlot(s);
    s.playtime = 99; await sm.saveSlot(s);
    expect(await kv.get(slotKey(1) + '.bak')).toContain('"playtime":10');
    await kv.set(slotKey(1), '{ not json');
    const recovered = await sm.loadSlot(1);
    expect(recovered?.playtime).toBe(10);
  });
  it('a failed temp write never destroys the good copy', async () => {
    const kv = new MemoryKV();
    const sm = new SaveManager(kv);
    const s = newSlot(1, 'normal', 'X'); s.playtime = 5; await sm.saveSlot(s);
    const origSet = kv.set.bind(kv);
    kv.set = async (k, v) => { if (k.endsWith('.tmp')) return origSet(k, v.slice(0, 5)); return origSet(k, v); }; // simulate truncated write
    s.playtime = 6;
    await expect(sm.saveSlot(s)).rejects.toThrow();
    expect((await sm.loadSlot(1))?.playtime).toBe(5);
  });
  it('migrates old versions forward', async () => {
    const { sm, kv } = mk();
    const v1 = { ...newSlot(1, 'easy', 'OLD'), version: 1 } as Record<string, unknown>;
    delete v1.manualSavesThisLevel; delete v1.thumbnail;
    await kv.set(slotKey(1), JSON.stringify(v1));
    const s = await sm.loadSlot(1);
    expect(s?.version).toBe(SAVE_VERSION);
    expect(s?.manualSavesThisLevel).toBe(0);
    expect(s?.thumbnail).toBeNull();
  });
  it('profile survives slot deletion and permadeath', async () => {
    const { sm } = mk();
    const p = newProfile(); p.endings.push('escape'); p.cosmetics.push('gold-lens'); await sm.saveProfile(p);
    await sm.saveSlot(newSlot(1, 'hardcore', 'DEAD'));
    await sm.permadeath(1);
    expect(await sm.loadSlot(1)).toBeNull();
    const back = await sm.loadProfile();
    expect(back.endings).toEqual(['escape']); expect(back.cosmetics).toEqual(['gold-lens']);
  });
  it('exports and imports a slot and the whole profile', async () => {
    const a = mk(), b = mk();
    const s = newSlot(1, 'nightmare', 'EXPORT'); s.frontier = 7; await a.sm.saveSlot(s);
    const p = newProfile(); p.achievements.push('first-noclip'); await a.sm.saveProfile(p);
    await b.sm.importData(await a.sm.exportData(1), 3);
    expect((await b.sm.loadSlot(3))?.runSeed).toBe('EXPORT');
    await b.sm.importData(await a.sm.exportData(null));
    expect((await b.sm.loadProfile()).achievements).toEqual(['first-noclip']);
    expect((await b.sm.loadSlot(1))?.frontier).toBe(7);
    await expect(b.sm.importData('{"kind":"nope"}')).rejects.toThrow();
  });
  it('wipeAll deletes everything', async () => {
    const { sm } = mk();
    await sm.saveSlot(newSlot(1, 'easy', 'A')); await sm.saveProfile(newProfile());
    await sm.wipeAll();
    expect(await sm.loadSlot(1)).toBeNull();
  });
  it('level completion advances the frontier and keeps best times', () => {
    const s = newSlot(1, 'normal', 'A');
    SaveManager.completeLevel(s, 0, 'level0', 600, 25);
    expect(s.frontier).toBe(1); expect(s.completed.level0.bestTime).toBe(600);
    SaveManager.completeLevel(s, 0, 'level0', 900, 25); // replay slower
    expect(s.completed.level0.bestTime).toBe(600); expect(s.frontier).toBe(1);
    SaveManager.completeLevel(s, 0, 'level0', 500, 25);
    expect(s.completed.level0.bestTime).toBe(500);
    SaveManager.completeLevel(s, 24, 'finale', 1, 25);
    expect(s.frontier).toBe(24); // clamped to the last level
  });
  it('manual save rules per difficulty', () => {
    const s = newSlot(1, 'nightmare', 'A');
    expect(SaveManager.canManualSave(s, 'unlimited', 99, true)).toBe(true);
    expect(SaveManager.canManualSave(s, 'unlimited', 99, false)).toBe(false); // only at waypoints / hub
    expect(SaveManager.canManualSave(s, 'none', 0, true)).toBe(false);
    s.manualSavesThisLevel = 2;
    expect(SaveManager.canManualSave(s, 'limitedPerLevel', 2, true)).toBe(false);
    s.manualSavesThisLevel = 1;
    expect(SaveManager.canManualSave(s, 'limitedPerLevel', 2, true)).toBe(true);
  });
});
