/**
 * Game: top-level orchestrator. Owns storage/saves, settings, renderer, input, audio, worker pool,
 * the fixed-step loop, adaptive quality, and the active scene (menu backdrop or a level).
 */
import { Gfx } from '../render/gfx';
import { AdaptiveQuality, TIERS, pickTier, resolveTier, type TierDef, type TierId } from '../render/quality';
import { runBenchmark } from '../render/benchmark';
import { WorkerPool } from '../gen/pool';
import { AudioEngine } from '../audio/engine';
import { Sounds } from '../audio/sounds';
import { Loop } from './loop';
import { openBestStorage, requestPersistence } from './storage';
import { SaveManager, type Profile, type SlotData } from './save';
import { SettingsStore, fpsCapOf, type Settings } from './settings';
import { InputManager } from './input/manager';
import { bus } from './events';
import { emptyFrame } from './input/logic';
import { DIFFICULTIES, type DifficultyId } from './difficulty';
import { LevelScene } from '../levels/scene';
import { levelById } from '../levels/registry';
import { registerDebugCommands } from './debugCommands';
import { runPerf } from './perf';
import { debugEnabled, CommandRegistry } from './debug';
import { Ui } from '../ui/ui';
import { Flow } from './flow';
import { lensById } from '../ui/panels2';
import type { Services } from './services';

const GRAPHICS_KEYS = new Set(['tier', 'resolutionScale', 'fov', 'drawDistance', 'shadowQuality', 'antialias', 'bloom', 'ssao', 'vhs', 'grain', 'dust', 'batterySaver']);

export type GameState = 'boot' | 'menu' | 'loading' | 'playing' | 'paused';

export class Game implements Services {
  saves!: SaveManager;
  profile!: Profile;
  settings!: SettingsStore;
  gfx!: Gfx;
  input!: InputManager;
  pool!: WorkerPool;
  loop!: Loop;
  ui!: Ui;
  basePath = import.meta.env.BASE_URL ?? '/';
  audioEngine: AudioEngine | null = null;
  soundBank: Sounds | null = null;
  state: GameState = 'boot';
  level: LevelScene | null = null;
  backdrop: LevelScene | null = null;
  autoTier: TierId = 'high';
  adaptive!: AdaptiveQuality;
  debug = new CommandRegistry();
  currentSlot: SlotData | null = null;
  flow!: Flow;
  private canvasEl: HTMLCanvasElement;
  runStart = 0;
  fps = 0;
  private frameTimes: number[] = [];
  /** Perf harness hook: called every rendered frame with (dt seconds, frame ms). */
  perfHook: ((dt: number, frameMs: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) { this.canvasEl = canvas; }

  audio = () => this.audioEngine;
  sounds = () => this.soundBank;
  tier = (): TierDef => resolveTier(this.settings.value.tier, this.autoTier);

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const g = new Game(canvas);
    const kv = await openBestStorage();
    g.saves = new SaveManager(kv);
    g.profile = await g.saves.loadProfile();
    g.settings = new SettingsStore(g.profile.settings, (s) => { g.profile.settings = s as unknown as Record<string, unknown>; void g.saves.saveProfile(g.profile); });
    void requestPersistence();
    g.gfx = new Gfx(canvas, g.settings.value);
    g.pool = new WorkerPool();
    g.input = new InputManager(canvas, g.inputConfig(), document.getElementById('app')!);
    g.loop = new Loop({ update: (dt) => g.update(dt), render: (a, ms) => g.render(a, ms) });
    g.flow = new Flow(g);
    g.ui = new Ui(g);
    registerDebugCommands(g);
    g.settings.subscribe((s, key) => g.onSettings(s, key));
    window.addEventListener('resize', () => g.gfx.resize());
    if (debugEnabled()) {
      const w = window as unknown as { __game: Game; __runPerf: (o: Parameters<typeof runPerf>[1]) => Promise<unknown> };
      w.__game = g; w.__runPerf = (o) => runPerf(g, o);
    }
    return g;
  }

  inputConfig() {
    const s = this.settings.value;
    return { sensitivity: s.sensitivity, invertY: s.invertY, padDeadzone: s.padDeadzone, padCurve: s.padCurve, padVibration: s.padVibration, gyro: s.gyro, bindings: s.bindings };
  }

  /** Boot sequence: content warning (first launch), benchmark (Auto), menu. */
  async start(): Promise<void> {
    if (!this.profile.firstLaunchAck) {
      await this.ui.contentWarning();
      this.profile.firstLaunchAck = true;
      await this.saves.saveProfile(this.profile);
    }
    this.autoTier = (this.profile.lastBenchmarkTier as TierId | null) ?? await this.benchmark();
    this.applyAll();
    this.loop.start();
    await this.showMenu();
  }

  /** Run the Auto benchmark and remember the result. */
  async benchmark(): Promise<TierId> {
    this.ui.setLoading(true, 'Calibrating graphics', 0.1);
    await new Promise((r) => setTimeout(r, 50)); // let the loading screen paint
    const hw = this.gfx.hardwareInfo();
    const bench = runBenchmark(this.gfx.renderer);
    const tier = pickTier(bench, hw);
    this.profile.lastBenchmarkTier = tier;
    await this.saves.saveProfile(this.profile);
    this.ui.setLoading(false);
    console.info('benchmark', bench, hw, '->', tier);
    return tier;
  }

  /** Apply every setting to every subsystem (boot, settings load). */
  applyAll(): void {
    const s = this.settings.value;
    const tier = this.tier();
    this.adaptive = new AdaptiveQuality(tier.id, s.tier === 'auto');
    this.gfx.configure(tier, s);
    this.loop.fpsCap = fpsCapOf(s);
    this.audioEngine?.applySettings(s);
    this.ui.applyAccessibility(s);
    this.input.touch.applyLayout(s.touchSize, s.touchOpacity, s.leftHanded, s.oneHanded);
  }

  private onSettings(s: Settings, key: keyof Settings): void {
    this.input.cfg = this.inputConfig();
    if (key === 'tier') { this.adaptive = new AdaptiveQuality(this.tier().id, s.tier === 'auto'); }
    if (GRAPHICS_KEYS.has(key)) this.gfx.configure(this.tier(), s);
    if (key === 'fpsCap' || key === 'batterySaver') this.loop.fpsCap = fpsCapOf(s);
    if (['master', 'music', 'sfx', 'ambience', 'voice', 'subtitles'].includes(key)) this.audioEngine?.applySettings(s);
    if (['textSize', 'highContrast', 'colorblind'].includes(key)) this.ui.applyAccessibility(s);
    if (['touchSize', 'touchOpacity', 'leftHanded', 'oneHanded'].includes(key)) this.input.touch.applyLayout(s.touchSize, s.touchOpacity, s.leftHanded, s.oneHanded);
    if (key === 'reduceFlicker' && this.level) this.level['lights'].reduceFlicker = s.reduceFlicker;
  }

  /** Audio can only start after a user gesture: create lazily on first call from a click. */
  ensureAudio(): void {
    if (!this.audioEngine) {
      try {
        this.audioEngine = new AudioEngine();
        this.soundBank = new Sounds(this.audioEngine);
        this.audioEngine.applySettings(this.settings.value);
      } catch (e) { console.warn('audio unavailable', e); }
    }
    this.audioEngine?.unlock();
  }

  // ---- scenes ----

  async showMenu(): Promise<void> {
    this.state = 'loading';
    this.input.setGameplayActive(false);
    this.level?.dispose(); this.level = null;
    if (!this.backdrop) {
      const def = levelById('testroom')!;
      const t = { ...this.tier(), textureSize: Math.min(256, this.tier().textureSize) };
      const b = new LevelScene(this, def, 0xbacc, 'normal', t);
      this.ui.setLoading(true, 'NOCLIP', 0.05, 'Building the lobby');
      await b.load((p, label) => this.ui.setLoading(true, 'NOCLIP', p, label));
      b.sim.player.noclip = true;
      this.backdrop = b;
      this.ui.setLoading(false);
    }
    this.state = 'menu';
    this.ui.showTitle();
  }

  // ---- flow delegates (see flow.ts) ----

  startLevel(id: string, seedText: string | number, difficulty: DifficultyId, slot: SlotData | null = null): Promise<void> {
    this.currentSlot = slot;
    return this.flow.startLevel(id, seedText, difficulty, { mode: 'campaign' });
  }
  newGame(slotNo: number, difficulty: DifficultyId, seedText: string, opts: { speedrun?: boolean; ngPlus?: boolean } = {}): Promise<void> { return this.flow.newGame(slotNo, difficulty, seedText, opts); }
  resumeSlot(slot: SlotData): Promise<void> { return this.flow.resume(slot); }
  startFromHub(index: number, o: Parameters<Flow['startFromHub']>[1]): Promise<void> { return this.flow.startFromHub(index, o); }
  knownNotes(): string[] { return this.flow.knownNotes(); }

  /** Show the loading screen and tear down the current scene. */
  beginLoad(title: string): void {
    this.state = 'loading';
    this.ui.hideAllMenus(); this.ui.closePanel(); this.ui.clearScare(); this.ui.setLoading(true, title, 0);
    this.input.setGameplayActive(false);
    this.level?.dispose(); this.level = null;
  }

  finishLoad(scene: LevelScene): void {
    this.level = scene;
    this.applyLens();
    this.runStart = performance.now();
    this.ui.setLoading(false);
    this.state = 'playing';
    this.input.setGameplayActive(true);
    this.input.requestLock();
    this.ui.showHud(true);
  }

  /** Equip the chosen camcorder lens if it is unlocked (falls back to standard). */
  applyLens(): void {
    const id = this.settings.value.lens;
    const l = lensById(id);
    const ok = id === 'standard' || this.profile.cosmetics.includes(`lens:${id}`);
    const lens = ok ? l : lensById('standard');
    this.gfx.setLens(lens.tint, lens.sat);
  }

  /** Small JPEG of the current view for the save slot card. */
  thumbnail(): string | null {
    try {
      const src = this.canvasEl;
      const c = document.createElement('canvas'); c.width = 192; c.height = 108;
      c.getContext('2d')!.drawImage(src, 0, 0, 192, 108);
      return c.toDataURL('image/jpeg', 0.6);
    } catch { return null; }
  }

  async autosave(): Promise<void> {
    if (!this.currentSlot || !this.settings.value.autosave) return;
    const s = this.currentSlot;
    s.playtime += (performance.now() - this.runStart) / 1000; this.runStart = performance.now();
    if (this.level && this.flow.inHub) { s.inventory = this.level.sim.inv.toState(); s.stats = this.level.sim.stats.toSave(this.level.sim.player.stamina); }
    await this.saves.saveSlot(s);
    bus.emit('save:written', { slot: s.slot });
  }

  pause(on: boolean): void {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this.state = on ? 'paused' : 'playing';
    this.loop.paused = on;
    this.input.setGameplayActive(!on);
    this.ui.showPause(on);
    if (!on) this.input.requestLock();
  }

  // ---- loop ----

  update(dt: number): void {
    const f = this.input.frame(dt);
    if (f.pressed.Console && debugEnabled()) { this.ui.toggleDebug(); return; }
    if (this.state === 'playing' && this.ui.panelOpen) {
      if (f.pressed.Pause || f.pressed.Inventory || f.pressed.Journal) this.ui.closePanel();
      return;
    }
    if (this.state === 'playing') {
      if (f.pressed.Pause) { this.pause(true); return; }
      if (f.pressed.Inventory && this.level) { this.flow.openInventory(); return; }
      if (f.pressed.Journal) { this.flow.openJournal(); return; }
      if (this.ui.debugOpen) { this.level?.update(dt, emptyFrame()); return; }
      this.level?.update(dt, f);
      this.ui.inGame(this.level);
    } else if (this.state === 'paused' && f.pressed.Pause) this.pause(false);
  }

  render(alpha: number, frameMs: number): void {
    this.trackFps(frameMs);
    const dt = Math.min(0.1, frameMs / 1000);
    this.perfHook?.(dt, frameMs);
    if (this.state === 'menu' && this.backdrop) {
      const p = this.backdrop.sim.player;
      const r = this.backdrop.plan.rooms[this.backdrop.plan.spawn.room];
      const t = performance.now() / 1000;
      p.x = p.px = r.x + r.w / 2 + Math.cos(t * 0.07) * 2.5;
      p.z = p.pz = r.z + r.d * 0.65 + Math.sin(t * 0.05) * 1.2;
      p.yaw = Math.sin(t * 0.09) * 0.7 + 0.2; p.pitch = -0.02;
      this.backdrop.render(alpha, dt);
    } else if (this.level && (this.state === 'playing' || this.state === 'paused')) this.level.render(alpha, dt);
    else if (this.state === 'loading') { /* keep last frame */ }
    const act = this.adaptive.update(frameMs);
    if (act) this.applyAdaptive(act);
    this.ui.frame(this);
  }

  private applyAdaptive(a: NonNullable<ReturnType<AdaptiveQuality['update']>>): void {
    if (a.kind === 'scale') this.gfx.setDynamicScale(a.scale);
    else if (a.kind === 'tierDown') {
      this.autoTier = a.to; this.adaptive.setTier(a.to);
      this.gfx.configure(TIERS[a.to], this.settings.value);
      bus.emit('quality:changed', { tier: a.to, scale: this.gfx.scale, reason: 'frame time' });
      bus.emit('toast', { text: `Performance: lowered graphics to ${TIERS[a.to].label}. Full effect next level.`, kind: 'warn' });
    } else if (a.kind === 'offerUp') bus.emit('quality:offerUp', { tier: a.to });
  }

  private trackFps(frameMs: number): void {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = avg > 0 ? 1000 / avg : 0;
  }

  /** Frame-time statistics over the recent window (used by perf harness). */
  frameStats(): { avgMs: number; p99Ms: number; fps: number; low1Fps: number } {
    const a = [...this.frameTimes].sort((x, y) => x - y);
    if (!a.length) return { avgMs: 0, p99Ms: 0, fps: 0, low1Fps: 0 };
    const avg = a.reduce((x, y) => x + y, 0) / a.length;
    const p99 = a[Math.min(a.length - 1, Math.floor(a.length * 0.99))];
    return { avgMs: avg, p99Ms: p99, fps: 1000 / avg, low1Fps: 1000 / p99 };
  }

  get difficultyDef() { return DIFFICULTIES[this.currentSlot?.difficulty ?? this.settings.value.difficulty]; }
}
