/**
 * Jumpscare: the cinematic that plays whenever something lands a hit.
 *  - the camera snaps onto the attacker (yaw + pitch to its head) and input is frozen;
 *  - its body rushes to arm's length and pushes in closer, face to face, shaking, arms up;
 *  - FOV punch, camera roll and jitter, a white-to-red flash and a shake of the whole screen (DOM overlay),
 *    glitch + fear into the post chain, a screaming sting, a sub boom, tinnitus and haptics;
 *  - `lethal` hits hold on its face for a couple of seconds, then fade to static/black before the death flow.
 * Purely presentational: the sim already applied the damage. The sim is frozen when the hit was lethal.
 */
import type { Camera } from 'three';
import { bus } from '../core/events';
import type { Services } from '../core/services';
import type { Entity } from '../entities/ai';
import type { LevelSim } from './sim';
import type { EntityVisuals } from './entityVisuals';

export type ScareKind = 'light' | 'heavy' | 'lethal';

const DUR: Record<ScareKind, number> = { light: 0.6, heavy: 1.25, lethal: 2.7 };
const LOCK: Record<ScareKind, number> = { light: 0.4, heavy: 1.0, lethal: 3 };

export class Jumpscare {
  kind: ScareKind = 'light';
  private t = 0;
  private dur = 0;
  private e: Entity | null = null;
  private d0 = 1.5;
  private wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  /** Called once when the scare finishes (the death flow waits on this for lethal hits). */
  onDone: (() => void) | null = null;
  roll = 0;
  jitterX = 0; jitterY = 0;

  constructor(private svc: Services, private sim: LevelSim, private ev: EntityVisuals) {}

  get active(): boolean { return this.t < this.dur; }
  /** 0..1 how far into the scare we are. */
  get progress(): number { return this.dur ? Math.min(1, this.t / this.dur) : 1; }

  /** Pick the intensity from the hit: lethal > heavy damage > a bite. */
  static kindFor(damage: number, lethal: boolean): ScareKind { return lethal ? 'lethal' : damage >= 20 ? 'heavy' : 'light'; }

  start(e: Entity, kind: ScareKind): void {
    // never downgrade a running scare; a lethal hit always takes over
    if (this.active && (kind === 'light' || (kind === 'heavy' && this.kind !== 'light'))) return;
    const p = this.sim.player;
    this.kind = kind; this.e = e; this.t = 0; this.dur = DUR[kind];
    this.d0 = Math.max(1, Math.hypot(e.x - p.x, e.z - p.z));
    p.lockT = Math.max(p.lockT, LOCK[kind]);
    const { svc } = this;
    const s = svc.sounds(), a = svc.audio();
    const power = kind === 'lethal' ? 1.25 : kind === 'heavy' ? 1 : 0.55;
    if (s && a?.running) {
      s.jumpscare(a.flat('voice', 0.25), power, kind === 'lethal' ? 1.8 : 1.3);
      if (kind !== 'light') setTimeout(() => s.tinnitus(a.flat('sfx'), kind === 'lethal' ? 6 : 3.5, 0.1), 500);
    }
    svc.gfx.glitch = 1;
    svc.input.rumble(1, 1, kind === 'lethal' ? 900 : 450);
    navigator.vibrate?.(kind === 'lethal' ? [90, 40, 160, 50, 320] : kind === 'heavy' ? [70, 30, 140] : [50]);
    this.sim.stats.fear = 1;
    bus.emit('scare', { kind, ms: this.dur * 1000 });
  }

  /** Per rendered frame. Drives the player's view directly (the sim may be frozen). */
  update(dt: number): void {
    const gfx = this.svc.gfx;
    if (!this.active || !this.e) { this.ev.lunge = null; gfx.fovKick = 0; this.roll = this.jitterX = this.jitterY = 0; if (this.dur && this.t >= this.dur) { this.dur = 0; const d = this.onDone; this.onDone = null; d?.(); } return; }
    this.t += dt;
    const p = this.sim.player, e = this.e, T = this.t, k = this.kind;
    // 1. snap the view onto its head
    const dxe = e.x - p.x, dze = e.z - p.z;
    const lunging = Math.min(1, T / 0.14);
    const dist = Math.max(0.55, this.d0 + (1.05 - this.d0) * lunging - Math.max(0, T - 0.14) * (k === 'lethal' ? 0.16 : 0.1)); // rushes in, then keeps pushing closer
    const yawTo = Math.atan2(-dxe, -dze);
    const headY = e.def.height * (e.def.height < 1.2 ? 0.8 : 0.9);
    // low creatures (hounds, crawlers) leap up to face height instead of staying at your feet
    const lift = e.def.height < 1.2 ? Math.max(0, p.eye - headY - 0.12) * lunging : 0;
    const pitchTo = Math.max(-1.1, Math.min(1.1, Math.atan2(headY + lift - p.eye, dist)));
    const kk = 1 - Math.exp(-22 * dt);
    p.yaw += this.wrap(yawTo - p.yaw) * kk;
    p.pitch += (pitchTo - p.pitch) * kk;
    // 2. its body: in your face, facing you, arms up, shaking
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    this.ev.lunge = { id: e.id, x: p.x + fx * dist, z: p.z + fz * dist, yaw: p.yaw + Math.PI, y: lift, shake: 0.03 + (k === 'lethal' ? 0.03 : 0) };
    // 3. camera: FOV punch (decays), roll and jitter
    const punch = k === 'light' ? 14 : 30;
    gfx.fovKick = punch * Math.exp(-T * 6) + (k === 'lethal' ? 6 * Math.min(1, T / 1.5) : 0);
    const amp = (k === 'light' ? 0.012 : 0.03) * Math.exp(-T * (k === 'lethal' ? 0.6 : 2.4));
    this.roll = Math.sin(T * 38) * amp + (k === 'lethal' ? Math.min(0.28, T * 0.12) : 0);
    this.jitterX = Math.sin(T * 61) * amp * 0.6; this.jitterY = Math.cos(T * 53) * amp * 0.6;
    // 4. post chain: heavy glitch and fear for the opening beat, lingering fear after
    gfx.glitch = Math.max(gfx.glitch, T < 0.5 ? 1 : k === 'lethal' ? 0.6 : 0.2);
    gfx.fear = 1;
  }

  applyCamera(cam: Camera): void {
    if (!this.roll && !this.jitterX && !this.jitterY) return;
    cam.rotation.z += this.roll;
    cam.position.x += this.jitterX; cam.position.y += this.jitterY;
  }
}
