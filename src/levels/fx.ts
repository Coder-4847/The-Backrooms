/**
 * SceneFx: turns simulation events into sound, screen effects and hallucinations. Hallucinations
 * (spec 5.1) are always readable as fake afterward: ghosts vanish when approached or lit, with a
 * caption and a glitch pulse. Low sanity also adds whispers, false footsteps and UI glitches.
 */
import { bus } from '../core/events';
import type { Services } from '../core/services';
import type { LevelSim, SimEvent } from './sim';
import type { EntityVisuals } from './entityVisuals';
import type { LightPool } from '../render/lights';
import type { Camera } from 'three';

export class SceneFx {
  private beat = 0;
  /** Heart rate shown on the HUD and driving the heartbeat: 60 at calm to ~170 in a chase. */
  bpm = 64;
  stress = 0;
  private bpmKick = 0;
  constructor(private svc: Services, private sim: LevelSim, private ev: EntityVisuals, private lights: () => LightPool, public fear: { v: number }) {}

  private spatial(x: number, z: number, bus_: 'sfx' | 'voice' = 'sfx', occl = 0.2) { const a = this.svc.audio(); return a ? a.spatial(x, 1.4, z, bus_, occl, 0.4) : null; }

  onEvent(e: SimEvent): void {
    const s = this.svc.sounds(), a = this.svc.audio(), g = this.svc.gfx;
    switch (e.type) {
      case 'tell': {
        const out = this.spatial(e.entity.x, e.entity.z, 'voice', 0.1);
        if (s && out) {
          const id = e.entity.def.id;
          if (id === 'hound' || id === 'crawler') s.growl(out, id === 'crawler' ? 0.8 : 1.2); else if (id === 'howler') s.scream(out); else if (id === 'lurker') s.rumble(out); else if (id === 'leviathan' || id === 'drowned') s.surge(out); else if (id === 'smiler' || id === 'partygoer') s.grin(out); else if (id === 'pursuer') s.rumble(out, 1.2); else if (id === 'stalker') s.wind(out, 1.4); else if (id === 'echo' || id === 'windowman') s.staticBurst(out, 0.9); else if (id === 'wraith') s.whistle(out); else if (id === 'curator') s.bell(out); else if (id === 'static') s.staticBurst(out, 1.2); else if (id === 'leech') s.splash(out, 0.5); else if (id === 'concierge') s.bell(out); else if (id === 'monitor') s.whistle(out); else s.stickTell(out);
        }
        g.glitch = Math.max(g.glitch, 0.55);
        this.sim.stats.fear = Math.min(1, this.sim.stats.fear + 0.4); this.bpmKick = Math.max(this.bpmKick, 30);
        this.svc.input.rumble(0.3, 0.6, 500);
        break;
      }
      case 'hit': {
        if (s && a) s.thud(a.flat('sfx', 0.2));
        g.glitch = 1; this.fear.v = 1; this.bpmKick = 55;
        break;
      }
      case 'hallucination': this.hallucinate(e.kind); break;
      case 'director': {
        this.dread(e.event);
        break;
      }
      case 'hide': document.body.classList.toggle('hiding', e.on); if (a) bus.emit('toast', { text: e.on ? 'Hiding. Stay quiet.' : 'You step out.' }); break;
      case 'use': s?.click('confirm'); break;
      case 'throw': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) { s.thud(o, 0.5); setTimeout(() => s.creak(o, 0.3), 80); } break; }
      case 'alarm': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) s.clatter(o); break; }
      case 'radio': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) { for (let i = 0; i < 4; i++) setTimeout(() => s.staticBurst(o, 1.0), i * 1500); } bus.emit('toast', { text: 'Radio lure on (20 s). Things will come to it.' }); break; }
      case 'valve': { if (s && a) s.valve(a.flat('sfx', 0.3)); if (e.solved) bus.emit('toast', { text: 'Valves aligned. Somewhere, a gate unlocks.' }); break; }
      case 'puzzle': g.glitch = 0.5; break;
      case 'train': if (e.on && s && a) s.train(a.flat('sfx', 0.4)); break;
      case 'splash': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) s.splash(o, this.sim.waterHere === 'wade' ? 0.25 : 0.4); break; }
      case 'seq': bus.emit('toast', { text: e.ok ? `Server up (${e.progress})` : 'Wrong order: the rack resets.', kind: e.ok ? 'info' : 'warn' }); if (!e.ok) g.glitch = 0.6; break;
      case 'lights': if (s && a) s.creak(a.flat('sfx', 0.3), 0.5); bus.emit('toast', { text: 'Power restored to a section.' }); break;
      case 'violation': { if (s && a) s.bell(a.flat('sfx', 0.4)); bus.emit('toast', { text: `You broke a rule: "${e.rule}"`, kind: 'warn' }); g.glitch = 0.7; break; }
      case 'companion': bus.emit('toast', { text: e.what === 'recruited' ? 'Pim follows you.' : e.what === 'hurt' ? 'Pim is hurt!' : 'Pim is gone.', kind: e.what === 'recruited' ? 'info' : 'warn' }); break;
      case 'flare': bus.emit('toast', { text: 'Flare lit. Something may be drawn to it.' }); break;
      case 'full': bus.emit('toast', { text: 'Backpack full', kind: 'warn' }); break;
      default: break;
    }
  }

  /** Behind / beside the player, `d` metres away, in world coordinates. `side` 0 = straight behind, 1 = right. */
  private around(d: number, side = 0): { x: number; z: number } {
    const p = this.sim.player, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    return { x: p.x - fx * d * (1 - side) + rx * d * side, z: p.z - fz * d * (1 - side) + rz * d * side };
  }

  /** Director dread beats: not attacks, just the level being wrong near you. Each one spikes fear (and the heart rate). */
  private dread(ev: string): void {
    const s = this.svc.sounds(), a = this.svc.audio(), g = this.svc.gfx, p = this.sim.player, st = this.sim.stats;
    const fear = (n: number) => { st.fear = Math.min(1, st.fear + n); this.bpmKick = Math.max(this.bpmKick, n * 70); };
    switch (ev) {
      case 'flickerBurst': this.lights().burst(1.6); fear(0.1); break;
      case 'distantSteps': if (s) { const q = this.around(14 + Math.random() * 10, Math.random() * 2 - 1); const o = this.spatial(q.x, q.z, 'sfx', 0.8); if (o) for (let i = 0; i < 6; i++) setTimeout(() => s.footstep('carpet', 0.9, o), i * 480); } fear(0.12); break;
      case 'blackout': {
        const secs = 3.2 + Math.random() * 3;
        this.lights().blackout(secs); fear(0.35); g.glitch = Math.max(g.glitch, 0.4);
        if (s && a) {
          s.slam(a.flat('sfx', 0.5));
          const q = this.around(9, Math.random() < 0.5 ? -0.6 : 0.6); const o = this.spatial(q.x, q.z, 'sfx', 0.4);
          if (o) for (let i = 0; i < 7; i++) setTimeout(() => s.footstep('carpet', 1.1, o), 700 + i * 430); // something walks up to you in the dark
          setTimeout(() => { const b = this.around(0.9, -0.3); const bo = this.spatial(b.x, b.z, 'voice', 0.05); if (bo) s.breath(bo, 3, 0.55); }, secs * 700);
        }
        // when the lights stutter back, it is standing in front of you
        setTimeout(() => { const d = 4.2 + Math.random() * 1.5, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * d, z = p.z + fz * d; if (!this.sim.world.segmentBlocked(p.x, p.z, x, z)) this.ev.addGhost(x, z, p.yaw, 2.4, true); }, secs * 1000 + 250);
        break;
      }
      case 'slam': { const q = this.around(5 + Math.random() * 3, Math.random() * 2 - 1); const o = this.spatial(q.x, q.z, 'sfx', 0.15); if (s && o) s.slam(o); this.lights().burst(1.1); g.glitch = Math.max(g.glitch, 0.6); fear(0.4); bus.emit('scare', { kind: 'jolt', ms: 380 }); break; }
      case 'breath': { const q = this.around(0.9, (Math.random() < 0.5 ? -1 : 1) * 0.35); const o = this.spatial(q.x, q.z, 'voice', 0.02); if (s && o) s.breath(o, 5.5, 0.6); fear(0.3); break; }
      case 'knock': { const q = this.around(7 + Math.random() * 5, Math.random() * 2 - 1); const o = this.spatial(q.x, q.z, 'sfx', 0.3); if (s && o) { s.knock(o, 3); setTimeout(() => { const q2 = this.around(3.5, Math.random() < 0.5 ? -0.7 : 0.7); const o2 = this.spatial(q2.x, q2.z, 'sfx', 0.1); if (o2) s.knock(o2, 5, 0.26); }, 3200); } fear(0.18); break; }
      case 'stare': {
        const d = 10 + Math.random() * 4, fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), x = p.x + fx * d, z = p.z + fz * d;
        if (!this.sim.world.segmentBlocked(p.x, p.z, x, z)) { this.ev.addGhost(x, z, p.yaw, 7); fear(0.3); g.glitch = Math.max(g.glitch, 0.3); if (s && a) s.whisper(a.flat('voice', 0.3)); }
        break;
      }
      case 'whisperClose': { const q = this.around(0.35, -1); const o = this.spatial(q.x, q.z, 'voice', 0); if (s && o) s.whisper(o, 2.4); g.glitch = Math.max(g.glitch, 0.35); fear(0.25); break; }
      case 'silence': {
        // the hum stops. Everything that was constant is gone, which is worse than any noise
        if (a?.running) { const gn = a.buses.ambience.gain, v = gn.value, t = a.ctx.currentTime; gn.cancelScheduledValues(t); gn.setTargetAtTime(0.0, t, 0.15); setTimeout(() => gn.setTargetAtTime(v, a.ctx.currentTime, 0.8), 4800); }
        fear(0.1); break;
      }
      default: break;
    }
  }

  private hallucinate(kind: 'whisper' | 'footsteps' | 'fakeEntity' | 'uiGlitch'): void {
    const s = this.svc.sounds(), a = this.svc.audio(), p = this.sim.player;
    if (kind === 'whisper' && s && a) s.whisper(a.flat('voice', 0.3));
    else if (kind === 'footsteps' && s) {
      const o = this.spatial(p.x + Math.sin(p.yaw) * 3, p.z + Math.cos(p.yaw) * 3, 'sfx', 0.1);
      if (o) for (let i = 0; i < 4; i++) setTimeout(() => s.footstep('carpet', 1, o), i * 480);
    } else if (kind === 'uiGlitch') { this.svc.gfx.glitch = 0.8; bus.emit('toast', { text: '█▒░ REC ░▒█', kind: 'warn' }); }
    else if (kind === 'fakeEntity') {
      const d = 11 + Math.random() * 4;
      const x = p.x - Math.sin(p.yaw) * d, z = p.z - Math.cos(p.yaw) * d;
      if (!this.sim.world.segmentBlocked(p.x, p.z, x, z)) this.ev.addGhost(x, z, p.yaw);
    }
  }

  /** Per rendered frame: ghosts vanish when approached or lit; heartbeat follows fear and sanity. */
  update(dt: number, cam: Camera, flashOn: boolean): void {
    const p = this.sim.player, s = this.svc.sounds(), a = this.svc.audio();
    for (const e of this.sim.ew.entities) {
      const gl = e.data.glitch as number | undefined, rb = e.data.rumble as number | undefined;
      if (gl && gl > 0) this.svc.gfx.glitch = Math.max(this.svc.gfx.glitch, gl * 0.6);
      if (rb && rb > 0.3 && Math.random() < dt * 4) this.svc.input.rumble(rb * 0.5, rb * 0.2, 120);
    }
    for (const g of this.ev.ghostList) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
      const lit = flashOn && (((g.x - p.x) * lx + (g.z - p.z) * lz) / Math.max(d, 1e-6)) > 0.93 && d < 18;
      if ((!g.sticky && d < 6.5) || lit) { this.ev.killGhost(g); this.svc.gfx.glitch = 0.6; bus.emit('caption', { text: '(there was nothing there)', ms: 2400 }); }
    }
    this.fear.v = Math.max(this.sim.stats.fear, this.fear.v * Math.pow(0.4, dt));
    // stress: fear (something near), sanity (the dark gets to you), director tension (the level is building to something)
    const stress = Math.max(this.fear.v, (1 - this.sim.stats.sanity / 100) * 0.75, this.sim.director.tension * 0.45, this.sim.player.sprinting ? 0.25 : 0);
    this.stress = stress;
    this.bpmKick = Math.max(0, this.bpmKick - dt * 22);
    const target = Math.min(196, 62 + stress * 100 + this.bpmKick + (this.sim.player.sprinting ? 12 : 0) + (1 - this.sim.stats.health / 100) * 14);
    this.bpm += (target - this.bpm) * (1 - Math.exp(-dt * (target > this.bpm ? 3 : 0.35)));
    this.beat -= dt;
    if (stress > 0.12 && this.beat <= 0 && s && a?.running) {
      s.heartbeat(a.flat('sfx'), 0.45 + stress * 1.15);
      this.svc.input.rumble(0.12 * stress, 0.06, 120);
      this.beat = 60 / this.bpm;
    }
    void cam;
  }
}
