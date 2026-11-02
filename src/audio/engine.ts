/**
 * AudioEngine (spec 9.3): Web Audio graph with buses (master, music, sfx, ambience, ui, voice),
 * HRTF spatialization, occlusion low-pass, procedural reverb send, and a limiter. 100% synthesized.
 */
import { makeImpulse, rt60For, type AcousticMaterial } from './reverb';
import type { Settings } from '../core/settings';
import { bus } from '../core/events';

export type BusName = 'sfx' | 'music' | 'ambience' | 'ui' | 'voice';

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly buses = {} as Record<BusName, GainNode>;
  readonly noise: AudioBuffer;
  private limiter: DynamicsCompressorNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private reverbKey = '';
  captions = true;

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6; this.limiter.knee.value = 6; this.limiter.ratio.value = 12; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.2;
    this.master = this.ctx.createGain();
    this.master.connect(this.limiter).connect(this.ctx.destination);
    for (const n of ['sfx', 'music', 'ambience', 'ui', 'voice'] as BusName[]) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses[n] = g;
    }
    this.reverb = this.ctx.createConvolver();
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.setRoom(6, 6, 3, 'carpet');
    // 2 s of white noise shared by every noise-based sound
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  }

  /** Browsers need a user gesture before audio can start. */
  unlock(): void { if (this.ctx.state !== 'running') void this.ctx.resume(); }
  get running(): boolean { return this.ctx.state === 'running'; }

  applySettings(s: Settings): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(s.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(s.ambience, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(s.voice, t, 0.05);
    this.captions = s.subtitles;
  }

  /** Re-synthesize the reverb IR for the current room (skips if nothing meaningful changed). */
  setRoom(w: number, d: number, h: number, material: AcousticMaterial): void {
    const rt = rt60For(w, d, h, material);
    const key = `${rt.toFixed(1)}:${material}`;
    if (key === this.reverbKey) return;
    this.reverbKey = key;
    const ir = makeImpulse(this.ctx.sampleRate, rt, material === 'carpet' ? 0.8 : material === 'snow' ? 0.9 : 0.35, 77);
    const buf = this.ctx.createBuffer(2, ir[0].length, this.ctx.sampleRate);
    buf.copyToChannel(ir[0] as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(ir[1] as Float32Array<ArrayBuffer>, 1);
    this.reverb.buffer = buf;
  }

  setListener(px: number, py: number, pz: number, fx: number, fz: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(px, t); l.positionY.setValueAtTime(py, t); l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(0, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    }
  }

  /**
   * Create a spatial endpoint. Returns the node to connect sources into. `occlusion` 0..1 muffles
   * with a low-pass (walls between source and listener). `reverb` sends part of the signal to the room reverb.
   */
  spatial(x: number, y: number, z: number, busName: BusName, occlusion = 0, reverb = 0.3): AudioNode {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5; panner.maxDistance = 60; panner.rolloffFactor = 1.3;
    panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000 * Math.pow(0.04, occlusion); // 18k open .. ~700 Hz fully occluded
    lp.connect(panner);
    panner.connect(this.buses[busName]);
    if (reverb > 0) { const g = this.ctx.createGain(); g.gain.value = reverb; panner.connect(g).connect(this.reverbSend); }
    return lp;
  }

  /** Non-spatial endpoint with optional reverb send. */
  flat(busName: BusName, reverb = 0): AudioNode {
    const g = this.ctx.createGain();
    g.connect(this.buses[busName]);
    if (reverb > 0) { const s = this.ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(this.reverbSend); }
    return g;
  }

  noiseSource(loop = false): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise; n.loop = loop;
    n.loopStart = 0; n.loopEnd = 2;
    return n;
  }

  caption(text: string, ms = 2200): void { if (this.captions) bus.emit('caption', { text, ms }); }
}
