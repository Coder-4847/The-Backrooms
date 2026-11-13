/**
 * Flow: the campaign loop around levels (spec 5.7-5.8). New Game starts Level 0 directly and every
 * completed level rolls straight into the next one (autosave at each). Any level you have reached can be
 * replayed from the menu. Checkpoint and level-complete autosaves, death with difficulty penalties (rewind
 * + reload from the last checkpoint, Hardcore permadeath), replays with capped loot carry-back.
 */
import { LevelScene } from '../levels/scene';
import { levelById, CAMPAIGN, isImplemented, reachedLevelIndexes } from '../levels/registry';
import { Inventory, applyDeathPenalty } from '../systems/inventory';
import { itemDef } from '../systems/items';
import { Stats } from '../systems/stats';
import { SaveManager, newSlot, newStats, type SlotData } from './save';
import { DIFFICULTIES, type DifficultyId } from './difficulty';
import { Rng, deriveSeed, parseSeed, randomSeedString } from '../gen/rng';
import { bus } from './events';
import { h } from '../ui/dom';
import { BASE_STATE, ENDING_TEXT, resolveEnding, type EndingState } from '../story/endings';
import { checkAchievements, unlocksFor } from '../story/achievements';
import { finalePanel, inventoryPanel, journalPanel, notePanel, talkPanel } from '../ui/panels';
import { NOTES } from '../story/notes';
import type { SimSnapshot } from '../levels/sim';
import type { Game } from './game';

export interface RunInfo { mode: 'campaign' | 'replay'; index: number; levelId: string; seed: string; difficulty: DifficultyId; startInv: Inventory; deaths: number }
const REPLAY_LOOT_CAP = 6;

export class Flow {
  run: RunInfo | null = null;
  /** Replays keep their checkpoint in memory only, so they never overwrite the campaign checkpoint in the save. */
  private replayCheckpoint: { waypoint: number; inventory: Inventory; stats: Stats; sim: SimSnapshot } | null = null;
  constructor(private g: Game) {}

  get slot(): SlotData | null { return this.g.currentSlot; }

  knownNotes(): string[] {
    const ids = new Set<string>([...(this.slot?.notesFound ?? []), ...this.g.profile.journal, ...(this.g.level?.sim.notes ?? [])]);
    return [...ids].filter((id) => NOTES[id]);
  }

  // ---- new / resume ----

  async newGame(slotNo: number, difficulty: DifficultyId, seedText: string, opts: { speedrun?: boolean; ngPlus?: boolean } = {}): Promise<void> {
    const seed = opts.speedrun ? 'SPEEDRUN-1' : seedText.trim() || randomSeedString();
    const slot = newSlot(slotNo, difficulty, seed);
    if (opts.speedrun) slot.flags.speedrun = true;
    if (opts.ngPlus) slot.flags.ngplus = true;
    slot.inventory = Inventory.starter().toState();
    this.g.currentSlot = slot;
    await this.g.saves.saveSlot(slot);
    await this.startFrontier(slot);
  }

  async resume(slot: SlotData): Promise<void> {
    this.g.currentSlot = slot;
    const cp = slot.checkpoint;
    if (cp && cp.sim && isImplemented(cp.levelId)) {
      await this.startLevel(cp.levelId, cp.seed ?? slot.runSeed, cp.difficulty ?? slot.difficulty, { mode: cp.mode ?? 'campaign', index: cp.index ?? 0, snapshot: cp.sim as SimSnapshot, inv: Inventory.fromState(cp.inventory), stats: Stats.from(cp.stats), deaths: cp.deaths ?? 0 });
    } else await this.startFrontier(slot);
  }

  /**
   * Campaign: start the level at the frontier (the furthest one reached) from the slot's carried inventory and
   * stats. `recover` gives a little health and sanity back between levels (you step through a door, not a medic).
   */
  private async startFrontier(slot: SlotData, recover = false): Promise<void> {
    const index = Math.max(0, Math.min(slot.frontier, CAMPAIGN.length - 1));
    const e = CAMPAIGN[index];
    if (!isImplemented(e.id)) { await this.g.showMenu(); return; }
    const stats = Stats.from(slot.stats);
    if (recover) { stats.health = Math.min(100, stats.health + 35); stats.sanity = Math.min(100, stats.sanity + 30); }
    slot.levelSeeds[e.id] = deriveSeed(parseSeed(slot.runSeed), `level:${e.id}`);
    this.replayCheckpoint = null;
    await this.startLevel(e.id, slot.runSeed, slot.difficulty, { mode: 'campaign', index, inv: Inventory.fromState(slot.inventory), stats, deaths: 0 });
  }

  /** Levels you may replay in this save: every campaign level up to the furthest one reached. */
  reachedLevels(slot: SlotData | null = this.slot): number[] {
    return slot ? reachedLevelIndexes(slot.frontier) : [];
  }

  /** Replay a level you have reached (difficulty + seed of your choice). Story progress is untouched; death never ends the run. */
  async startReplay(index: number, o: { difficulty: DifficultyId; seed?: string }): Promise<void> {
    const slot = this.slot;
    if (!slot || !this.reachedLevels(slot).includes(index)) return;
    const e = CAMPAIGN[index];
    this.replayCheckpoint = null;
    await this.startLevel(e.id, o.seed || randomSeedString(), o.difficulty, { mode: 'replay', index, inv: Inventory.fromState(slot.inventory), stats: new Stats(), deaths: 0 });
  }

  // ---- levels ----

  async startLevel(id: string, seedText: string | number, difficulty: DifficultyId, o: { mode?: 'campaign' | 'replay'; index?: number; snapshot?: SimSnapshot; inv?: Inventory; stats?: Stats; deaths?: number } = {}): Promise<void> {
    const g = this.g;
    const def = levelById(id);
    if (!def) throw new Error(`unknown level ${id}`);
    g.beginLoad(def.name);
    const seed = typeof seedText === 'number' ? seedText : parseSeed(seedText);
    const inv = o.inv ?? Inventory.starter();
    const r0 = this.run = { mode: o.mode ?? 'campaign', index: o.index ?? Math.max(0, CAMPAIGN.findIndex((c) => c.id === id)), levelId: id, seed: String(seedText), difficulty, startInv: Inventory.fromState(inv.toState()), deaths: o.deaths ?? 0 };
    const deaths = o.deaths ?? 0;
    const scene = new LevelScene(g, def, deriveSeed(seed, `level:${id}`), difficulty, undefined, {
      snapshot: o.snapshot,
      sim: { inventory: inv, stats: o.stats ?? new Stats(), seed: deriveSeed(seed, `level:${id}`) + deaths * 7919, hungerEnabled: g.settings.value.hunger, ngPlus: !!this.slot?.flags.ngplus },
    });
    await scene.load((p, label) => g.ui.setLoading(true, def.name, p, label));
    scene.sim.deaths = deaths;
    const comp = this.slot?.npcs.companion as { present?: boolean; hp?: number } | undefined;
    if (comp) { // Pim already travels with you (or is gone for good): the camp survivor is not duplicated
      scene.sim.ew.entities = scene.sim.ew.entities.filter((e) => e.def.id !== 'companion');
      if (comp.present) scene.sim.x.spawnCompanion(comp.hp ?? 100);
    }
    scene.onExit = () => void this.completeLevel();
    scene.onCheckpoint = (i) => void this.checkpoint(i);
    scene.onDeath = () => void this.onDeath();
    this.wire(scene);
    g.finishLoad(scene);
    g.ui.levelCard(def.name, def.act, r0.mode === 'replay');
  }

  private wire(scene: LevelScene): void {
    scene.sim.listeners.push((e) => {
      if (e.type !== 'tell') return;
      const b = (this.g.profile.bestiary[e.entity.def.id] ??= { discovered: 0, learned: [] });
      b.discovered++;
      const lines: Record<string, string> = { hound: 'Growls before it lunges.', stick: 'Ticks before it touches.', howler: 'Screams when it hears you; the scream carries.', skinstealer: 'Never blinks. Its shadow lags.', concierge: 'Rings a bell once you have broken a rule.', monitor: 'Whistles if you have no pass.' };
      if (b.discovered === 1) { b.learned.push(lines[e.entity.def.id] ?? 'Something stirs.'); void this.g.saves.saveProfile(this.g.profile); }
    });
    scene.sim.listeners.push((e) => { if (e.type === 'talk') this.g.ui.openPanel(talkPanel(this.g, e.id, () => this.g.ui.closePanel())); else if (e.type === 'companion' && e.what === 'lost' && this.slot) this.slot.npcs.companion = { present: false, lost: true, hp: 0 }; else if (e.type === 'companion' && e.what === 'recruited' && this.slot) this.slot.npcs.companion = { present: true, hp: 100 }; });
    scene.sim.listeners.push((e) => {
      const slot = this.slot, campaign = this.run?.mode !== 'replay';
      if (e.type === 'pickup' && e.item.item.startsWith('anchor') && slot && campaign) {
        slot.flags[`anchor:${e.item.item}`] = true;
        slot.flags.anchors = ['1', '2', '3', '4', '5'].filter((n) => slot.flags[`anchor:anchor${n}`]).length;
        this.g.ui.toast(`An Anchor (${slot.flags.anchors}/5). The room feels briefly solid.`); this.award();
      } else if (e.type === 'secret' && slot && campaign) { slot.flags.secret = true; this.g.ui.toast('The hum skips a beat.'); this.award(); }
      else if (e.type === 'tell') this.hint('tell', 'It has seen you. RUN: hold Sprint (you never tire while something hunts you), break line of sight, then hide in a locker or under a desk.');
      else if (e.type === 'splash') this.hint('water', 'Water: crouch to dive and stay quiet. Surface to breathe. Splashing is loud.');
      else if (e.type === 'hide' && e.on) this.hint('hide', 'Hiding: stay quiet. Hounds can smell you if they are close.');
    });
    this.hintsAtStart(scene);
    scene.onNote = (id) => this.foundNote(id);
    scene.onCustom = (ref) => this.custom(ref as { type: string });
  }

  private foundNote(id: string): void {
    const s = this.slot;
    const dynamic = this.g.level?.plan.noteText?.[id];
    // generated notes (puzzle hints, badge numbers, posted rules) are only valid for this run, so they stay out of the journal
    if (!NOTES[id] || dynamic) { this.g.ui.openPanel(notePanel(id, () => this.g.ui.closePanel(), dynamic ?? { title: 'Note', text: '...' })); return; }
    if (s && !s.notesFound.includes(id)) s.notesFound.push(id);
    if (!this.g.profile.journal.includes(id)) { this.g.profile.journal.push(id); void this.g.saves.saveProfile(this.g.profile); }
    this.g.ui.openPanel(notePanel(id, () => this.g.ui.closePanel()));
  }

  /** One-time contextual hints (subtle tutorial). Shown once per profile. */
  hint(id: string, text: string): void {
    const c = (this.g.profile.counters ??= {});
    if (c[`hint:${id}`]) return;
    c[`hint:${id}`] = 1; this.g.ui.toast(text);
  }

  private hintsAtStart(scene: LevelScene): void {
    const touch = this.g.input.device === 'touch', pad = this.g.input.device === 'gamepad';
    const act = touch ? 'tap the button that appears' : pad ? 'press A' : 'press E';
    setTimeout(() => this.hint('goal', `Goal: find the exit and get out. Explore, ${act} near notes, keys and doors, and read the paper scraps people left. They are clues.`), 5200);
    this.hint('move', touch ? 'Left thumb moves, right thumb looks. Tap a slot to pick an item, tap it again (or USE) to use it. Buttons appear when something is near.' : pad ? 'Left stick moves, right stick looks. A interacts, Y toggles the flashlight.' : 'WASD or the arrow keys to move, mouse or Left/Right arrows to look. 1-4 or [ ] pick an item (press F to use it), G flashlight, E interact, Shift sprint, C crouch.');
    setTimeout(() => { if (scene.sim.flash.battery < 100) this.hint('battery', 'The flashlight drains. Wiggle the mouse (or shake) when it is low, and pick up batteries.'); }, 120000);
  }

  /** Evaluate achievements and toast anything new. */
  award(): void {
    const fresh = checkAchievements(this.g.profile, this.slot);
    for (const a of fresh) this.g.ui.toast(`Achievement: ${a.name}`);
    if (fresh.length) void this.g.saves.saveProfile(this.g.profile);
  }

  async checkpoint(index: number): Promise<void> {
    const g = this.g, slot = this.slot, L = g.level, r = this.run;
    if (!slot || !L || !r) return;
    if (r.mode === 'replay') { this.replayCheckpoint = { waypoint: index, inventory: Inventory.fromState(L.sim.inv.toState()), stats: Stats.from(L.sim.stats.toSave(L.sim.player.stamina)), sim: L.sim.snapshot() }; return; } // (the HUD toast comes from the scene)
    slot.checkpoint = { levelId: r.levelId, waypoint: index, time: L.sim.time, inventory: L.sim.inv.toState(), stats: L.sim.stats.toSave(L.sim.player.stamina), seed: r.seed, mode: r.mode, difficulty: r.difficulty, index: r.index, deaths: r.deaths, sim: L.sim.snapshot() };
    slot.thumbnail = g.thumbnail();
    await g.autosave();
  }

  /** Manual save (waypoint rest): allowed only at a waypoint, and per the difficulty rule. */
  async manualSave(): Promise<boolean> {
    const L = this.g.level, slot = this.slot;
    if (!L || !slot) return false;
    const d = DIFFICULTIES[slot.difficulty];
    if (!SaveManager.canManualSave(slot, d.manualSave, d.manualSaveLimit, L.sim.safeRoom)) { this.g.ui.toast('You cannot save here.', 'warn'); return false; }
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
      // replays: no penalty, you wake at your last checkpoint (or the start) with what you started with
      const rc = this.replayCheckpoint;
      await this.startLevel(r.levelId, r.seed, r.difficulty, { mode: 'replay', index: r.index, snapshot: rc?.sim, inv: rc ? rc.inventory : Inventory.fromState(r.startInv.toState()), stats: rc ? (rc.stats.revive(), rc.stats) : new Stats(), deaths: r.deaths + 1 });
      g.ui.showRewind(false); return;
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
      if (L.sim.x.companion) slot.npcs.companion = { present: true, hp: L.sim.x.companion.data.hp };
      if (r.mode === 'campaign') SaveManager.completeLevel(slot, r.index, r.levelId, time, CAMPAIGN.length);
      else { const prev = slot.completed[r.levelId]; if (!prev || time < prev.bestTime) slot.completed[r.levelId] = { bestTime: time, difficulty: r.difficulty }; } // a replay never touches the campaign checkpoint
      const p = g.profile;
      if (!p.bestTimes[r.levelId] || time < p.bestTimes[r.levelId]) p.bestTimes[r.levelId] = time;
      const done = (p.completedOn[r.levelId] ??= []); if (!done.includes(r.difficulty)) done.push(r.difficulty);
      slot.playtime += time;
      this.award();
      await g.saves.saveProfile(p);
      await g.saves.saveSlot(slot);
    }
    bus.emit('toast', { text: `${CAMPAIGN[r.index]?.name ?? 'Level'} complete: ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}` });
    if (g.soundBank && g.audioEngine) g.soundBank.warp(g.audioEngine.flat('sfx', 0.2));
    g.gfx.glitch = 1;
    await new Promise((res) => setTimeout(res, 1100));
    if (!slot || r.mode === 'replay' || r.index + 1 >= CAMPAIGN.length) { await g.showMenu(); return; }
    await this.startFrontier(slot, true); // straight into the next level
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

  /** The Finale (spec 8.6): the Architect's choice + the run's state go through the ending resolver. */
  async finishGame(patch: Partial<EndingState>): Promise<void> {
    const g = this.g, L = g.level, slot = this.slot;
    if (!L) return;
    const state: EndingState = { ...BASE_STATE, hasExitKey: L.sim.keys.size > 0 || L.sim.inv.has('key1'), sanity: L.sim.stats.sanity, companionAlive: !!(slot?.npcs.companion as { present?: boolean } | undefined)?.present, anchorsFound: Number(slot?.flags.anchors) || 0, secretSequence: !!slot?.flags.secret, ...patch };
    const id = resolveEnding(state);
    const t = ENDING_TEXT[id];
    const first = !g.profile.endings.includes(id);
    if (first) g.profile.endings.push(id);
    const diff = slot?.difficulty ?? 'normal';
    const u = unlocksFor(id, diff, g.profile);
    for (const c of u.cosmetics) if (!g.profile.cosmetics.includes(c)) g.profile.cosmetics.push(c);
    for (const tt of u.titles) if (!g.profile.titles.includes(tt)) g.profile.titles.push(tt);
    if (id !== 'loop' && !g.profile.ngPlus.includes('unlocked')) g.profile.ngPlus.push('unlocked');
    (g.profile.completedOn.finale ??= []); if (!g.profile.completedOn.finale.includes(diff)) g.profile.completedOn.finale.push(diff);
    if (slot?.flags.speedrun) { const total = slot.playtime + L.sim.time; const k = `speedrun:${id}`; if (!g.profile.bestTimes[k] || total < g.profile.bestTimes[k]) g.profile.bestTimes[k] = total; }
    this.award();
    await g.saves.saveProfile(g.profile);
    if (g.soundBank && g.audioEngine) g.soundBank.ending(g.audioEngine.flat('music', 0.4), id === 'loop' || id === 'join');
    const done = () => { g.ui.closePanel(); void (async () => {
      if (slot) {
        if (id === 'loop') { slot.frontier = 0; slot.completed = {}; slot.checkpoint = null; slot.runSeed = String(Math.floor(Math.random() * 1e9)); slot.flags.loops = (Number(slot.flags.loops) || 0) + 1; }
        else { slot.flags.ending = id; slot.checkpoint = null; }
        await g.saves.saveSlot(slot);
      }
      g.currentSlot = null; await g.showMenu();
    })(); };
    g.ui.openPanel(h('div', { class: 'screen center panel' }, h('h2', {}, t.title), h('p', { class: 'note-text paper' }, t.text), h('p', { class: 'muted' }, `Ending ${g.profile.endings.length} of 6 seen.${g.profile.ngPlus.includes('unlocked') ? ' New Game+ is unlocked.' : ''}${u.titles.length ? ` Title: ${u.titles[u.titles.length - 1]}.` : ''}${slot?.flags.speedrun ? ` Run time ${Math.floor((slot.playtime + L.sim.time) / 60)}:${String(Math.floor((slot.playtime + L.sim.time) % 60)).padStart(2, '0')}.` : ''}`), h('button', { class: 'btn primary', onclick: done }, 'Continue')));
  }

  // ---- level interactions (Architect, clue notes) ----

  private custom(ref: { type: string }): void {
    const g = this.g, ui = g.ui, close = () => ui.closePanel();
    if (!g.level) return;
    if (ref.type === 'architect') { ui.openPanel(finalePanel(g, close)); return; }
    if (ref.type === 'clue') {
      const c = ref as unknown as { text: string; img?: () => string | undefined };
      const src = c.img?.();
      g.sounds()?.click('tick');
      ui.openPanel(h('div', { class: 'screen center panel clue-panel' },
        src ? h('img', { class: 'clue-img', src, alt: c.text }) : h('p', { class: 'note-text paper' }, c.text),
        h('p', { class: 'clue-caption' }, c.text),
        h('button', { class: 'btn', onclick: close }, 'Put it back')));
    }
  }

  openInventory(): void { const g = this.g; if (g.level) g.ui.openPanel(inventoryPanel(g, () => g.ui.closePanel())); }
  openJournal(): void { const g = this.g; g.ui.openPanel(journalPanel(g, () => g.ui.closePanel())); }
}
