/**
 * Fixed-timestep game loop. Simulation always advances in `STEP` seconds so AI and bots are
 * deterministic; rendering interpolates with `alpha`. Pause-safe and tab-visibility-safe:
 * long gaps are clamped so we never "catch up" after a tab was hidden.
 */

export const STEP = 1 / 60;
const MAX_FRAME = 0.1; // seconds; clamp huge gaps (tab hidden, debugger)
const MAX_STEPS = 8;

export interface LoopHooks {
  /** Advance the simulation by exactly `dt` seconds (already time-scaled). */
  update(dt: number): void;
  /** Draw. `alpha` is 0..1 progress between the previous and current sim state. */
  render(alpha: number, frameMs: number): void;
}

export class Loop {
  timeScale = 1;
  paused = false;
  /** 0 = uncapped. */
  fpsCap = 0;
  private acc = 0;
  private last = 0;
  private lastRender = 0;
  private raf = 0;
  private running = false;
  frameMs = 16.7;

  constructor(private hooks: LoopHooks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    this.last = performance.now(); // drop the hidden gap
    this.acc = 0;
  };

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);

    if (this.fpsCap > 0 && now - this.lastRender < 1000 / this.fpsCap - 1) return; // skip frame to hit cap

    const raw = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    this.frameMs = this.frameMs * 0.9 + (now - this.lastRender) * 0.1;
    this.lastRender = now;

    if (!this.paused) {
      this.acc += raw * this.timeScale;
      let steps = 0;
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.hooks.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0; // spiral-of-death guard
    }
    this.hooks.render(this.acc / STEP, raw * 1000);
  };

  /** Deterministic stepping for bots/tests: advance `seconds` of sim time with no rendering. */
  static simulate(update: (dt: number) => void, seconds: number): void {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) update(STEP);
  }
}
