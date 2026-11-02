/**
 * Flow: the campaign loop around levels (spec 5.7-5.8, 5.11). Hub <-> level transitions, checkpoint
 * and level-complete autosaves, death with difficulty penalties (rewind + reload from the last
 * checkpoint, Hardcore permadeath), replays with capped loot carry-back, hub interactions.
 */
import { LevelScene } from '../levels/scene';
import { levelById, CAMPAIGN, isImplemented } from '../levels/registry';
import { hubDef } from '../levels/hub';
import { Inventory, applyDeathPenalty } from '../systems/inventory';
import { itemDef } from '../systems/items';
import { Stats } from '../systems/stats';
import { SaveManager, newSlot, newStats, type SlotData } from './save';
import { DIFFICULTIES, type DifficultyId } from './difficulty';
import { Rng, deriveSeed, parseSeed, randomSeedString } from '../gen/rng';
import { bus } from './events';
import { h } from '../ui/dom';
import { dialoguePanel, doorPanel, infoPanel, inventoryPanel, journalPanel, notePanel, stashPanel } from '../ui/panels';
import { NOTES } from '../story/notes';
import type { HubRef, HubState } from '../levels/hubObjects';
import type { SimSnapshot } from '../levels/sim';
import type { Game } from './game';

export interface RunInfo { mode: 'campaign' | 'replay'; index: number; levelId: string; seed: string; difficulty: DifficultyId; startInv: Inventory; deaths: number }
const REPLAY_LOOT_CAP = 6;

export class Flow {
  run: RunInfo | null = null;
  inHub = false;
  constructor(private g: Game) {}

  get slot(): SlotData | null { return this.g.currentSlot; }

  hubState(): HubState {
    const s = this.slot;
    return { frontier: s?.frontier ?? 0, completed: s?.completed ?? {} };
  }

  knownNotes(): string[] {
    const ids = new Set<string>([...(this.slot?.notesFound ?? []), ...this.g.profile.journal, ...(this.g.level?.sim.notes ?? [])]);
    return [...ids].filter((id) => NOTES[id]);
  }

  // ---- new / resume ----

  async newGame(slotNo: number, difficulty: DifficultyId, seedText: string): Promise<void> {
    const seed = seedText.trim() || randomSeedString();
    const slot = newSlot(slotNo, difficulty, seed);
    slot.inventory = Inventory.starter().toState();
    this.g.currentSlot = slot;
    await this.g.saves.saveSlot(slot);
    await this.enterHub();
  }

  async resume(slot: SlotData): Promise<void> {
    this.g.currentSlot = slot;
    const cp = slot.checkpoint;
    if (cp && cp.sim && isImplemented(cp.levelId)) {
      await this.startLevel(cp.levelId, cp.seed ?? slot.runSeed, cp.difficulty ?? slot.difficulty, { mode: cp.mode ?? 'campaign', index: cp.index ?? 0, snapshot: cp.sim as SimSnapshot, inv: Inventory.fromState(cp.inventory), stats: Stats.from(cp.stats), deaths: cp.deaths ?? 0 });
    } else await this.enterHub();
  }

  // ---- hub ----

  async enterHub(arrivedIndex?: number): Promise<void> {
    const g = this.g, slot = this.slot;
    if (!slot) return;
    g.beginLoad('The Central Hub');
    this.inHub = true; this.run = null;
    const state = this.hubState();
    const inv = Inventory.fromState(slot.inventory);
    const scene = new LevelScene(g, hubDef, deriveSeed(parseSeed(slot.runSeed), 'hub'), slot.difficulty, undefined, {
      hub: state, genParams: { frontier: state.frontier },
      sim: { inventory: inv, stats: Stats.from(slot.stats), spawnEntities: false, hungerEnabled: g.settings.value.hunger },
    });
    await scene.load((p, label) => g.ui.setLoading(true, 'The Central Hub', p, label));
    const idx = arrivedIndex ?? Math.min(state.frontier, CAMPAIGN.length - 1);
    const door = scene.plan.hub!.doors.find((d) => d.index === idx);
    if (door) scene.sim.player.place(door.pos.x, door.side === 'N' ? 2.4 : 3.6, door.side === 'N' ? 0 : Math.PI);
    this.wire(scene);
    g.finishLoad(scene);
    await g.saves.saveSlot(slot); // autosave on entering the hub
    bus.emit('save:written', { slot: slot.slot });
  }

  async startFromHub(index: number, o: { mode: 'campaign' | 'replay'; difficulty: DifficultyId; seed?: string }): Promise<void> {
    const slot = this.slot, g = this.g;
    if (!slot || !g.level) return;
    slot.inventory = g.level.sim.inv.toState(); slot.stats = g.level.sim.stats.toSave(g.level.sim.player.stamina);
    const e = CAMPAIGN[index];
    const seed = o.mode === 'campaign' ? slot.runSeed : o.seed ?? randomSeedString();
    if (o.mode === 'campaign') slot.levelSeeds[e.id] = deriveSeed(parseSeed(seed), `level:${e.id}`);
    await this.startLevel(e.id, seed, o.difficulty, { mode: o.mode, index, inv: Inventory.fromState(slot.inventory), stats: Stats.from(slot.stats), deaths: 0 });
  }

  // ---- levels ----

  async startLevel(id: string, seedText: string | number, difficulty: DifficultyId, o: { mode?: 'campaign' | 'replay'; index?: number; snapshot?: SimSnapshot; inv?: Inventory; stats?: Stats; deaths?: number } = {}): Promise<void> {
    const g = this.g;
    const def = levelById(id);
    if (!def) throw new Error(`unknown level ${id}`);
    g.beginLoad(def.name);
    const seed = typeof seedText === 'number' ? seedText : parseSeed(seedText);
    const inv = o.inv ?? Inventory.starter();
    this.inHub = false;
    this.run = { mode: o.mode ?? 'campaign', index: o.index ?? Math.max(0, CAMPAIGN.findIndex((c) => c.id === id)), levelId: id, seed: String(seedText), difficulty, startInv: Inventory.fromState(inv.toState()), deaths: o.deaths ?? 0 };
    const deaths = o.deaths ?? 0;
    const scene = new LevelScene(g, def, deriveSeed(seed, `level:${id}`), difficulty, undefined, {
      snapshot: o.snapshot,
      sim: { inventory: inv, stats: o.stats ?? new Stats(), seed: deriveSeed(seed, `level:${id}`) + deaths * 7919, hungerEnabled: g.settings.value.hunger },
    });
    await scene.load((p, label) => g.ui.setLoading(true, def.name, p, label));
    scene.sim.deaths = deaths;
    scene.onExit = () => void this.completeLevel();
    scene.onCheckpoint = (i) => void this.checkpoint(i);
    scene.onDeath = () => void this.onDeath();
    this.wire(scene);
    g.finishLoad(scene);
  }

  private wire(scene: LevelScene): void {
    scene.sim.listeners.push((e) => {
      if (e.type !== 'tell') return;
      const b = (this.g.profile.bestiary[e.entity.def.id] ??= { discovered: 0, learned: [] });
      b.discovered++;
      if (b.discovered === 1) { b.learned.push(e.entity.def.id === 'hound' ? 'Growls before it lunges.' : 'Ticks before it touches.'); void this.g.saves.saveProfile(this.g.profile); }
    });
    scene.onNote = (id) => this.foundNote(id);
    scene.onCustom = (ref) => this.custom(ref as HubRef);
  }

  private foundNote(id: string): void {
    const s = this.slot;
    if (s && !s.notesFound.includes(id)) s.notesFound.push(id);
    if (!this.g.profile.journal.includes(id)) { this.g.profile.journal.push(id); void this.g.saves.saveProfile(this.g.profile); }
    this.g.ui.openPanel(notePanel(id, () => this.g.ui.closePanel()));
  }

  async checkpoint(index: number): Promise<void> {
    const g = this.g, slot = this.slot, L = g.level, r = this.run;
    if (!slot || !L || !r) return;
    slot.checkpoint = { levelId: r.levelId, waypoint: index, time: L.sim.time, inventory: L.sim.inv.toState(), stats: L.sim.stats.toSave(L.sim.player.stamina), seed: r.seed, mode: r.mode, difficulty: r.difficulty, index: r.index, deaths: r.deaths, sim: L.sim.snapshot() };
    slot.thumbnail = g.thumbnail();
    await g.autosave();
  }

  /** Manual save (waypoint rest): allowed only at a waypoint, and per the difficulty rule. */
  async manualSave(): Promise<boolean> {
    const L = this.g.level, slot = this.slot;
    if (!L || !slot) return false;
    const d = DIFFICULTIES[slot.difficulty];
    if (!SaveManager.canManualSave(slot, d.manualSave, d.manualSaveLimit, L.sim.safeRoom || this.inHub)) { this.g.ui.toast('You cannot save here.', 'warn'); return false; }
    slot.manualSavesThisLevel++;
    if (L.sim.activatedWaypoints.size) await this.checkpoint([...L.sim.activatedWaypoints].pop()!);
    else await this.g.autosave();
    this.g.ui.toast('Saved');
    return true;
  }

  async onDeath(): Promise<void> {
    const g = this.g, r = this.run, slot = this.slot;
    if (!r) return;
    g.ui.showRewind(true, 'REWINDING');
    const penalty = DIFFICULTIES[r.difficulty].deathPenalty;
    if (penalty === 'permadeath' && r.mode === 'campaign' && slot) {
      await g.saves.permadeath(slot.slot);
      g.currentSlot = null;
      g.ui.showRewind(true, 'THE TAPE ENDS', 'Hardcore: the run is over. Your profile, bestiary and unlocks are kept.');
      await new Promise((res) => setTimeout(res, 3200));
      g.ui.showRewind(false); await g.showMenu(); return;
    }
    await new Promise((res) => setTimeout(res, 1600));
    if (r.mode === 'replay') {
      // replays: you wake in the hub and the loot is gone
      if (slot) { await g.saves.saveSlot(slot); }
      g.ui.showRewind(false); await this.enterHub(r.index); return;
    }
    const cp = slot?.checkpoint;
    const baseInv = cp ? Inventory.fromState(cp.inventory) : Inventory.fromState(r.startInv.toState());
    applyDeathPenalty(baseInv, penalty, new Rng(deriveSeed(parseSeed(r.seed), `death${r.deaths}`)));
    const stats = Stats.from(cp?.stats ?? newStats()); stats.revive();
    await this.startLevel(r.levelId, r.seed, r.difficulty, { mode: r.mode, index: r.index, snapshot: cp?.sim as SimSnapshot | undefined, inv: baseInv, stats, deaths: r.deaths + 1 });
    g.ui.showRewind(false);
  }

  async completeLevel(): Promise<void> {
    const g = this.g, L = g.level, r = this.run, slot = this.slot;
    if (!L || !r) return;
    const time = L.sim.time;
    if (slot) {
      let inv = L.sim.inv;
      if (r.mode === 'replay') inv = this.capGains(r.startInv, L.sim.inv);
      slot.inventory = inv.toState(); slot.stats = L.sim.stats.toSave(L.sim.player.stamina);
      if (r.mode === 'campaign') SaveManager.completeLevel(slot, r.index, r.levelId, time, CAMPAIGN.length);
      else { const prev = slot.completed[r.levelId]; if (!prev || time < prev.bestTime) slot.completed[r.levelId] = { bestTime: time, difficulty: r.difficulty }; slot.checkpoint = null; }
      const p = g.profile;
      if (!p.bestTimes[r.levelId] || time < p.bestTimes[r.levelId]) p.bestTimes[r.levelId] = time;
      const done = (p.completedOn[r.levelId] ??= []); if (!done.includes(r.difficulty)) done.push(r.difficulty);
      slot.playtime += time;
      await g.saves.saveProfile(p);
      await g.saves.saveSlot(slot);
    }
    bus.emit('toast', { text: `${CAMPAIGN[r.index]?.name ?? 'Level'} complete: ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}` });
    if (g.soundBank && g.audioEngine) g.soundBank.warp(g.audioEngine.flat('sfx', 0.2));
    g.gfx.glitch = 1;
    await new Promise((res) => setTimeout(res, 1100));
    if (slot) await this.enterHub(r.index); else await g.showMenu();
  }

  /** Replays: keep the starting kit plus at most REPLAY_LOOT_CAP newly found items (essentials always). */
  private capGains(start: Inventory, end: Inventory): Inventory {
    const out = Inventory.fromState(start.toState());
    let budget = REPLAY_LOOT_CAP;
    for (const s of end.stacks) {
      const gain = Math.max(0, end.count(s.id) - start.count(s.id));
      const take = itemDef(s.id).essential ? gain : Math.min(gain, budget);
      if (take > 0 && out.count(s.id) < end.count(s.id)) { const n = Math.min(take, end.count(s.id) - out.count(s.id)); out.add(s.id, n); if (!itemDef(s.id).essential) budget -= n; }
    }
    // consumables used up during the run stay used
    for (const s of start.stacks) { const lost = start.count(s.id) - end.count(s.id); if (lost > 0) out.remove(s.id, Math.min(lost, out.count(s.id))); }
    out.hotbar = [...end.hotbar];
    return out;
  }

  // ---- hub interactions ----

  private custom(ref: HubRef): void {
    const g = this.g, ui = g.ui, close = () => ui.closePanel();
    if (!g.level) return;
    if (ref.type === 'door') ui.openPanel(doorPanel(g, ref.index, this.hubState(), close));
    else if (ref.type === 'npc') ui.openPanel(dialoguePanel(g, ref.id, close));
    else switch (ref.kind) {
      case 'stash': ui.openPanel(stashPanel(g, close)); break;
      case 'noteboard': { for (const n of ['hub_board1', 'hub_board2']) this.foundNoteQuiet(n); ui.openPanel(h('div', { class: 'screen center panel' }, h('h2', {}, 'Notice board'), h('p', { class: 'note-text paper' }, `${NOTES.hub_board1.text}\n\n${NOTES.hub_board2.text}`), h('button', { class: 'btn', onclick: close }, 'Close'))); break; }
      case 'bestiary': ui.openPanel(infoPanel('Bestiary wall', this.bestiaryText(), close)); break;
      case 'gallery': ui.openPanel(infoPanel('Ending gallery', 'Six endings. None unlocked yet. The door is locked from the other side. (Endings arrive in Phase 5.)', close)); break;
      case 'camcorder': ui.openPanel(infoPanel('Camcorder station', 'Lens covers, tape stock, a different strap. Customization unlocks later.', close)); break;
      case 'kitchen': ui.openPanel(infoPanel('Kitchen', 'A hotplate, a dented pot, three cans with the labels worn off. Cooking arrives in Phase 2 with the crafting system.', close)); break;
      case 'crafting': ui.openPanel(infoPanel('Crafting table', 'A workbench with the outlines of tools drawn in marker. Recipes arrive in Phase 2.', close)); break;
    }
  }

  private foundNoteQuiet(id: string): void {
    const s = this.slot; if (s && !s.notesFound.includes(id)) s.notesFound.push(id);
    if (!this.g.profile.journal.includes(id)) this.g.profile.journal.push(id);
  }

  private bestiaryText(): string {
    const b = this.g.profile.bestiary;
    const lines = Object.entries(b).map(([id, e]) => `${id}: seen ${e.discovered}×`);
    return lines.length ? lines.join('\n') : 'Nothing catalogued yet. Entities you encounter are recorded here with what you learned about them.';
  }

  openInventory(): void { const g = this.g; if (g.level) g.ui.openPanel(inventoryPanel(g, () => g.ui.closePanel())); }
  openJournal(): void { const g = this.g; g.ui.openPanel(journalPanel(g, () => g.ui.closePanel())); }
}
