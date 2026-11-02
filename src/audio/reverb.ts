/** Procedural reverb: impulse responses synthesized from room size + material (pure, testable). */
import { Rng } from '../gen/rng';

export type AcousticMaterial = 'carpet' | 'concrete' | 'tile' | 'metal' | 'water' | 'snow';
const ABSORPTION: Record<AcousticMaterial, number> = { carpet: 0.45, concrete: 0.06, tile: 0.03, metal: 0.04, water: 0.02, snow: 0.7 };

/** Sabine's formula: rt60 = 0.161 V / (S a). Clamped to a musical range. */
export function rt60For(w: number, d: number, h: number, material: AcousticMaterial): number {
  const V = w * d * h;
  const S = 2 * (w * d + w * h + d * h);
  const a = ABSORPTION[material];
  return Math.min(4.5, Math.max(0.15, (0.161 * V) / (S * (a + 0.04))));
}

/** Stereo decaying noise IR with frequency-dependent damping (highs die faster). */
export function makeImpulse(sampleRate: number, rt60: number, damping: number, seed = 1): Float32Array[] {
  const len = Math.max(64, Math.floor(sampleRate * rt60));
  const out = [new Float32Array(len), new Float32Array(len)];
  const rng = new Rng(seed);
  for (let ch = 0; ch < 2; ch++) {
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(10, (-3 * (i / sampleRate)) / rt60); // -60 dB at rt60
      const k = 0.2 + (1 - damping) * 0.75 * (1 - t * 0.85); // low-pass coefficient shrinks over time
      lp += k * ((rng.next() * 2 - 1) - lp);
      // sparse early reflections in the first 80 ms
      const early = i < sampleRate * 0.08 && rng.next() < 0.002 ? (rng.next() * 2 - 1) * 1.5 : 0;
      out[ch][i] = (lp + early) * env;
    }
  }
  return out;
}
