/**
 * Player stats (spec 5.1): health, sanity, hunger, thirst and a short-term fear modifier.
 * Stamina lives in the Player controller. All pressure is scaled by the difficulty table.
 * Low sanity produces hallucination events (readable as fake after the fact).
 */
import type { DifficultyDef } from '../core/difficulty';
import type { UseEffect } from './items';
import type { Rng } from '../gen/rng';
import type { PlayerStats } from '../core/save';

export interface StatsContext {
  /** Ambient light at the player 0..1 (flashlight on / lit room = high). */
  light: number;
  /** Closest awake threat proximity 0..1 (1 = touching, 0 = far or none). */
  threat: number;
  safeRoom: boolean;
  resting: boolean;
  hungerEnabled: boolean;
}

export type Hallucination = 'whisper' | 'footsteps' | 'fakeEntity' | 'uiGlitch';

export class Stats {
  health = 100; sanity = 100; hunger = 100; thirst = 100;
  fear = 0;
  /** Breath 0..100: drains while diving, refills at the surface (spec 5.1 hold-breath). */
  breath = 100;
  dead = false;
  private hallucTimer = 20;

  static from(s: PlayerStats): Stats { const t = new Stats(); t.health = s.health; t.sanity = s.sanity; t.hunger = s.hunger; t.thirst = s.thirst; return t; }
  toSave(stamina = 100): PlayerStats { return { health: this.health, stamina, sanity: this.sanity, hunger: this.hunger, thirst: this.thirst }; }

  update(dt: number, c: StatsContext, d: DifficultyDef): void {
    // fear: jumps with proximity, decays slowly
    const target = Math.min(1, c.threat * 1.2);
    this.fear += (target - this.fear) * (1 - Math.exp(-(target > this.fear ? 4 : 0.6) * dt));
    // sanity: drains in darkness and near threats, recovers in safe rooms
    let dS = 0;
    if (c.light < 0.25) dS -= 0.35 * (1 - c.light * 3);
    dS -= c.threat * 2.2;
    if (c.safeRoom) dS += c.resting ? 1.4 : 0.5;
    if (dS < 0) dS *= d.sanityDrain;
    this.sanity = clamp(this.sanity + dS * dt);
    // hunger/thirst: slow supply pressure (off in Easy / when disabled)
    if (c.hungerEnabled && d.hungerRate > 0) {
      this.hunger = clamp(this.hunger - 0.045 * d.hungerRate * dt);
      this.thirst = clamp(this.thirst - 0.06 * d.hungerRate * dt);
      if (this.hunger <= 0 || this.thirst <= 0) this.damage(0.4 * dt, d, true);
    }
    // slow natural recovery when well fed and calm
    if (this.hunger > 60 && this.thirst > 60 && c.threat === 0 && this.health < 100) this.health = clamp(this.health + 0.15 * dt);
  }

  /** Returns true while the player is out of air. */
  updateBreath(dt: number, diving: boolean, d: DifficultyDef, drain = 3.2): boolean {
    if (diving) this.breath = Math.max(0, this.breath - drain * Math.min(1.5, d.damageTaken) * dt);
    else this.breath = Math.min(100, this.breath + 28 * dt);
    if (diving && this.breath <= 0) { this.damage(9 * dt, d, true); return true; }
    return false;
  }

  damage(n: number, d: DifficultyDef, raw = false): void {
    this.health = clamp(this.health - n * (raw ? 1 : d.damageTaken));
    this.fear = Math.min(1, this.fear + 0.4);
    if (this.health <= 0) this.dead = true;
  }

  apply(e: UseEffect): void {
    if (e.health) this.health = clamp(this.health + e.health);
    if (e.sanity) this.sanity = clamp(this.sanity + e.sanity);
    if (e.hunger) this.hunger = clamp(this.hunger + e.hunger);
    if (e.thirst) this.thirst = clamp(this.thirst + e.thirst);
  }

  /** Respawn state: partial recovery so a death loop is not a spiral. */
  revive(): void { this.dead = false; this.health = Math.max(this.health, 60); this.sanity = Math.max(this.sanity, 55); this.fear = 0; }

  /** Roll for a hallucination. Rate grows as sanity falls below 55. Returns the event kind or null. */
  hallucinate(dt: number, rng: Rng, reduce: boolean): Hallucination | null {
    if (this.sanity >= 55) { this.hallucTimer = Math.max(this.hallucTimer, 15); return null; }
    this.hallucTimer -= dt;
    if (this.hallucTimer > 0) return null;
    const severity = 1 - this.sanity / 55; // 0..1
    this.hallucTimer = rng.range(6, 20) * (1.2 - severity);
    const kinds: [Hallucination, number][] = [['whisper', 3], ['footsteps', 2], ['uiGlitch', 1.5], ['fakeEntity', reduce ? 0 : 2 * severity]];
    return rng.weighted(kinds);
  }
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));
