/**
 * Touch controls: dynamic virtual joystick (left), look zone (right), and contextual buttons
 * that only appear when relevant. Handedness, size and opacity come from settings via CSS vars.
 */
import type { Action } from './actions';

interface BtnDef { action: Action; label: string; slot: number; always?: boolean }
// slot = position in the button cluster (0 = nearest thumb)
const BUTTONS: BtnDef[] = [
  { action: 'Flashlight', label: '☼', slot: 1, always: true },
  { action: 'Crouch', label: '▽', slot: 2, always: true },
  { action: 'Sprint', label: '»', slot: 3, always: true },
  { action: 'Inventory', label: '▤', slot: 4, always: true },
  { action: 'UseItem', label: 'USE', slot: 5 },
  { action: 'Throw', label: '↗', slot: 7 },
  { action: 'Pause', label: '❙❙', slot: 6, always: true },
];

export class TouchControls {
  readonly root: HTMLElement;
  readonly held = new Set<Action>();
  /** Buttons tapped since the last simulation tick: a tap shorter than one frame must still count. */
  private tapped = new Set<Action>();
  private interactEl: HTMLButtonElement;
  private interactVerb = '';
  moveX = 0; moveY = 0; lookDX = 0; lookDY = 0;
  /** Swipe gesture accumulators (for shake-to-recharge). */
  swipeEnergy = 0;
  private joyId = -1; private lookId = -1;
  private joyOrigin = { x: 0, y: 0 };
  private joyEl: HTMLElement; private knobEl: HTMLElement;
  private lastLook = { x: 0, y: 0 };
  private btns = new Map<Action, HTMLElement>();
  visible = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch-root';
    this.root.innerHTML = `<div class="touch-joy"><div class="touch-knob"></div></div><div class="touch-cluster"></div>`;
    this.joyEl = this.root.querySelector('.touch-joy')!;
    this.knobEl = this.root.querySelector('.touch-knob')!;
    const cluster = this.root.querySelector('.touch-cluster')!;
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = 'touch-btn';
      el.textContent = b.label;
      el.dataset.slot = String(b.slot);
      el.setAttribute('aria-label', b.action);
      if (!b.always) el.hidden = true;
      this.bindButton(el, b.action);
      // pause lives at the screen corner, outside the (scaled) cluster so it stays put
      (b.action === 'Pause' ? this.root : cluster).appendChild(el);
      this.btns.set(b.action, el);
    }
    // the contextual interact button: large, labelled with the verb, only present while something is in reach
    this.interactEl = document.createElement('button');
    this.interactEl.className = 'touch-interact';
    this.interactEl.hidden = true;
    this.interactEl.setAttribute('aria-label', 'Interact');
    this.interactEl.innerHTML = '<b>TAP</b><span></span>';
    this.bindButton(this.interactEl, 'Interact');
    this.root.appendChild(this.interactEl);
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    this.setVisible(false);
  }

  private bindButton(el: HTMLElement, action: Action): void {
    const down = (e: Event) => { e.preventDefault(); e.stopPropagation(); this.held.add(action); this.tapped.add(action); el.classList.add('on'); navigator.vibrate?.(8); };
    const up = (e: Event) => { e.stopPropagation(); this.held.delete(action); el.classList.remove('on'); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  /** Actions held now plus any tapped since the last call (cleared). Call once per input sample. */
  takeHeld(): Set<Action> { const out = new Set<Action>([...this.held, ...this.tapped]); this.tapped.clear(); return out; }

  /** Show the interact button with a short verb (or hide it when `verb` is null). */
  setInteract(verb: string | null): void {
    const show = verb !== null;
    if (this.interactEl.hidden === !show && (!show || verb === this.interactVerb)) return;
    this.interactEl.hidden = !show;
    if (show) { this.interactVerb = verb; this.interactEl.querySelector('span')!.textContent = verb; if (!this.interactEl.classList.contains('shown')) navigator.vibrate?.(5); }
    this.interactEl.classList.toggle('shown', show);
    if (!show) { this.held.delete('Interact'); this.interactEl.classList.remove('on'); }
  }

  setVisible(v: boolean): void { this.visible = v; this.root.style.display = v ? '' : 'none'; if (!v) this.reset(); }

  /** Show only the contextual buttons that matter right now (e.g. Interact near an object). */
  setContext(ctx: Partial<Record<Action, boolean>>): void {
    for (const b of BUTTONS) if (!b.always) this.btns.get(b.action)!.hidden = !ctx[b.action];
  }

  applyLayout(size: number, opacity: number, leftHanded: boolean, oneHanded: boolean): void {
    const s = this.root.style;
    s.setProperty('--touch-size', String(size));
    s.setProperty('--touch-opacity', String(opacity));
    this.root.classList.toggle('lefty', leftHanded);
    this.root.classList.toggle('onehand', oneHanded);
  }

  private reset(): void {
    this.held.clear(); this.tapped.clear(); this.moveX = this.moveY = 0; this.joyId = this.lookId = -1;
    this.joyEl.style.display = 'none';
  }

  private joyOnLeft(x: number): boolean {
    const half = x < window.innerWidth / 2;
    return this.root.classList.contains('lefty') ? !half : half;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const oneHand = this.root.classList.contains('onehand');
    if ((oneHand || this.joyOnLeft(e.clientX)) && this.joyId < 0) {
      this.joyId = e.pointerId;
      this.joyOrigin = { x: e.clientX, y: e.clientY };
      this.joyEl.style.display = 'block';
      this.joyEl.style.left = `${e.clientX}px`;
      this.joyEl.style.top = `${e.clientY}px`;
    } else if (this.lookId < 0 && !oneHand) {
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
    this.root.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      const R = 56;
      let dx = e.clientX - this.joyOrigin.x, dy = e.clientY - this.joyOrigin.y;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
      this.moveX = dx / R; this.moveY = -dy / R;
      this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === this.lookId) {
      const dx = e.clientX - this.lastLook.x, dy = e.clientY - this.lastLook.y;
      this.lookDX += dx; this.lookDY += dy;
      this.swipeEnergy += Math.abs(dx) + Math.abs(dy);
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.joyId) {
      this.joyId = -1; this.moveX = this.moveY = 0;
      this.joyEl.style.display = 'none';
      this.knobEl.style.transform = '';
    } else if (e.pointerId === this.lookId) this.lookId = -1;
  };

  /** Consume accumulated look pixels. */
  takeLook(out: { x: number; y: number }): void { out.x = this.lookDX; out.y = this.lookDY; this.lookDX = this.lookDY = 0; }
  /** Pulse haptics (heartbeat, damage). */
  haptic(ms: number): void { navigator.vibrate?.(ms); }
}
