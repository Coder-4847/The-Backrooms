/**
 * Director v1 (spec 5.10): paces threat so encounters have rhythm: build -> peak -> release -> quiet.
 * It never starts a hunt during release/quiet (guaranteed breathers), scales with the level's
 * intensity dial x Scare Intensity, and the difficulty table sets breather length and ambush weight.
 */
import type { DifficultyDef } from '../core/difficulty';
import type { Rng } from '../gen/rng';

export type Phase = 'build' | 'peak' | 'release' | 'quiet';
export type DirectorEvent = 'flickerBurst' | 'distantSteps' | 'ambush' | 'silence';

export class Director {
  phase: Phase = 'quiet';
  tension = 0;
  private timer: number;
  private eventTimer = 25;
  private lastHuntEnd = -999;
  private clock = 0;
  huntsStarted = 0;

  constructor(private d: DifficultyDef, private intensity: number, private rng: Rng) { this.timer = 40 * d.breather; }

  /** May an entity start (or continue noticing the player into) a hunt right now? */
  get allowHunt(): boolean { return this.phase === 'build' || this.phase === 'peak'; }

  /** Entities call this when a hunt begins/ends so the Director tracks exposure. */
  huntStarted(): void { this.huntsStarted++; this.phase = 'peak'; this.timer = 25; }
  huntEnded(): void { this.lastHuntEnd = this.clock; this.phase = 'release'; this.timer = 12; }

  /** @param threat 0..1 current exposure (an active chase = 1). Returns an ambient event to fire, if any. */
  update(dt: number, threat: number): DirectorEvent | null {
    this.clock += dt;
    const gain = 0.02 * this.intensity;
    this.tension = Math.max(0, Math.min(1, this.tension + (threat > 0.2 ? threat * 0.08 : gain) * dt - (this.phase === 'quiet' || this.phase === 'release' ? 0.05 * dt : 0)));
    this.timer -= dt;
    switch (this.phase) {
      case 'quiet': if (this.timer <= 0) { this.phase = 'build'; this.timer = this.rng.range(60, 140); } break;
      case 'build': if (this.timer <= 0 && threat < 0.2) { this.phase = 'quiet'; this.timer = 20 * this.d.breather; } break; // nothing happened: reset the rhythm
      case 'peak': if (this.timer <= 0 && threat < 0.2) this.huntEnded(); break;
      case 'release': if (this.timer <= 0) { this.phase = 'quiet'; this.timer = this.rng.range(35, 60) * this.d.breather; } break;
    }
    // ambient events only in build phase (never right after a hunt)
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = this.rng.range(25, 55) / Math.max(0.3, this.intensity);
      if (this.phase === 'build') {
        const kinds: [DirectorEvent, number][] = [['flickerBurst', 3], ['distantSteps', 3], ['ambush', 0.5 * this.d.ambush * this.intensity]];
        return this.rng.weighted(kinds);
      }
      if (this.phase === 'quiet') return 'silence';
    }
    return null;
  }

  /** Seconds since the last chase ended (used to avoid back-to-back spawns). */
  get sinceLastHunt(): number { return this.clock - this.lastHuntEnd; }
}
