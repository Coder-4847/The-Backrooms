/**
 * InputManager: keyboard + mouse (pointer lock), gamepad (polled), touch. All three feed the
 * same InputFrame each simulation tick. The most recently used device wins, so prompts/glyphs
 * switch instantly. Debug/UI code can inject synthetic input for bots and tests.
 */
import { ACTIONS, type Action, type Bindings, type DeviceKind, type PadLayout, padLayoutFromId } from './actions';
import { applyCurve, applyDeadzone, DeviceTracker, diffActions, digitalMove, emptyActionMap, emptyFrame, padIsActive, resolveActions, type InputFrame } from './logic';
import { TouchControls } from './touch';
import { bus } from '../events';

export interface InputConfig {
  sensitivity: number; invertY: boolean; padDeadzone: number; padCurve: number; padVibration: boolean;
  gyro: boolean; bindings: Bindings;
}

const MOUSE_RAD_PER_PX = 0.0022;
const PAD_LOOK_RAD_PER_SEC = 2.8;
const TOUCH_RAD_PER_PX = 0.0045;
/** Keyboard-only look: arrow keys turn, PageUp/PageDown look up and down. */
const KEY_LOOK_RAD_PER_SEC = 2.3;
/** Keys the browser would otherwise use to scroll or navigate while the game has the keyboard. */
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Space', 'Tab', 'Backquote']);

/** Phones and tablets (including iPadOS, which reports itself as a Mac): touch is the primary input even when a keyboard is attached. */
function isTouchDevice(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  const ipadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return coarse || ipadOs || /iPad|iPhone|Android/i.test(navigator.userAgent) && navigator.maxTouchPoints > 0;
}

export class InputManager {
  readonly tracker: DeviceTracker;
  readonly touch: TouchControls;
  padLayout: PadLayout = 'xbox';
  locked = false;
  /** Set by the game: when true, pointer lock is requested on click. */
  wantLock = false;
  cfg: InputConfig;

  private keys = new Set<string>();
  /** Keys pressed since the last tick: latched so a tap shorter than one frame is never lost. */
  private latched = new Set<string>();
  private prev = emptyActionMap();
  private cur = emptyActionMap();
  private frameOut: InputFrame = emptyFrame();
  private wheelDir = 0;
  /** Touch-first devices (iPad + keyboard): keys and touch work together; pointer lock only once a real mouse shows up. */
  private touchDevice = false;
  private mouseSeen = false;
  private mouseDX = 0; private mouseDY = 0;
  private gyroDX = 0; private gyroDY = 0; private lastGyro: { a: number; b: number } | null = null;
  private tmp = { x: 0, y: 0 };
  private padButtons: boolean[] = new Array(17).fill(false);
  private capture: ((kind: 'kb' | 'pad', code: string | number) => void) | null = null;
  /** Synthetic input (bots, tests). Merged on top of real input when set. */
  inject: Partial<{ moveX: number; moveY: number; lookX: number; lookY: number; held: Set<Action> }> | null = null;
  private injectHeld = new Set<Action>();

  constructor(private el: HTMLElement, cfg: InputConfig, uiParent: HTMLElement) {
    this.cfg = cfg;
    this.touchDevice = isTouchDevice();
    this.tracker = new DeviceTracker(this.touchDevice ? 'touch' : 'kbm');
    this.touch = new TouchControls(uiParent);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('click', this.onClick);
    // mouse buttons act like keys ("Mouse0" = left) while the pointer is locked, so they can be bound (Use item = left click)
    el.addEventListener('mousedown', (e) => { if (!this.locked) return; const code = `Mouse${e.button}`; this.note('kbm'); this.keys.add(code); this.latched.add(code); });
    window.addEventListener('mouseup', (e) => { this.keys.delete(`Mouse${e.button}`); });
    el.addEventListener('wheel', (e) => { this.wheelDir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0; }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.note('touch'); }, { passive: true });
    window.addEventListener('gamepadconnected', (e) => { this.padLayout = padLayoutFromId(e.gamepad.id); });
    window.addEventListener('deviceorientation', this.onOrientation);
    this.touch.setVisible(false); // shown only while playing, so it never covers the menus
  }

  get device(): DeviceKind { return this.tracker.device; }

  private note(d: DeviceKind): void {
    if (this.tracker.note(d)) {
      this.touch.setVisible(this.wantLock && this.touchWanted());
      bus.emit('device:changed', { device: d });
    }
  }

  setGameplayActive(active: boolean): void {
    this.wantLock = active;
    this.touch.setVisible(active && this.touchWanted());
    if (!active && document.pointerLockElement) document.exitPointerLock();
  }

  /** Touch controls stay up on touch devices while a keyboard is in use; they only step aside for a gamepad. */
  private touchWanted(): boolean {
    const d = this.tracker.device;
    return d === 'touch' || (this.touchDevice && d === 'kbm');
  }

  requestLock(): void {
    if (this.tracker.device === 'kbm' && (!this.touchDevice || this.mouseSeen) && !document.pointerLockElement) { try { (this.el.requestPointerLock?.() as unknown as Promise<void> | undefined)?.catch?.(() => { /* no user gesture (e.g. after a timed respawn): the next click re-locks */ }); } catch { /* older browsers throw synchronously */ } }
  }

  /** Next key or pad button pressed is reported (for the rebinding UI). */
  captureNext(cb: (kind: 'kb' | 'pad', code: string | number) => void): void { this.capture = cb; }
  cancelCapture(): void { this.capture = null; }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c('kb', e.code); return; }
    this.note('kbm');
    if (!e.repeat) { this.keys.add(e.code); this.latched.add(e.code); }
    // while playing, the arrow / page keys must never scroll or zoom the page (that is what made the screen "bug out")
    if (NAV_KEYS.has(e.code) && (this.wantLock || e.code === 'Tab' || e.code === 'Space' || e.code === 'Backquote')) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private onMouseMove = (e: MouseEvent): void => {
    this.mouseSeen = true;
    if (!this.locked) return;
    // Chrome can deliver one huge bogus delta right after pointer lock engages: ignore it
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    this.note('kbm');
    this.mouseDX += e.movementX; this.mouseDY += e.movementY;
  };
  private onClick = (): void => { if (this.wantLock) this.requestLock(); };

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.cfg.gyro || this.tracker.device !== 'touch' || e.alpha === null || e.beta === null) return;
    if (this.lastGyro) {
      let da = e.alpha - this.lastGyro.a;
      if (da > 180) da -= 360; if (da < -180) da += 360;
      this.gyroDX += -da * (Math.PI / 180); this.gyroDY += (e.beta - this.lastGyro.b) * (Math.PI / 180);
    }
    this.lastGyro = { a: e.alpha, b: e.beta };
  };

  /** Build this tick's input. Call exactly once per simulation step. */
  frame(dt: number): InputFrame {
    const f = this.frameOut;
    const cfg = this.cfg;
    f.moveX = f.moveY = f.lookX = f.lookY = 0;

    // --- keyboard move ---
    const b = cfg.bindings;
    const k = this.keys;
    const anyKey = k.size > 0;
    if (anyKey) digitalMove(k.has('KeyA'), k.has('KeyD'), k.has('KeyW') || k.has('ArrowUp'), k.has('KeyS') || k.has('ArrowDown'), this.tmp); // arrows: up/down walk, left/right turn (below)
    f.moveX = this.tmp.x; f.moveY = this.tmp.y;
    if (!anyKey) { f.moveX = 0; f.moveY = 0; }

    // --- mouse look ---
    const sens = cfg.sensitivity * MOUSE_RAD_PER_PX;
    f.lookX = this.mouseDX * sens; f.lookY = this.mouseDY * sens * (cfg.invertY ? -1 : 1);
    this.mouseDX = this.mouseDY = 0;
    // --- keyboard look (no mouse needed): arrows turn, PageUp / PageDown look up and down ---
    if (anyKey) {
      const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0); // same sign as moving the mouse right
      const tilt = (k.has('PageDown') ? 1 : 0) - (k.has('PageUp') ? 1 : 0);
      f.lookX += turn * KEY_LOOK_RAD_PER_SEC * cfg.sensitivity * dt;
      f.lookY += tilt * KEY_LOOK_RAD_PER_SEC * 0.7 * cfg.sensitivity * dt;
    }

    // --- gamepad ---
    const pads = navigator.getGamepads?.() ?? [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    const padDown = this.padButtons;
    if (pad) {
      this.padLayout = padLayoutFromId(pad.id);
      for (let i = 0; i < padDown.length; i++) padDown[i] = !!pad.buttons[i]?.pressed;
      if (this.capture) {
        const i = padDown.findIndex(Boolean);
        if (i >= 0) { const c = this.capture; this.capture = null; c('pad', i); }
      }
      if (padIsActive(pad.axes, padDown.some(Boolean))) this.note('gamepad');
      if (this.tracker.device === 'gamepad') {
        applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, cfg.padDeadzone, this.tmp);
        f.moveX = applyCurve(this.tmp.x, 1.2); f.moveY = applyCurve(-this.tmp.y, 1.2);
        applyDeadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, cfg.padDeadzone, this.tmp);
        const lx = applyCurve(this.tmp.x, cfg.padCurve), ly = applyCurve(this.tmp.y, cfg.padCurve);
        f.lookX += lx * PAD_LOOK_RAD_PER_SEC * cfg.sensitivity * dt;
        f.lookY += ly * PAD_LOOK_RAD_PER_SEC * cfg.sensitivity * dt * (cfg.invertY ? -1 : 1);
      }
    } else padDown.fill(false);

    // --- touch ---
    if (this.touch.visible) { // (also while a keyboard is in use on a tablet)
      this.touch.takeLook(this.tmp);
      f.lookX += this.tmp.x * TOUCH_RAD_PER_PX * cfg.sensitivity + this.gyroDX;
      f.lookY += this.tmp.y * TOUCH_RAD_PER_PX * cfg.sensitivity * (cfg.invertY ? -1 : 1) + this.gyroDY;
      this.gyroDX = this.gyroDY = 0;
      if (this.touch.moveX || this.touch.moveY) { f.moveX = this.touch.moveX; f.moveY = this.touch.moveY; }
    }

    // --- synthetic input ---
    if (this.inject) {
      const j = this.inject;
      if (j.moveX !== undefined) f.moveX = j.moveX;
      if (j.moveY !== undefined) f.moveY = j.moveY;
      f.lookX += j.lookX ?? 0; f.lookY += j.lookY ?? 0;
      this.injectHeld = j.held ?? this.injectHeld;
    }

    // --- actions ---
    const touchHeld = this.touch.takeHeld();
    for (const a of this.injectHeld) touchHeld.add(a);
    const held = this.latched.size ? new Set([...this.keys, ...this.latched]) : this.keys;
    const fresh = this.latched.size ? new Set(this.latched) : null;
    this.latched.clear();
    resolveActions(b, held, padDown, touchHeld, this.cur);
    diffActions(this.prev, this.cur, f.pressed, f.released);
    // every keydown since the last tick is a new press, even if the previous tap was already latched (rapid double taps)
    if (fresh) { const a = emptyActionMap(); resolveActions(b, fresh, [], new Set(), a); for (const k of ACTIONS) if (a[k]) f.pressed[k] = true; }
    for (const a of ACTIONS) { f.down[a] = this.cur[a]; this.prev[a] = this.cur[a]; }
    if (this.wheelDir) { if (this.wheelDir > 0) f.pressed.NextItem = true; else f.pressed.PrevItem = true; this.wheelDir = 0; }
    f.device = this.tracker.device;
    return f;
  }

  /** Gamepad rumble for heartbeat / damage / proximity cues. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.cfg.padVibration || this.tracker.device !== 'gamepad') return;
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected) as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => void } }) | undefined;
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak });
  }
}
