/**
 * Synthesized sound recipes. Each takes the engine and an output node (flat or spatial) so the
 * same sound can be played anywhere. No audio files: oscillators, filtered noise, FM and envelopes.
 */
import type { AudioEngine } from './engine';

export type Surface = 'carpet' | 'concrete' | 'tile' | 'water' | 'snow' | 'metal' | 'grass';

const SURFACE: Record<Surface, { f: number; q: number; len: number; gain: number; type: BiquadFilterType }> = {
  carpet: { f: 380, q: 0.7, len: 0.11, gain: 0.5, type: 'lowpass' },
  concrete: { f: 1500, q: 1.2, len: 0.07, gain: 0.7, type: 'bandpass' },
  tile: { f: 2400, q: 1.8, len: 0.06, gain: 0.8, type: 'bandpass' },
  water: { f: 900, q: 0.6, len: 0.22, gain: 0.7, type: 'bandpass' },
  snow: { f: 520, q: 0.5, len: 0.16, gain: 0.55, type: 'lowpass' },
  metal: { f: 3200, q: 3, len: 0.12, gain: 0.7, type: 'bandpass' },
  grass: { f: 1100, q: 0.5, len: 0.12, gain: 0.45, type: 'bandpass' },
};

export interface Handle { stop(fade?: number): void }

export class Sounds {
  constructor(private a: AudioEngine) {}
  private get ctx() { return this.a.ctx; }

  /** One footstep. `energy` 0.3 crouch .. 1 walk .. 1.6 sprint. */
  footstep(surface: Surface, energy: number, out: AudioNode): void {
    const c = this.ctx, t = c.currentTime;
    const p = SURFACE[surface];
    const src = this.a.noiseSource();
    const f = c.createBiquadFilter();
    f.type = p.type; f.frequency.value = p.f * (0.85 + Math.random() * 0.3); f.Q.value = p.q;
    const g = c.createGain();
    const peak = p.gain * energy * 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + p.len);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5, p.len + 0.05);
    // low thump for body
    const o = c.createOscillator(); const og = c.createGain();
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    og.gain.setValueAtTime(peak * 0.7, t); og.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.1);
    if (surface === 'water') this.drip(out, 0.25);
    this.a.caption('[footsteps]', 700);
  }

  /** Fluorescent hum: 60/120/240 Hz with a beating detuned pair and a filtered buzz. Returns a handle. */
  hum(out: AudioNode, level = 0.12, base = 120): Handle {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 1.5);
    const oscs: OscillatorNode[] = [];
    for (const [f, a] of [[base, 1], [base + 1.3, 0.7], [base * 2, 0.35], [base * 4 + 0.7, 0.12]] as const) {
      const o = c.createOscillator(); const og = c.createGain();
      o.type = f > base * 3 ? 'sawtooth' : 'sine'; o.frequency.value = f; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); oscs.push(o);
    }
    const n = this.a.noiseSource(true); const nf = c.createBiquadFilter(); const ng = c.createGain();
    nf.type = 'bandpass'; nf.frequency.value = 3200; nf.Q.value = 8; ng.gain.value = 0.05;
    n.connect(nf).connect(ng).connect(g); n.start(t);
    g.connect(out);
    return { stop: (fade = 0.6) => { const now = c.currentTime; g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, fade / 3); oscs.forEach((o) => o.stop(now + fade + 0.2)); n.stop(now + fade + 0.2); } };
  }

  /** Waypoint beacon: soft tonal hum that is audible from a distance. */
  beacon(out: AudioNode): Handle {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.16, t + 2);
    const oscs = [220, 330.5, 440.7].map((f, i) => { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = c.createGain(); og.gain.value = [0.6, 0.3, 0.2][i]; o.connect(og).connect(g); o.start(t); return o; });
    const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 0.35; lg.gain.value = 0.04; lfo.connect(lg).connect(g.gain); lfo.start(t);
    g.connect(out);
    return { stop: (fade = 1) => { const now = c.currentTime; g.gain.setTargetAtTime(0, now, fade / 3); [...oscs, lfo].forEach((o) => o.stop(now + fade + 0.3)); } };
  }

  drip(out: AudioNode, level = 0.4): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); const g = c.createGain();
    const f0 = 1200 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + 0.12);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level * 0.3, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0003, t + 0.2);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.22);
    this.a.caption('[dripping]', 1200);
  }

  /** Door/pipe creak: gliding sawtooth through formant-like bandpass filters. */
  creak(out: AudioNode, dur = 1.2): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const f0 = 90 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), t + dur * 0.6); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + dur);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 700; f1.Q.value = 9;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1500; f2.Q.value = 7;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.15); g.gain.linearRampToValueAtTime(0.1, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(f1).connect(g); o.connect(f2).connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    this.a.caption('[door creaks]', dur * 1000);
  }

  click(kind: 'tick' | 'confirm' | 'back' = 'tick'): void {
    const c = this.ctx, t = c.currentTime;
    const out = this.a.flat('ui');
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'triangle';
    const f = kind === 'confirm' ? 660 : kind === 'back' ? 330 : 520;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.05);
    g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.08);
  }

  /** Heartbeat double-thump; call each beat from the stats system. */
  heartbeat(out: AudioNode, strength = 0.6): void {
    const c = this.ctx, t = c.currentTime;
    for (const [dt, a] of [[0, 1], [0.17, 0.7]] as const) {
      const o = c.createOscillator(); const g = c.createGain();
      o.frequency.setValueAtTime(70, t + dt); o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.13);
      g.gain.setValueAtTime(0, t + dt); g.gain.linearRampToValueAtTime(0.5 * strength * a, t + dt + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.2);
      o.connect(g).connect(out); o.start(t + dt); o.stop(t + dt + 0.22);
    }
  }

  /** VHS tape-stop / noclip warp sweep. */
  warp(out: AudioNode, dur = 1.4): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(30, t + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
  }
}
