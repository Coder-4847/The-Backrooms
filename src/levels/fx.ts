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
  constructor(private svc: Services, private sim: LevelSim, private ev: EntityVisuals, private lights: () => LightPool, public fear: { v: number }) {}

  private spatial(x: number, z: number, bus_: 'sfx' | 'voice' = 'sfx', occl = 0.2) { const a = this.svc.audio(); return a ? a.spatial(x, 1.4, z, bus_, occl, 0.4) : null; }

  onEvent(e: SimEvent): void {
    const s = this.svc.sounds(), a = this.svc.audio(), g = this.svc.gfx, p = this.sim.player;
    switch (e.type) {
      case 'tell': {
        const out = this.spatial(e.entity.x, e.entity.z, 'voice', 0.1);
        if (s && out) {
          const id = e.entity.def.id;
          if (id === 'hound') s.growl(out); else if (id === 'howler') s.scream(out); else if (id === 'concierge') s.bell(out); else if (id === 'monitor') s.whistle(out); else s.stickTell(out);
        }
        g.glitch = Math.max(g.glitch, 0.25);
        this.svc.input.rumble(0.2, 0.5, 400);
        break;
      }
      case 'hit': {
        if (s && a) s.thud(a.flat('sfx', 0.2));
        g.glitch = 1; this.fear.v = 1;
        this.svc.input.rumble(0.9, 0.6, 350);
        bus.emit('toast', { text: e.entity.def.id === 'hound' ? 'Bitten.' : 'It touched you.', kind: 'warn' });
        break;
      }
      case 'hallucination': this.hallucinate(e.kind); break;
      case 'director': {
        if (e.event === 'flickerBurst') this.lights().burst(1.6);
        else if (e.event === 'distantSteps' && s) { const o = this.spatial(p.x + (Math.random() - 0.5) * 40, p.z + (Math.random() - 0.5) * 40, 'sfx', 0.8); if (o) for (let i = 0; i < 5; i++) setTimeout(() => s.footstep('carpet', 0.8, o), i * 520); }
        break;
      }
      case 'hide': document.body.classList.toggle('hiding', e.on); if (a) bus.emit('toast', { text: e.on ? 'Hiding. Stay quiet.' : 'You step out.' }); break;
      case 'use': s?.click('confirm'); break;
      case 'throw': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) { s.thud(o, 0.5); setTimeout(() => s.creak(o, 0.3), 80); } break; }
      case 'alarm': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) s.clatter(o); break; }
      case 'radio': { const o = this.spatial(e.x, e.z, 'sfx', 0.1); if (o && s) { for (let i = 0; i < 4; i++) setTimeout(() => s.staticBurst(o, 1.0), i * 1500); } bus.emit('toast', { text: 'Radio lure on (20 s). Things will come to it.' }); break; }
      case 'valve': { if (s && a) s.valve(a.flat('sfx', 0.3)); if (e.solved) bus.emit('toast', { text: 'Valves aligned. Somewhere, a gate unlocks.' }); break; }
      case 'puzzle': g.glitch = 0.5; break;
      case 'violation': { if (s && a) s.bell(a.flat('sfx', 0.4)); bus.emit('toast', { text: `You broke a rule: "${e.rule}"`, kind: 'warn' }); g.glitch = 0.7; break; }
      case 'companion': bus.emit('toast', { text: e.what === 'recruited' ? 'Pim follows you.' : e.what === 'hurt' ? 'Pim is hurt!' : 'Pim is gone.', kind: e.what === 'recruited' ? 'info' : 'warn' }); break;
      case 'flare': bus.emit('toast', { text: 'Flare lit. Something may be drawn to it.' }); break;
      case 'full': bus.emit('toast', { text: 'Backpack full', kind: 'warn' }); break;
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
    for (const g of this.ev.ghostList) {
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      const lx = -Math.sin(p.yaw), lz = -Math.cos(p.yaw);
      const lit = flashOn && (((g.x - p.x) * lx + (g.z - p.z) * lz) / Math.max(d, 1e-6)) > 0.93 && d < 18;
      if (d < 6.5 || lit) { this.ev.killGhost(g); this.svc.gfx.glitch = 0.6; bus.emit('caption', { text: '(there was nothing there)', ms: 2400 }); }
    }
    this.fear.v = Math.max(this.sim.stats.fear, this.fear.v * Math.pow(0.4, dt));
    const stress = Math.max(this.fear.v, (1 - this.sim.stats.sanity / 100) * 0.7);
    this.beat -= dt;
    if (stress > 0.3 && this.beat <= 0 && s && a?.running) {
      s.heartbeat(a.flat('sfx'), 0.3 + stress * 0.6);
      this.svc.input.rumble(0.1 * stress, 0.05, 120);
      this.beat = 60 / (60 + stress * 90);
    }
    void cam;
  }
}
