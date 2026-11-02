/**
 * LightPool: a fixed number of real THREE point lights re-assigned each frame to the nearest
 * ceiling lights (fixed count => no shader recompiles). Swaps cross-fade to avoid popping.
 * Flicker is computed from the light's seeded flag; "reduce flicker" damps it (photosensitivity).
 */
import { Color, PointLight, type Scene } from 'three';
import type { LightDef } from '../gen/mesher';

interface Slot { light: PointLight; def: LightDef | null; next: LightDef | null; fade: number; shadow: boolean }

export function flickerAt(def: LightDef, t: number, reduce: boolean): number {
  if (def.broken) return 0;
  if (!def.flicker) return 1;
  // layered square-ish noise: mostly on with brief dropouts
  const k = Math.sin(t * 17.3 + def.x * 3.1) * Math.sin(t * 5.7 + def.z * 2.3) + Math.sin(t * 41.0 + def.x);
  const drop = k > 1.15 ? 0.15 : k > 0.9 ? 0.55 : 1;
  return reduce ? 0.8 + 0.2 * drop : drop;
}

export class LightPool {
  private slots: Slot[] = [];
  private color = new Color();
  all: LightDef[] = [];
  reduceFlicker = false;
  /** Horizontal radius around the viewer inside which every lamp is a real-time light (baked light fades in beyond). */
  coverRadius = 0;
  /** Seconds of Director-triggered flicker burst remaining. */
  burstT = 0;
  burst(seconds: number): void { if (!this.reduceFlicker) this.burstT = seconds; }

  constructor(private scene: Scene, count: number, shadowCount: number, shadowMap: number, distance = 16) {
    for (let i = 0; i < count; i++) {
      const light = new PointLight(0xffffff, 0, distance, 2);
      const shadow = i < shadowCount;
      if (shadow) {
        light.castShadow = true;
        light.shadow.mapSize.set(shadowMap, shadowMap);
        light.shadow.camera.near = 0.2; light.shadow.camera.far = distance;
        light.shadow.bias = -0.002; light.shadow.radius = 3;
      }
      scene.add(light);
      this.slots.push({ light, def: null, next: null, fade: 0, shadow });
    }
  }

  setSources(defs: LightDef[]): void { this.all = defs; }

  /** Per-frame update from the viewer position. */
  update(x: number, y: number, z: number, t: number, dt: number, baseIntensity = 9): void {
    const n = this.slots.length;
    if (!n) return;
    this.burstT = Math.max(0, this.burstT - dt);
    const burst = this.burstT > 0 ? (Math.sin(t * 53) * Math.sin(t * 19) > -0.2 ? 1 : 0.1) : 1;
    // pick the n nearest non-broken defs (selection by repeated min; n is small)
    const picked: LightDef[] = [];
    const used = new Set<LightDef>();
    for (let k = 0; k < n; k++) {
      let best: LightDef | null = null, bd = Infinity;
      for (const d of this.all) {
        if (d.broken || used.has(d)) continue;
        const dx = d.x - x, dz = d.z - z, dy = d.y - y;
        const dist = dx * dx + dz * dz + dy * dy * 0.25;
        if (dist < bd) { bd = dist; best = d; }
      }
      if (!best) break;
      used.add(best); picked.push(best);
    }
    if (picked.length < n) this.coverRadius = 1e4;
    else { const f = picked[picked.length - 1]; this.coverRadius = Math.hypot(f.x - x, f.z - z); }
    // keep slots that already show a picked def; assign the rest to fading slots
    const have = new Set<LightDef>();
    for (const s of this.slots) if (s.def && used.has(s.def)) have.add(s.def);
    const missing = picked.filter((d) => !have.has(d));
    for (const s of this.slots) {
      const keep = s.def && used.has(s.def);
      if (!keep && !s.next && missing.length) { s.next = missing.shift()!; }
      // fade in/out
      const target = keep ? 1 : 0;
      s.fade += Math.sign(target - s.fade) * Math.min(Math.abs(target - s.fade), dt * 5);
      if (!keep && s.fade <= 0.001 && s.next) { s.def = s.next; s.next = null; s.fade = 0; }
      else if (!keep && s.fade <= 0.001 && !s.next) s.def = null;
      if (s.def && !keep && s.fade > 0.001) { /* fading out the old def */ }
      if (s.def && keep) { /* stays */ }
      // when slot just received a new def it fades in next frames (keep=true since new def is in `used`)
      const d = s.def;
      if (d) {
        s.light.position.set(d.x, d.y - 0.15, d.z);
        this.color.setHex(d.color);
        s.light.color.copy(this.color);
        s.light.intensity = baseIntensity * d.intensity * flickerAt(d, t, this.reduceFlicker) * s.fade * burst;
        s.light.visible = s.fade > 0.001;
      } else { s.light.intensity = 0; s.light.visible = false; }
    }
  }

  dispose(): void { for (const s of this.slots) { this.scene.remove(s.light); s.light.dispose(); } this.slots.length = 0; }
}
