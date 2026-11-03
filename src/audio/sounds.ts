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

  /** Hound growl: FM-modulated low saw through moving formant filters (tell before a lunge). */
  growl(out: AudioNode, dur = 1.2): void {
    const c = this.ctx, t = c.currentTime;
    const car = c.createOscillator(); car.type = 'sawtooth'; car.frequency.setValueAtTime(62, t); car.frequency.linearRampToValueAtTime(48, t + dur);
    const mod = c.createOscillator(); const mg = c.createGain(); mod.frequency.value = 23; mg.gain.value = 40; mod.connect(mg).connect(car.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.setValueAtTime(300, t); f1.frequency.linearRampToValueAtTime(520, t + dur * 0.6); f1.Q.value = 4;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 900; f2.Q.value = 5;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.2); g.gain.linearRampToValueAtTime(0.35, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    const n = this.a.noiseSource(); const ng = c.createGain(); ng.gain.value = 0.12; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 1.5;
    car.connect(f1).connect(g); car.connect(f2).connect(g); n.connect(nf).connect(ng).connect(g); g.connect(out);
    car.start(t); mod.start(t); n.start(t, 0, dur); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    this.a.caption('[something growls]', dur * 1000);
  }

  /** The Stick's tell: rising metallic ticking over a thin drone. */
  stickTell(out: AudioNode, dur = 1.6): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(190, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.15);
    for (let i = 0; i < 9; i++) {
      const tt = t + (i / 9) * dur * (0.55 + i * 0.05);
      const k = c.createOscillator(); k.type = 'square'; k.frequency.value = 1800 + (i % 3) * 300;
      const kg = c.createGain(); kg.gain.setValueAtTime(0.0001, tt); kg.gain.linearRampToValueAtTime(0.05 + i * 0.008, tt + 0.003); kg.gain.exponentialRampToValueAtTime(0.0002, tt + 0.04);
      k.connect(kg).connect(out); k.start(tt); k.stop(tt + 0.05);
    }
    this.a.caption('[ticking, getting closer]', dur * 1000);
  }

  /** Breathy whisper: band-passed noise with a drifting formant. Used for low-sanity hallucinations. */
  whisper(out: AudioNode, dur = 1.8): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6; f.frequency.setValueAtTime(1500, t); f.frequency.linearRampToValueAtTime(2400, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 5; i++) { g.gain.linearRampToValueAtTime(0.3 * Math.random() + 0.05, t + (i + 0.5) * (dur / 5)); g.gain.linearRampToValueAtTime(0.01, t + (i + 1) * (dur / 5)); }
    n.connect(f).connect(g).connect(out); n.start(t, Math.random(), dur);
    this.a.caption('[whispering]', dur * 1000);
  }

  thud(out: AudioNode, level = 0.6): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); const g = c.createGain();
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.25);
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.32);
    const n = this.a.noiseSource(); const ng = c.createGain(); ng.gain.setValueAtTime(level * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; n.connect(lp).connect(ng).connect(out); n.start(t, 0, 0.15);
  }

  /**
   * The jump-scare sting: a shrieking noise sweep, a dissonant cluster of screaming saws with fast vibrato
   * (tritone + minor second so nothing resolves), a sub boom that hits the chest and a crack of clipped noise.
   * `power` 0.5 (light) .. 1.2 (lethal). Loud on purpose: the limiter catches it.
   */
  jumpscare(out: AudioNode, power = 1, dur = 1.35): void {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9 * power, t + 0.012); g.gain.exponentialRampToValueAtTime(0.5 * power, t + 0.25); g.gain.linearRampToValueAtTime(0, t + dur);
    const sh = c.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = (i / 127.5) - 1; curve[i] = Math.tanh(x * 3.2); } sh.curve = curve;
    // screaming cluster
    for (const [f0, f1, det] of [[760, 1250, 0], [1090, 1700, 7], [532, 980, -9], [1410, 2300, 13]] as const) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.35); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur); o.detune.value = det * 6;
      const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 9 + Math.random() * 7; lg.gain.value = f0 * 0.06; lfo.connect(lg).connect(o.frequency);
      const og = c.createGain(); og.gain.value = 0.22;
      o.connect(og).connect(sh); o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    }
    // shriek: bright noise with a rising band
    const n = this.a.noiseSource(); const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 2.5; nf.frequency.setValueAtTime(1800, t); nf.frequency.exponentialRampToValueAtTime(6200, t + 0.5); nf.frequency.exponentialRampToValueAtTime(2400, t + dur);
    const ng = c.createGain(); ng.gain.setValueAtTime(0.9, t); ng.gain.exponentialRampToValueAtTime(0.25, t + 0.4); ng.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(nf).connect(ng).connect(sh); n.start(t, 0, dur + 0.05);
    sh.connect(g).connect(out);
    // chest boom + crack
    const b = c.createOscillator(); const bg = c.createGain(); b.frequency.setValueAtTime(95, t); b.frequency.exponentialRampToValueAtTime(28, t + 0.5); bg.gain.setValueAtTime(1.2 * power, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    b.connect(bg).connect(out); b.start(t); b.stop(t + 0.75);
    const k = this.a.noiseSource(); const kg = c.createGain(); kg.gain.setValueAtTime(0.9 * power, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.09); const kf = c.createBiquadFilter(); kf.type = 'highpass'; kf.frequency.value = 900; k.connect(kf).connect(kg).connect(out); k.start(t, 0, 0.12);
    this.a.caption('[SCREAM]', dur * 1000);
  }

  /** Close breathing: slow filtered-noise inhale / exhale pairs, wet and a little too near. */
  breath(out: AudioNode, dur = 4.5, level = 0.5): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(true); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 780; f.Q.value = 1.4;
    const f2 = c.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 280;
    const g = c.createGain(); g.gain.value = 0;
    let at = t + 0.1, i = 0;
    while (at < t + dur) { const inh = i % 2 === 0, len = inh ? 0.9 : 1.2; g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(level * (inh ? 0.8 : 1), at + len * 0.4); g.gain.linearRampToValueAtTime(0.0001, at + len); f.frequency.setValueAtTime(inh ? 620 : 900, at); f.frequency.linearRampToValueAtTime(inh ? 1100 : 560, at + len); at += len + 0.25; i++; }
    n.connect(f).connect(f2).connect(g).connect(out); n.start(t); n.stop(t + dur + 0.1);
    this.a.caption('[breathing close behind you]', dur * 1000);
  }

  /** Knuckles on a wall: `n` knocks. */
  knock(out: AudioNode, n = 3, gap = 0.42): void {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < n; i++) {
      const at = t + i * gap + (Math.random() - 0.5) * 0.06;
      const o = c.createOscillator(); const og = c.createGain(); o.frequency.setValueAtTime(190, at); o.frequency.exponentialRampToValueAtTime(70, at + 0.07);
      og.gain.setValueAtTime(0.9, at); og.gain.exponentialRampToValueAtTime(0.001, at + 0.11); o.connect(og).connect(out); o.start(at); o.stop(at + 0.12);
      const ns = this.a.noiseSource(); const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 1500; const ng = c.createGain(); ng.gain.setValueAtTime(0.7, at); ng.gain.exponentialRampToValueAtTime(0.001, at + 0.05); ns.connect(nf).connect(ng).connect(out); ns.start(at, 0, 0.07);
    }
    this.a.caption('[knocking]', n * gap * 1000 + 600);
  }

  /** A heavy door slamming somewhere close: boom, wood crack, rattling tail. */
  slam(out: AudioNode): void {
    const c = this.ctx, t = c.currentTime;
    const b = c.createOscillator(); const bg = c.createGain(); b.frequency.setValueAtTime(80, t); b.frequency.exponentialRampToValueAtTime(30, t + 0.4); bg.gain.setValueAtTime(1.3, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.8); b.connect(bg).connect(out); b.start(t); b.stop(t + 0.85);
    const n = this.a.noiseSource(); const ng = c.createGain(); ng.gain.setValueAtTime(1, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18); const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 2600; n.connect(nf).connect(ng).connect(out); n.start(t, 0, 0.22);
    for (let i = 0; i < 6; i++) { const at = t + 0.2 + i * 0.07 + Math.random() * 0.03; const o = c.createOscillator(); const og = c.createGain(); o.type = 'square'; o.frequency.value = 220 + Math.random() * 400; og.gain.setValueAtTime(0.12 / (i + 1), at); og.gain.exponentialRampToValueAtTime(0.001, at + 0.05); o.connect(og).connect(out); o.start(at); o.stop(at + 0.06); }
    this.a.caption('[a door slams]', 1800);
  }

  /** The ringing in your ears after something terrible. */
  tinnitus(out: AudioNode, dur = 4, level = 0.12): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.value = 4100; const o2 = c.createOscillator(); o2.frequency.value = 6350;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.15); g.gain.linearRampToValueAtTime(level * 0.7, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); o2.connect(g); g.connect(out); o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  /**
   * Continuous dread bed: two beating sub tones, an unresolved tritone drone and a thin filtered hiss, with a
   * slow tremolo. `set(0..1)` swells it with tension: quiet unease at 0, a wall of low pressure at 1.
   */
  dread(out: AudioNode): Handle & { set(v: number): void } {
    const c = this.ctx, t = c.currentTime;
    const master = c.createGain(); master.gain.value = 0;
    const trem = c.createGain(); trem.gain.value = 0.8; const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 0.2; lfo.connect(lg).connect(trem.gain);
    const oscs: OscillatorNode[] = [lfo];
    for (const [f, a, type] of [[41, 1, 'sine'], [43.3, 0.9, 'sine'], [58, 0.45, 'sine'], [82.4, 0.2, 'triangle'], [116.5, 0.14, 'sawtooth']] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; const og = c.createGain(); og.gain.value = a * 0.5; o.connect(og).connect(trem); o.start(t); oscs.push(o);
    }
    const n = this.a.noiseSource(true); const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 5200; nf.Q.value = 9; const ng = c.createGain(); ng.gain.value = 0.012; n.connect(nf).connect(ng).connect(trem); n.start(t);
    lfo.start(t); trem.connect(master).connect(out);
    return {
      stop: (fade = 1) => { master.gain.setTargetAtTime(0, c.currentTime, fade / 3); setTimeout(() => { oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }); try { n.stop(); } catch { /* already stopped */ } }, fade * 1000 + 200); },
      set: (v: number) => master.gain.setTargetAtTime(0.05 + 0.5 * Math.max(0, Math.min(1, v)), c.currentTime, 0.6),
    };
  }

  /** Short voice blip for dialogue (pitch per speaker). */
  blip(freq: number): void {
    const c = this.ctx, t = c.currentTime;
    const out = this.a.flat('voice');
    const o = c.createOscillator(); o.type = 'square'; const f = freq * (0.9 + Math.random() * 0.3);
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.85, t + 0.06);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = c.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(lp).connect(g).connect(out); o.start(t); o.stop(t + 0.08);
  }

  /** Howler scream: harsh FM sweep that carries (the tell that also alerts others). */
  scream(out: AudioNode, dur = 1.5): void {
    const c = this.ctx, t = c.currentTime;
    const car = c.createOscillator(); car.type = 'sawtooth'; car.frequency.setValueAtTime(420, t); car.frequency.linearRampToValueAtTime(900, t + dur * 0.5); car.frequency.linearRampToValueAtTime(300, t + dur);
    const mod = c.createOscillator(); const mg = c.createGain(); mod.frequency.value = 71; mg.gain.value = 260; mod.connect(mg).connect(car.frequency);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(900, t); f.frequency.linearRampToValueAtTime(1800, t + dur * 0.5); f.Q.value = 3;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.1); g.gain.linearRampToValueAtTime(0.35, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    car.connect(f).connect(g).connect(out); car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
    this.a.caption('[a scream]', dur * 1000);
  }

  /** Desk bell (the Concierge's tell): inharmonic partials with a long decay. */
  bell(out: AudioNode): void {
    const c = this.ctx, t = c.currentTime;
    for (const [f, a, d] of [[880, 0.3, 2.2], [1397, 0.18, 1.6], [2360, 0.1, 1.0], [3720, 0.05, 0.6]] as const) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d);
      o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.05);
    }
    this.a.caption('[a desk bell rings]', 1800);
  }

  /** School whistle: two short rising tones with a breathy edge. */
  whistle(out: AudioNode): void {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2300, t + i * 0.4); o.frequency.linearRampToValueAtTime(2900, t + i * 0.4 + 0.3);
      const vib = c.createOscillator(); const vg = c.createGain(); vib.frequency.value = 38; vg.gain.value = 60; vib.connect(vg).connect(o.frequency);
      const g = c.createGain(); g.gain.setValueAtTime(0, t + i * 0.4); g.gain.linearRampToValueAtTime(0.22, t + i * 0.4 + 0.03); g.gain.linearRampToValueAtTime(0, t + i * 0.4 + 0.32);
      o.connect(g).connect(out); o.start(t + i * 0.4); vib.start(t + i * 0.4); o.stop(t + i * 0.4 + 0.35); vib.stop(t + i * 0.4 + 0.35);
    }
    this.a.caption('[a whistle blows]', 1000);
  }

  /** Tripline alarm: rattling cans. */
  clatter(out: AudioNode): void {
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 14; i++) {
      const tt = t + i * 0.045 + Math.random() * 0.03;
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 900 + Math.random() * 2200;
      const g = c.createGain(); g.gain.setValueAtTime(0.12, tt); g.gain.exponentialRampToValueAtTime(0.0005, tt + 0.07);
      o.connect(g).connect(out); o.start(tt); o.stop(tt + 0.08);
    }
    this.a.caption('[cans clatter]', 1200);
  }

  /** Radio static: band-passed noise bursts. Returns nothing; call for the lure's start. */
  staticBurst(out: AudioNode, dur = 1.2): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); for (let i = 0; i < 8; i++) g.gain.linearRampToValueAtTime(Math.random() * 0.25, t + (i / 8) * dur); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random(), dur);
    this.a.caption('[radio static]', dur * 1000);
  }

  /** Valve turning: squeaky metal. */
  valve(out: AudioNode): void { this.creak(out, 0.7); }

  /** Low floor rumble (Lurker's tell): sub-bass swell with noise. */
  rumble(out: AudioNode, dur = 1.5): void {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(34, t); o.frequency.linearRampToValueAtTime(46, t + dur);
    const n = this.a.noiseSource(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); n.connect(lp).connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05); n.start(t, 0, dur);
    this.a.caption('[the floor trembles]', dur * 1000);
  }

  /** Water surge (Leviathan): swelling filtered noise + a deep bubble. */
  surge(out: AudioNode, dur = 1.8): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(200, t); f.frequency.linearRampToValueAtTime(1400, t + dur * 0.7);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.55, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(g).connect(out); n.start(t, 0, dur);
    const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + dur); const og = c.createGain(); og.gain.value = 0.3; o.connect(og).connect(out); o.start(t); o.stop(t + dur);
    this.a.caption('[the water surges]', dur * 1000);
  }

  /** Smiler's tell: a thin, too-sweet chord that slides sharp. */
  grin(out: AudioNode, dur = 1.5): void {
    const c = this.ctx, t = c.currentTime;
    for (const f of [880, 1318, 1760]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.06, t + dur);
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    this.a.caption('[a thin, sweet chord]', dur * 1000);
  }

  /** Underwater muffled splash. */
  splash(out: AudioNode, level = 0.4): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random(), 0.4);
  }

  /** Train pass: low rumble that swells, a screech and a horn. */
  train(out: AudioNode, dur = 9): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, t); lp.frequency.linearRampToValueAtTime(900, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(100, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(lp).connect(g).connect(out); n.start(t, 0, dur);
    const h = c.createOscillator(); h.type = 'sawtooth'; h.frequency.value = 311; const hg = c.createGain(); hg.gain.setValueAtTime(0, t + 1); hg.gain.linearRampToValueAtTime(0.18, t + 1.1); hg.gain.linearRampToValueAtTime(0, t + 3.2);
    h.connect(hg).connect(out); h.start(t + 1); h.stop(t + 3.3);
    this.a.caption('[a train thunders past]', dur * 800);
  }

  /** Wind gust: filtered noise swell (blizzard, wheat field). */
  wind(out: AudioNode, dur = 4): void {
    const c = this.ctx, t = c.currentTime;
    const n = this.a.noiseSource(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(900, t + dur / 2); f.frequency.linearRampToValueAtTime(350, t + dur); f.Q.value = 0.6;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + dur / 2); g.gain.linearRampToValueAtTime(0, t + dur);
    n.connect(f).connect(g).connect(out); n.start(t, Math.random(), dur);
  }

  /** Ending sting: a held chord that resolves (or does not). */
  ending(out: AudioNode, minor = false): void {
    const c = this.ctx, t = c.currentTime;
    for (const f of minor ? [220, 261.6, 311.1] : [220, 277.2, 329.6]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 1.5); g.gain.linearRampToValueAtTime(0, t + 7);
      o.connect(g).connect(out); o.start(t); o.stop(t + 7.1);
    }
  }
}
