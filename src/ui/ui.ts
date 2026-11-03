/**
 * Ui: menu screens, loading, HUD, toasts, captions, pause and the debug console.
 * Plain DOM; everything is keyboard, gamepad-focus and touch friendly (real buttons, large targets).
 */
import { h, $, fmtTime, timeAgo } from './dom';
import { buildSettings, download, pickFile } from './settingsUi';
import { bus } from '../core/events';
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from '../core/difficulty';
import { SLOT_COUNT, type SlotData } from '../core/save';
import { debugEnabled } from '../core/debug';
import { randomSeedString } from '../gen/rng';
import { achievementsPanel, bestiaryPanel, camcorderPanel, creditsPanel, endingGalleryPanel, howToPlayPanel } from './panels2';
import { replayPanel } from './panels';
import { glyphFor } from '../core/input/actions';
import { itemDef } from '../systems/items';
import type { Settings } from '../core/settings';
import type { Game } from '../core/game';
import type { LevelScene } from '../levels/scene';

export class Ui {
  private root = $('#ui');
  private hud = $('#hud');
  private promptEl = h('div', { class: 'prompt' });
  private heartEl = h('div', { class: 'heart', 'aria-hidden': 'true' }, h('i', {}, '♥'), h('b', {}, '64'), h('small', {}, 'BPM'));
  private vigEl = h('div', { class: 'vig', 'aria-hidden': 'true' });
  private scareEl = h('div', { class: 'scare', 'aria-hidden': 'true' });
  private lastBpm = 0;
  private objEl = h('div', { class: 'objective', 'aria-live': 'polite' });
  private lastObj = '';
  private toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
  private captionEl = h('div', { class: 'captions', 'aria-live': 'polite' });
  private stamina = h('div', { class: 'bar' }, h('i'));
  private hotbar = h('div', { class: 'hotbar' });
  private vitals = h('div', { class: 'vitals' });
  private gear = h('div', { class: 'gear' });
  private noise = h('div', { class: 'noise' }, h('i'));
  private panelEl: HTMLElement | null = null;
  private rewindEl: HTMLElement | null = null;
  private hudKey = '';
  private hotbarKey = '';
  private slotEls: HTMLButtonElement[] = [];
  panelOpen = false;
  private timeEl = h('span', { class: 'ts' });
  private statsEl = h('pre', { class: 'stats' });
  private loading = h('div', { class: 'loading', hidden: true });
  private debugEl: HTMLElement | null = null;
  debugOpen = false;
  private screen: HTMLElement | null = null;
  private lastPrompt = '';

  constructor(private game: Game) {
    this.hud.append(
      h('div', { class: 'rec' }, h('i', { class: 'dot' }), 'REC', this.timeEl),
      this.vigEl, this.heartEl, this.objEl, this.stamina, this.promptEl, this.statsEl, this.hotbar, this.vitals, this.gear, this.noise);
    document.getElementById('app')!.append(this.toasts, this.captionEl, this.scareEl, this.loading);
    bus.on('scare', (e) => this.playScare((e as { kind: string; ms: number }).kind, (e as { kind: string; ms: number }).ms));
    bus.on('toast', (t) => this.toast(t.text, t.kind));
    bus.on('caption', (c) => this.caption(c.text, c.ms));
    bus.on('quality:offerUp', (e) => this.toast(`Performance is great. Raise graphics to ${e.tier}? Use Settings > Graphics.`));
    // hotbar slots: select on pointer-down (a lost `click` was the mobile bug), never take keyboard focus
    for (let i = 0; i < 4; i++) {
      const b = h('button', { class: 'hb', 'aria-label': `Slot ${i + 1}`, tabindex: '-1', 'data-slot': String(i) }, h('small', {}, String(i + 1)), '—') as HTMLButtonElement;
      this.slotEls.push(b); this.hotbar.append(b);
    }
    this.hotbar.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('.hb') as HTMLElement | null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      this.pickSlot(Number(b.dataset.slot));
    });
    this.showHud(false);
  }

  // ---- generic ----

  private show(el: HTMLElement | null): void {
    this.screen?.remove();
    this.screen = el;
    if (el) { this.root.append(el); (el.querySelector('button, input, select') as HTMLElement | null)?.focus({ preventScroll: true }); }
    this.root.classList.toggle('active', !!el);
  }

  hideAllMenus(): void { this.show(null); }

  setLoading(on: boolean, title = '', progress = 0, label = ''): void {
    this.loading.hidden = !on;
    if (!on) return;
    this.loading.replaceChildren(
      h('div', { class: 'load-title' }, title),
      h('div', { class: 'load-bar' }, h('i', { style: `width:${Math.round(progress * 100)}%` })),
      h('div', { class: 'load-label' }, label || tipFor(progress)));
  }

  toast(text: string, kind: 'info' | 'warn' = 'info'): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  caption(text: string, ms: number): void {
    if (!this.game.settings.value.subtitles) return;
    const c = h('div', { class: 'cap' }, text);
    this.captionEl.append(c);
    while (this.captionEl.children.length > 3) this.captionEl.firstChild!.remove();
    setTimeout(() => c.remove(), ms);
  }

  applyAccessibility(s: Settings): void {
    document.documentElement.style.setProperty('--text-scale', String(s.textSize));
    document.documentElement.classList.toggle('hc', s.highContrast);
  }

  // ---- panels (inventory, journal, dialogue...) ----

  openPanel(el: HTMLElement): void {
    this.panelEl?.remove();
    this.panelEl = el; this.panelOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    this.root.append(el);
    this.root.classList.add('active');
    (el.querySelector('button, input') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  closePanel(): void {
    this.panelEl?.remove(); this.panelEl = null;
    if (!this.panelOpen) return;
    this.panelOpen = false;
    if (!this.screen) this.root.classList.remove('active');
    if (this.game.state === 'playing') this.game.input.requestLock();
  }

  showRewind(on: boolean, title = 'REWINDING', sub = ''): void {
    this.rewindEl?.remove(); this.rewindEl = null;
    if (!on) { this.clearScare(); return; }
    this.rewindEl = h('div', { class: 'rewind' }, h('div', { class: 'big' }, '◀◀ ' + title), sub && h('div', { class: 'muted' }, sub));
    document.getElementById('app')!.append(this.rewindEl);
  }

  // ---- screens ----

  contentWarning(): Promise<void> {
    return new Promise((resolve) => {
      this.show(h('div', { class: 'screen center' },
        h('h1', { class: 'logo small' }, 'NOCLIP'),
        h('h2', {}, 'Content warning'),
        h('p', {}, 'This is a horror game. It uses flickering lights, sudden loud sounds, darkness, and disturbing imagery.'),
        h('p', { class: 'muted' }, 'Photosensitive or easily startled? You can reduce flicker, jump scares and camera shake under Settings > Accessibility at any time.'),
        h('button', { class: 'btn primary', onclick: () => { this.game.ensureAudio(); this.show(null); resolve(); } }, 'I understand')));
    });
  }

  showTitle(): void {
    const g = this.game;
    this.showHud(false);
    const hasSave = this.slotsCache.some(Boolean);
    void g.saves.listSlots().then((s) => { this.slotsCache = s; });
    const menu = h('div', { class: 'screen title' },
      h('h1', { class: 'logo' }, 'NOCLIP'),
      h('p', { class: 'tag' }, this.game.profile.titles.length ? `found footage. do not stop recording. · ${this.game.profile.titles[this.game.profile.titles.length - 1]}` : 'found footage. do not stop recording.'),
      h('div', { class: 'menu' },
        h('button', { class: 'btn primary', onclick: () => this.continueScreen() }, hasSave ? 'Continue' : 'Continue / Load'),
        h('button', { class: 'btn', onclick: () => this.newGameScreen() }, 'New Game'),
        h('button', { class: 'btn', onclick: () => void this.replayScreen() }, 'Replay a Level'),
        h('button', { class: 'btn', onclick: () => this.manageScreen() }, 'Manage Saves'),
        h('button', { class: 'btn', onclick: () => this.settingsScreen() }, 'Settings'),
        this.game.profile.ngPlus.includes('unlocked') ? h('button', { class: 'btn', onclick: () => this.newGameScreen(undefined, true) }, 'New Game+') : null,
        h('button', { class: 'btn', onclick: () => this.show(bestiaryPanel(this.game, () => this.showTitle())) }, 'Bestiary'),
        h('button', { class: 'btn', onclick: () => this.show(endingGalleryPanel(this.game, () => this.showTitle())) }, 'Ending Gallery'),
        h('button', { class: 'btn', onclick: () => this.show(achievementsPanel(this.game, () => this.showTitle())) }, 'Achievements'),
        h('button', { class: 'btn', onclick: () => this.show(camcorderPanel(this.game, () => this.showTitle())) }, 'Camcorder Lenses'),
        h('button', { class: 'btn', onclick: () => this.show(howToPlayPanel(() => this.showTitle())) }, 'How to Play'),
        h('button', { class: 'btn', onclick: () => this.show(creditsPanel(() => this.showTitle())) }, 'Credits'),
        ...(debugEnabled() ? [h('hr'), h('button', { class: 'btn ghost', onclick: () => void this.launch('testroom') }, 'Test Room'), h('button', { class: 'btn ghost', onclick: () => void this.launch('placeholder') }, 'Placeholder Level'), h('button', { class: 'btn ghost', onclick: () => void this.launch('level0') }, 'Level 0 (standalone)')] : [])),
      h('div', { class: 'foot' }, `build ${import.meta.env.MODE}${debugEnabled() ? ' · debug: press the backtick key for the console' : ''}`));
    this.show(menu);
  }

  private slotsCache: (SlotData | null)[] = [];

  private async launch(id: string): Promise<void> {
    this.game.ensureAudio();
    await this.game.startLevel(id, 'TEST-ROOM', this.game.settings.value.difficulty, null);
  }

  private settingsScreen(from: 'title' | 'pause' = 'title'): void {
    this.show(buildSettings(this.game, () => (from === 'pause' ? this.showPause(true) : this.showTitle())));
  }

  private slotCard(i: number, s: SlotData | null, actions: HTMLElement[]): HTMLElement {
    const d = s ? DIFFICULTIES[s.difficulty] : null;
    return h('div', { class: 'slot' + (s ? '' : ' empty') },
      h('div', { class: 'thumb', style: s?.thumbnail ? `background-image:url(${s.thumbnail})` : '' }, s ? '' : 'empty'),
      h('div', { class: 'slot-info' },
        h('strong', {}, `Slot ${i + 1}`),
        s ? h('div', {}, `${d!.label} · seed ${s.runSeed}`) : h('div', { class: 'muted' }, 'No data'),
        s && h('div', { class: 'muted' }, `Level ${s.frontier + 1} · ${fmtTime(s.playtime)} played · ${timeAgo(s.updatedAt)}`)),
      h('div', { class: 'slot-actions' }, ...actions));
  }

  private async continueScreen(): Promise<void> {
    const slots = await this.game.saves.listSlots();
    this.slotsCache = slots;
    const wrap = h('div', { class: 'screen' }, h('h2', {}, 'Continue'));
    slots.forEach((s, i) => wrap.append(this.slotCard(i, s, s ? [h('button', { class: 'btn small primary', onclick: () => void this.resume(s) }, 'Play')] : [h('button', { class: 'btn small', onclick: () => this.newGameScreen(i + 1) }, 'New game')])));
    wrap.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Back')));
    this.show(wrap);
  }

  /**
   * Replay a Level: choose a save (skipped when only one exists), then any level that save has reached.
   * Reaching further levels in a save unlocks them here.
   */
  private async replayScreen(): Promise<void> {
    const slots = await this.game.saves.listSlots();
    this.slotsCache = slots;
    const used = slots.map((s, i) => ({ s, i })).filter((x): x is { s: SlotData; i: number } => !!x.s);
    if (!used.length) { this.show(h('div', { class: 'screen center' }, h('h2', {}, 'Replay a level'), h('p', {}, 'Start a New Game first: levels you reach are unlocked for replay in that save.'), h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => this.newGameScreen() }, 'New Game'), h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Back')))); return; }
    const open = (s: SlotData) => { this.game.currentSlot = s; this.game.ensureAudio(); this.show(replayPanel(this.game, s, () => (used.length > 1 ? void this.replayScreen() : this.showTitle()))); };
    if (used.length === 1) { open(used[0].s); return; }
    const wrap = h('div', { class: 'screen' }, h('h2', {}, 'Replay a level'), h('p', { class: 'muted' }, 'Which save?'));
    used.forEach(({ s, i }) => wrap.append(this.slotCard(i, s, [h('button', { class: 'btn small primary', onclick: () => open(s) }, 'Choose')])));
    wrap.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Back')));
    this.show(wrap);
  }

  /** "LEVEL 3 · ELECTRICAL STATION": a title card as each level starts, since there is no hub between them. */
  levelCard(name: string, act: number, replay: boolean): void {
    const [head, ...rest] = name.split(':');
    const card = h('div', { class: 'level-card' }, h('small', {}, `${replay ? 'REPLAY · ' : ''}ACT ${act}`), h('b', {}, rest.length ? rest.join(':').trim() : head), rest.length ? h('em', {}, head.trim()) : null);
    document.getElementById('app')!.append(card);
    window.setTimeout(() => card.classList.add('out'), 3600);
    window.setTimeout(() => card.remove(), 4600);
  }

  private async resume(s: SlotData): Promise<void> {
    this.game.ensureAudio();
    await this.game.resumeSlot(s);
  }

  private async manageScreen(): Promise<void> {
    const slots = await this.game.saves.listSlots();
    const wrap = h('div', { class: 'screen' }, h('h2', {}, 'Manage saves'));
    slots.forEach((s, i) => wrap.append(this.slotCard(i, s, s ? [
      h('button', { class: 'btn small', onclick: async () => download(`noclip-slot${i + 1}.json`, await this.game.saves.exportData(i + 1)) }, 'Export'),
      h('button', { class: 'btn small danger', onclick: async () => { if (confirm(`Delete slot ${i + 1}?`)) { await this.game.saves.deleteSlot(i + 1); void this.manageScreen(); } } }, 'Delete'),
    ] : [h('button', { class: 'btn small', onclick: () => pickFile(async (t) => { await this.game.saves.importData(t, i + 1); void this.manageScreen(); }) }, 'Import')])));
    wrap.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Back')));
    this.show(wrap);
  }

  private async newGameScreen(preferSlot?: number, ngPlus = false): Promise<void> {
    const slots = await this.game.saves.listSlots();
    let slotNo = preferSlot ?? (slots.findIndex((s) => !s) + 1 || 1);
    let diff: DifficultyId = this.game.settings.value.difficulty;
    const desc = h('p', { class: 'diff-desc' });
    const seed = h('input', { type: 'text', placeholder: 'Random seed (optional)', maxlength: 24, autocapitalize: 'characters', 'aria-label': 'Run seed' });
    const speed = h('input', { type: 'checkbox', id: 'speedrun' });
    const diffBtns = DIFFICULTY_ORDER.map((d) => h('button', { class: 'chip', onclick: () => { diff = d; paint(); } }, DIFFICULTIES[d].label));
    const slotBtns = Array.from({ length: SLOT_COUNT }, (_, i) => h('button', { class: 'chip', onclick: () => { slotNo = i + 1; paint(); } }, `Slot ${i + 1}${slots[i] ? ' (overwrite)' : ''}`));
    const paint = () => {
      diffBtns.forEach((b, i) => b.classList.toggle('on', DIFFICULTY_ORDER[i] === diff));
      slotBtns.forEach((b, i) => b.classList.toggle('on', i + 1 === slotNo));
      const d = DIFFICULTIES[diff];
      desc.replaceChildren(h('strong', {}, d.intent), h('br'), d.description);
    };
    paint();
    this.show(h('div', { class: 'screen' },
      h('h2', {}, ngPlus ? 'New Game+' : 'New game'),
      ngPlus ? h('p', { class: 'muted' }, 'Entities are sharper and faster. Your lenses and titles carry over.') : null,
      h('label', { class: 'field' }, 'Save slot', h('div', { class: 'chips' }, ...slotBtns)),
      h('label', { class: 'field' }, 'Difficulty', h('div', { class: 'chips' }, ...diffBtns), desc),
      h('label', { class: 'field' }, 'Run seed', seed, h('small', { class: 'muted' }, 'Share a seed to give someone the same run. Leave empty for a random one.')),
      h('label', { class: 'field' }, h('span', {}, speed, ' Speedrun mode'), h('small', { class: 'muted' }, 'Fixed seed, a running timer, and your time is recorded when you finish.')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => this.showTitle() }, 'Back'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (slots[slotNo - 1] && !confirm(`Overwrite slot ${slotNo}?`)) return;
          this.game.ensureAudio();
          await this.game.newGame(slotNo, diff, seed.value || randomSeedString(), { speedrun: speed.checked, ngPlus });
        } }, 'Begin'))));
  }

  // ---- in game ----

  showHud(on: boolean): void { this.hud.hidden = !on; }

  showPause(on: boolean): void {
    if (!on) { this.show(null); return; }
    this.show(h('div', { class: 'screen center' },
      h('h2', {}, 'Paused'),
      h('div', { class: 'menu' },
        h('button', { class: 'btn primary', onclick: () => this.game.pause(false) }, 'Resume'),
        this.game.currentSlot ? h('button', { class: 'btn', onclick: () => { const slot = this.game.currentSlot!; this.show(replayPanel(this.game, slot, () => this.showPause(true))); } }, 'Replay a Level') : null,
        h('button', { class: 'btn', onclick: () => this.settingsScreen('pause') }, 'Settings'),
        h('button', { class: 'btn', onclick: async () => { await this.game.autosave(); this.game.loop.paused = false; this.game.currentSlot = null; await this.game.showMenu(); } }, 'Exit to menu'))));
  }

  /**
   * Tap / click a hotbar slot. First tap selects it; tapping the selected slot again uses it (toggles the
   * flashlight or camcorder, eats / drinks / lights the item). Selecting never uses anything by itself.
   */
  private pickSlot(i: number): void {
    const L = this.game.level; if (!L) return;
    const sim = L.sim, inv = sim.inv;
    if (inv.selected !== i) { inv.selected = i; this.game.sounds()?.click('tick'); return; }
    const id = inv.held;
    if (id === 'flashlight') sim.flash.on = !sim.flash.on;
    else if (id === 'camcorder') sim.cam.toggle();
    else if (id) sim.useHeld();
  }

  /** Jump-scare overlay: white-hot flash into blood red, whole-screen shake, and for a lethal hit a slow fade to static and black. */
  private playScare(kind: string, ms: number): void {
    const el = this.scareEl, app = document.getElementById('app')!;
    el.className = 'scare';
    void el.offsetWidth; // restart the animation
    el.classList.add('on', kind);
    app.classList.remove('shaking', 'shake-hard');
    void app.offsetWidth;
    if (!this.game.settings.value.reduceShake) app.classList.add(kind === 'light' || kind === 'jolt' ? 'shaking' : 'shake-hard');
    window.setTimeout(() => { app.classList.remove('shaking', 'shake-hard'); if (kind !== 'lethal') el.classList.remove('on', kind); }, Math.min(ms, kind === 'lethal' ? 1700 : ms));
    if (kind === 'lethal') window.setTimeout(() => el.classList.add('dead'), 1500);
    else window.setTimeout(() => el.classList.remove('dead'), 0);
  }

  /** Clear any lingering death overlay (respawn, new level). */
  clearScare(): void { this.scareEl.className = 'scare'; document.getElementById('app')?.classList.remove('shaking', 'shake-hard'); }

  inGame(level: LevelScene | null): void {
    if (!level) return;
    const bpm = Math.round(level.bpm);
    if (bpm !== this.lastBpm) {
      this.lastBpm = bpm;
      ($('b', this.heartEl) as HTMLElement).textContent = String(bpm);
      this.heartEl.style.setProperty('--beat', `${(60 / bpm).toFixed(3)}s`);
      this.heartEl.classList.toggle('high', bpm >= 110); this.heartEl.classList.toggle('extreme', bpm >= 145);
    }
    this.vigEl.style.setProperty('--beat', `${(60 / Math.max(50, bpm)).toFixed(3)}s`);
    this.vigEl.style.opacity = String(Math.min(0.95, Math.max(0, (level.stress - 0.15) * 1.3)));
    const sim = level.sim, st = sim.stats, inv = sim.inv;
    const s = sim.player.stamina;
    ($('i', this.stamina) as HTMLElement).style.width = `${s}%`;
    this.stamina.classList.toggle('low', s < 25);
    const p = level.prompt;
    const o = level.objective;
    const big = sim.time < 14; // the first seconds of a level: make it hard to miss
    const objText = o ? `${o.text}${o.sub ? `\n${o.sub}` : ''}${level.objectiveHint ? `\n${level.objectiveHint}` : ''}` : '';
    if (objText !== this.lastObj) {
      this.lastObj = objText;
      this.objEl.replaceChildren(...(o ? [h('small', {}, big ? 'GOAL' : 'NOW'), h('div', {}, ...objText.split('\n').flatMap((t, i) => [i ? h('em', {}, t) : document.createTextNode(t)]))] : []));
    }
    this.objEl.classList.toggle('big', big);
    const touch = this.game.input.device === 'touch';
    const text = p ? (touch ? p : `[${glyphFor('Interact', this.game.input.device, this.game.settings.value.bindings, this.game.input.padLayout)}] ${p}`) : '';
    this.game.input.touch.setInteract(touch && p ? verbFor(p) : null);
    this.promptEl.classList.toggle('touch', touch);
    if (text !== this.lastPrompt) { this.promptEl.textContent = text; this.lastPrompt = text; }
    const t = new Date(Date.UTC(1993, 5, 14, 3, 12, 0) + sim.time * 1000);
    if (this.game.currentSlot?.flags.speedrun) { const tot = this.game.currentSlot.playtime + sim.time; this.timeEl.textContent = `RUN ${fmtTime(tot)}`; } else this.timeEl.textContent = `${t.getUTCHours().toString().padStart(2, '0')}:${t.getUTCMinutes().toString().padStart(2, '0')}:${t.getUTCSeconds().toString().padStart(2, '0')}  SP`;
    ($('i', this.noise) as HTMLElement).style.width = `${Math.round(Math.min(1, sim.player.noise) * 100)}%`;
    // touch: the Use / Throw buttons exist only while the held item can be used / something can be thrown
    const held = inv.held;
    this.game.input.touch.setContext({ UseItem: !!held && held !== 'flashlight' && held !== 'camcorder' && (!!itemDef(held).use || held === 'radio' || held === 'tripline'), Throw: sim.x.canThrow() });
    // hotbar: the four buttons are created once and updated in place (rebuilding them under a finger lost taps)
    const hbKey = inv.hotbar.map((id) => (id ? `${id}${inv.count(id)}` : '-')).join(',') + `|${inv.selected}`;
    if (hbKey !== this.hotbarKey) {
      this.hotbarKey = hbKey;
      inv.hotbar.forEach((id, i) => {
        const b = this.slotEls[i];
        b.classList.toggle('on', inv.selected === i);
        b.classList.toggle('empty', !id);
        (b.lastChild as Text).textContent = id ? `${itemDef(id).name}${inv.count(id) > 1 ? ` ×${inv.count(id)}` : ''}` : '—';
      });
    }
    // vitals / gear: rebuilt only when something visible changed
    const key = [level.def.id, !!sim.plan.cold, sim.hungerEnabled, st.breath < 99, Math.round(st.health / 5), Math.round(st.sanity / 5), Math.round(st.hunger / 5), Math.round(st.thirst / 5), Math.round(sim.flash.battery), Math.round(sim.cam.battery / 5), sim.flash.on, sim.cam.nightVision, Math.round(st.breath / 5), Math.round(st.warmth / 5), inv.has('compass') ? Math.round(((-sim.player.yaw * 180) / Math.PI + 3600) % 360 / 15) : -1].join('|');
    if (key === this.hudKey) return;
    this.hudKey = key;
    const bar = (label: string, v: number) => [h('span', {}, label), h('div', { class: 'vb' + (v < 25 ? ' low' : '') }, h('i', { style: `width:${Math.round(v)}%` }))];
    this.vitals.replaceChildren(...bar('HP', st.health), ...bar('MIND', st.sanity), ...(sim.hungerEnabled && sim.diff.hungerRate > 0 ? [...bar('FOOD', st.hunger), ...bar('WATER', st.thirst)] : []), ...(st.breath < 99 ? bar('AIR', st.breath) : []), ...(sim.plan.cold ? bar('WARM', st.warmth) : []));
    this.vitals.classList.toggle('calm', st.health > 90 && st.sanity > 85 && st.hunger > 70 && st.thirst > 70);
    const hd = ((-sim.player.yaw * 180) / Math.PI + 3600) % 360;
    const compass = inv.has('compass') ? `  ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(hd / 45) % 8]} ${Math.round(hd)}°` : '';
    this.gear.textContent = `${sim.flash.on && inv.has('flashlight') ? '☼' : '☼̸'} ${Math.round(sim.flash.battery)}%   ${sim.cam.nightVision ? 'NV ON' : 'NV'} ${Math.round(sim.cam.battery)}%${compass}`;
  }

  frame(game: Game): void {
    const on = game.settings.value.showFps;
    this.statsEl.hidden = !on;
    if (!on || performance.now() % 4 > 1) return;
    const st = game.gfx.stats();
    const fs = game.frameStats();
    this.statsEl.textContent = `${fs.fps.toFixed(0)} fps  ${fs.avgMs.toFixed(1)} ms (p99 ${fs.p99Ms.toFixed(1)})\n${game.tier().label} x${game.gfx.scale.toFixed(2)}  draws ${st.calls}  tris ${(st.triangles / 1000).toFixed(0)}k\ndevice: ${game.input.device}${game.pool.inline ? '  inline-gen' : ''}`;
  }

  // ---- debug console ----

  toggleDebug(): void {
    if (this.debugOpen) { this.debugEl?.remove(); this.debugEl = null; this.debugOpen = false; if (this.game.state === 'playing') this.game.input.requestLock(); return; }
    this.debugOpen = true;
    if (document.pointerLockElement) document.exitPointerLock();
    const log = h('div', { class: 'dlog' });
    const input = h('input', { type: 'text', spellcheck: false, autocomplete: 'off', placeholder: 'help' });
    const print = (m: string) => { log.append(h('div', {}, m)); log.scrollTop = log.scrollHeight; };
    let hist = -1;
    input.addEventListener('keydown', async (e) => {
      e.stopPropagation();
      if (e.key === '`' || e.key === 'Escape') { e.preventDefault(); this.toggleDebug(); }
      else if (e.key === 'Enter') { const line = input.value; input.value = ''; print(`> ${line}`); hist = -1; await this.game.debug.exec(line, { print }); }
      else if (e.key === 'Tab') { e.preventDefault(); input.value = this.game.debug.complete(input.value); }
      else if (e.key === 'ArrowUp') { const H = this.game.debug.history; hist = Math.min(H.length - 1, hist + 1); input.value = H[H.length - 1 - hist] ?? ''; }
      else if (e.key === 'ArrowDown') { const H = this.game.debug.history; hist = Math.max(-1, hist - 1); input.value = hist < 0 ? '' : H[H.length - 1 - hist]; }
    });
    this.debugEl = h('div', { class: 'debug' }, log, input);
    document.getElementById('app')!.append(this.debugEl);
    print('debug console. "help" lists commands.');
    input.focus();
  }
}

const TIPS = ['Light is a tool. So is silence.', 'Entities hear more than they see.', 'If the hum stops, something changed.', 'Almond water restores more than thirst.', 'Not every corridor leads somewhere.'];
function tipFor(p: number): string { return TIPS[Math.floor(p * 7) % TIPS.length]; }

/** Short imperative for the touch interact button, from the interaction's label. */
export function verbFor(label: string): string {
  const l = label.toLowerCase();
  if (l.startsWith('talk')) return 'Talk';
  if (l.startsWith('continue campaign') || l.startsWith('replay')) return 'Open';
  if (l.startsWith('sealed') || l.includes('not built')) return 'Try';
  if (l.includes('notice board') || l.includes('bestiary') || l.includes('gallery')) return 'Look';
  if (l.includes('stash') || l.includes('kitchen') || l.includes('crafting')) return 'Open';
  if (l.startsWith('read')) return 'Read';
  if (l.startsWith('take') || l.startsWith('pick')) return 'Take';
  if (l.startsWith('hide') || l.includes('hiding')) return l.startsWith('leave') ? 'Come out' : 'Hide';
  if (l.startsWith('unlock')) return 'Unlock';
  if (l.startsWith('activate') || l.startsWith('checkpoint')) return 'Activate';
  if (l.startsWith('leave')) return 'Leave';
  if (l.includes('valve') || l.includes('turn') || l.includes('flip')) return 'Use';
  if (l.includes('locked') || l.includes('needs') || l.includes('stuck') || l.includes('sealed') || l.includes('dead') || l.includes('chasm')) return 'Try';
  return 'Use';
}
