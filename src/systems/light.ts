/** Flashlight and camcorder state machines (spec 5.3). Battery drain is scaled by difficulty. */
import type { DifficultyDef } from '../core/difficulty';

export class Flashlight {
  on = true;
  battery = 100;
  bright = false;
  /** Accumulated shake energy from mouse/touch/pad motion. */
  private shake = 0;

  /** 0..1 light output including low-battery flicker. */
  output(t: number): number {
    if (!this.on || this.battery <= 0) return 0;
    let o = this.bright ? 1.4 : 1;
    if (this.battery < 15) o *= 0.55 + 0.45 * (Math.sin(t * 31) * Math.sin(t * 13) > -0.3 ? 1 : 0.15) * (this.battery / 15 + 0.3);
    else if (this.battery < 30) o *= 0.85;
    return o;
  }

  update(dt: number, d: DifficultyDef): void {
    if (this.on && this.battery > 0) this.battery = Math.max(0, this.battery - (this.bright ? 0.35 : 0.18) * d.batteryDrain * dt);
    this.shake = Math.max(0, this.shake - dt * 4);
  }

  /** Feed look-delta magnitude each tick; vigorous shaking recharges a little when the cell is low. */
  addShake(amount: number): void {
    if (this.battery > 25) return;
    this.shake += amount;
    if (this.shake > 14) { this.shake = 0; this.battery = Math.min(25, this.battery + 3); }
  }

  recharge(amount: number): void { this.battery = Math.min(100, this.battery + amount); }
}

export class Camcorder {
  nightVision = false;
  battery = 100;
  update(dt: number, d: DifficultyDef): void {
    if (this.nightVision) { this.battery = Math.max(0, this.battery - 0.45 * d.batteryDrain * dt); if (this.battery <= 0) this.nightVision = false; }
    else this.battery = Math.min(100, this.battery + 0.02 * dt); // the tape-deck battery trickle-charges while off
  }
  toggle(): void { if (this.battery > 3) this.nightVision = !this.nightVision; }
}
