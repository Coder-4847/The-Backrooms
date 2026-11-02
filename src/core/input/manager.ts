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
  private wheelPulse = false;
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
    const touchFirst = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
    this.tracker = new DeviceTracker(touchFirst ? 'touch' : 'kbm');
    this.touch = new TouchControls(uiParent);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousemove', this.onMouseMove);
    el.addEventListener('click', this.onClick);
    el.addEventListener('wheel', () => { this.wheelPulse = true; }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') this.note('touch'); }, { passive: true });
    window.addEventListener('gamepadconnected', (e) => { this.padLayout = padLayoutFromId(e.gamepad.id); });
    window.addEventListener('deviceorientation', this.onOrientation);
    this.touch.setVisible(this.tracker.device === 'touch');
  }

  get device(): DeviceKind { return this.tracker.device; }

  private note(d: DeviceKind): void {
    if (this.tracker.note(d)) {
      this.touch.setVisible(d === 'touch' && this.wantLock);
      bus.emit('device:changed', { device: d });
    }
  }

  setGameplayActive(active: boolean): void {
    this.wantLock = active;
    this.touch.setVisible(active && this.tracker.device === 'touch');
    if (!active && document.pointerLockElement) document.exitPointerLock();
  }

  requestLock(): void {
    if (this.tracker.device === 'kbm' && !document.pointerLockElement) this.el.requestPointerLock?.();
  }

  /** Next key or pad button pressed is reported (for the rebinding UI). */
  captureNext(cb: (kind: 'kb' | 'pad', code: string | number) => void): void { this.capture = cb; }
  cancelCapture(): void { this.capture = null; }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c('kb', e.code); return; }
    this.note('kbm');
    if (!e.repeat) { this.keys.add(e.code); this.latched.add(e.code); }
    if (e.code === 'Tab' || e.code === 'Space' || e.code === 'Backquote') e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent): void => { this.keys.delete(e.code); };
  private onMouseMove = (e: MouseEvent): void => {
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
    if (anyKey) digitalMove(k.has('KeyA') || k.has('ArrowLeft'), k.has('KeyD') || k.has('ArrowRight'), k.has('KeyW') || k.has('ArrowUp'), k.has('KeyS') || k.has('ArrowDown'), this.tmp);
    f.moveX = this.tmp.x; f.moveY = this.tmp.y;
    if (!anyKey) { f.moveX = 0; f.moveY = 0; }

    // --- mouse look ---
    const sens = cfg.sensitivity * MOUSE_RAD_PER_PX;
    f.lookX = this.mouseDX * sens; f.lookY = this.mouseDY * sens * (cfg.invertY ? -1 : 1);
    this.mouseDX = this.mouseDY = 0;

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
    if (this.tracker.device === 'touch' && this.touch.visible) {
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
    const touchHeld = new Set<Action>(this.touch.held);
    for (const a of this.injectHeld) touchHeld.add(a);
    const held = this.latched.size ? new Set([...this.keys, ...this.latched]) : this.keys;
    this.latched.clear();
    resolveActions(b, held, padDown, touchHeld, this.cur);
    diffActions(this.prev, this.cur, f.pressed, f.released);
    for (const a of ACTIONS) { f.down[a] = this.cur[a]; this.prev[a] = this.cur[a]; }
    if (this.wheelPulse) { f.pressed.NextItem = true; this.wheelPulse = false; }
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
