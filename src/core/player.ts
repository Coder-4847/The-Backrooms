/**
 * Basic first-person controller for Phase 0 (walk/sprint/crouch, stamina, head bob, noclip fly).
 * Phase 1 polishes this (vault, lean, fear camera). Position uses previous/current copies so the
 * renderer can interpolate between fixed steps.
 */
import { Euler, Vector3, type PerspectiveCamera } from 'three';
import type { StaticWorld } from './collision';
import type { InputFrame } from './input/logic';

export const PLAYER = { radius: 0.3, eye: 1.65, eyeCrouch: 1.05, walk: 2.3, sprint: 4.0, crouch: 1.15 };

export class Player {
  x = 0; z = 0; px = 0; pz = 0;
  yaw = 0; pitch = 0;
  eye = PLAYER.eye;
  speed = 0;
  stamina = 100;
  crouching = false;
  sprinting = false;
  noclip = false;
  god = false;
  /** Current noise level 0..1 for the AI to hear (Phase 1). */
  noise = 0;
  private vx = 0; private vz = 0;
  private bob = 0;
  private stride = 0;
  private exhausted = false;
  private flyY = 1.6;
  private crouchToggle = false;
  private sprintToggle = false;
  reduceShake = false;
  /** Stamina regeneration multiplier (backpack weight lowers it). */
  regenScale = 1;
  /** Water: speed multiplier and swim state (surface = head above water, dive = head under). */
  waterMul = 1;
  swim: 'none' | 'surface' | 'dive' = 'none';
  /** -1 (lean left) .. 1 (lean right), smoothed. */
  lean = 0;
  holdCrouchToggle = false; holdSprintToggle = false;
  onStep: ((sprint: boolean, crouch: boolean) => void) | null = null;
  private fwd = new Vector3(); private right = new Vector3();
  private euler = new Euler(0, 0, 0, 'YXZ');

  place(x: number, z: number, yaw = 0): void { this.x = this.px = x; this.z = this.pz = z; this.yaw = yaw; this.pitch = 0; this.vx = this.vz = 0; }

  update(dt: number, f: InputFrame, world: StaticWorld): void {
    this.px = this.x; this.pz = this.z;
    this.yaw -= f.lookX;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - f.lookY));

    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward = (-sin, -cos) in XZ for yaw about +Y with camera looking down -Z
    let wishX = -sinY * f.moveY + cosY * f.moveX;
    let wishZ = -cosY * f.moveY - sinY * f.moveX;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 1) { wishX /= wl; wishZ /= wl; }

    if (this.noclip) {
      const fast = f.down.Sprint ? 20 : 7;
      this.fwd.set(-sinY * Math.cos(this.pitch), Math.sin(this.pitch), -cosY * Math.cos(this.pitch));
      this.x += (this.fwd.x * f.moveY + cosY * f.moveX) * fast * dt;
      this.z += (this.fwd.z * f.moveY - sinY * f.moveX) * fast * dt;
      this.flyY += (this.fwd.y * f.moveY + (f.down.Jump ? 1 : 0) - (f.down.Crouch ? 1 : 0)) * fast * dt;
      this.speed = fast; this.noise = 0;
      return;
    }

    // crouch / sprint with hold-or-toggle
    if (this.holdCrouchToggle) { if (f.pressed.Crouch) this.crouchToggle = !this.crouchToggle; this.crouching = this.crouchToggle; }
    else this.crouching = f.down.Crouch;
    if (this.holdSprintToggle) { if (f.pressed.Sprint) this.sprintToggle = !this.sprintToggle; }
    else this.sprintToggle = f.down.Sprint;
    const moving = wl > 0.1;
    this.exhausted = this.exhausted ? this.stamina < 25 : this.stamina <= 0;
    if (this.swim !== 'none') { this.crouching = this.swim === 'dive'; this.sprintToggle = false; }
    this.sprinting = this.sprintToggle && moving && !this.crouching && !this.exhausted && f.moveY > 0.3;
    this.stamina = Math.max(0, Math.min(100, this.stamina + (this.sprinting ? -14 : (moving ? 6 : 12) * this.regenScale) * dt));

    const target = (this.crouching ? PLAYER.crouch : this.sprinting ? PLAYER.sprint : PLAYER.walk) * this.waterMul;
    const accel = 1 - Math.exp(-10 * dt);
    this.vx += (wishX * target - this.vx) * accel;
    this.vz += (wishZ * target - this.vz) * accel;
    world.move(this, this.vx * dt, this.vz * dt, PLAYER.radius);
    this.speed = Math.hypot(this.vx, this.vz);

    const leanT = (f.down.PeekRight ? 1 : 0) - (f.down.PeekLeft ? 1 : 0);
    this.lean += (leanT - this.lean) * (1 - Math.exp(-10 * dt));
    const eyeT = this.swim === 'dive' ? 0.5 : this.swim === 'surface' ? 1.05 : this.crouching ? PLAYER.eyeCrouch : PLAYER.eye;
    this.eye += (eyeT - this.eye) * (1 - Math.exp(-12 * dt));
    this.bob += this.speed * dt * (this.sprinting ? 1.5 : 1.15);
    this.stride += this.speed * dt;
    const strideLen = this.sprinting ? 2.1 : this.crouching ? 1.2 : 1.6;
    if (this.stride >= strideLen) { this.stride = 0; this.onStep?.(this.sprinting, this.crouching); }
    this.noise = this.speed < 0.2 ? 0 : this.sprinting ? 1 : this.crouching ? 0.1 : 0.35;
  }

  /** Apply (interpolated) pose to the camera. */
  apply(cam: PerspectiveCamera, alpha: number, fear = 0, t = 0): void {
    const x = this.px + (this.x - this.px) * alpha, z = this.pz + (this.z - this.pz) * alpha;
    const bobAmp = this.reduceShake ? 0 : Math.min(1, this.speed / 3) * (this.sprinting ? 0.055 : 0.032);
    const shake = this.reduceShake ? 0 : fear * 0.012;
    const y = this.noclip ? this.flyY : this.eye + Math.abs(Math.sin(this.bob * 2.4)) * bobAmp - bobAmp * 0.5;
    const lx = Math.cos(this.yaw) * this.lean * 0.32, lz = -Math.sin(this.yaw) * this.lean * 0.32;
    cam.position.set(x + lx + Math.sin(t * 31) * shake, y + Math.cos(t * 27) * shake - Math.abs(this.lean) * 0.08, z + lz);
    this.euler.set(this.pitch + (this.reduceShake ? 0 : Math.sin(this.bob * 2.4) * bobAmp * 0.18), this.yaw + (this.reduceShake ? 0 : Math.cos(this.bob * 1.2) * bobAmp * 0.25), 0);
    this.euler.z = -this.lean * 0.14;
    cam.quaternion.setFromEuler(this.euler);
    void this.right;
  }
}
