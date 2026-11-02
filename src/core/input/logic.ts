/**
 * Pure input maths: dead zones, response curves, binding resolution, device auto-switching.
 * No DOM here so it is unit-testable.
 */
import { ACTIONS, type Action, type Bindings, type DeviceKind } from './actions';

/** Radial dead zone with rescaling so output ramps from 0 at the edge of the zone. */
export function applyDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const m = Math.hypot(x, y);
  if (m <= dz) { out.x = 0; out.y = 0; return; }
  const s = Math.min(1, (m - dz) / (1 - dz)) / m;
  out.x = x * s; out.y = y * s;
}

/** Response curve: 1 = linear, >1 = finer control near the centre. */
export function applyCurve(v: number, curve: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), curve);
}

export interface InputFrame {
  /** x: strafe right+, y: forward+. Length <= 1. */
  moveX: number;
  moveY: number;
  /** Look delta this tick in radians (already scaled by sensitivity). */
  lookX: number;
  lookY: number;
  down: Record<Action, boolean>;
  pressed: Record<Action, boolean>;
  released: Record<Action, boolean>;
  device: DeviceKind;
}

export function emptyActionMap(): Record<Action, boolean> {
  return Object.fromEntries(ACTIONS.map((a) => [a, false])) as Record<Action, boolean>;
}

export function emptyFrame(device: DeviceKind = 'kbm'): InputFrame {
  return { moveX: 0, moveY: 0, lookX: 0, lookY: 0, down: emptyActionMap(), pressed: emptyActionMap(), released: emptyActionMap(), device };
}

/** Which actions are held given the raw held keys and pad buttons. */
export function resolveActions(b: Bindings, keys: ReadonlySet<string>, pad: readonly boolean[], touch: ReadonlySet<Action>, out: Record<Action, boolean>): void {
  for (const a of ACTIONS) {
    let on = touch.has(a);
    if (!on) for (const k of b[a].kb) if (keys.has(k)) { on = true; break; }
    if (!on) for (const p of b[a].pad) if (pad[p]) { on = true; break; }
    out[a] = on;
  }
}

/** Edge detection between two held-maps. */
export function diffActions(prev: Record<Action, boolean>, cur: Record<Action, boolean>, pressed: Record<Action, boolean>, released: Record<Action, boolean>): void {
  for (const a of ACTIONS) { pressed[a] = cur[a] && !prev[a]; released[a] = !cur[a] && prev[a]; }
}

/** Auto-detect and switch devices: the most recently *used* device wins; tiny stick noise is ignored. */
export class DeviceTracker {
  device: DeviceKind;
  constructor(initial: DeviceKind = 'kbm') { this.device = initial; }
  /** Returns true if the active device changed. */
  note(d: DeviceKind): boolean {
    if (d === this.device) return false;
    this.device = d;
    return true;
  }
}

/** Gamepad stick drift guard: only count the pad as "used" when input is meaningful. */
export function padIsActive(axes: readonly number[], anyButton: boolean): boolean {
  return anyButton || axes.some((a) => Math.abs(a) > 0.35);
}

/** Move vector from 4 digital directions, normalised so diagonals are not faster. */
export function digitalMove(l: boolean, r: boolean, f: boolean, b: boolean, out: { x: number; y: number }): void {
  let x = (r ? 1 : 0) - (l ? 1 : 0);
  let y = (f ? 1 : 0) - (b ? 1 : 0);
  const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  out.x = x; out.y = y;
}
