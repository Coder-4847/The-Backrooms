/**
 * SimExtras: Phase 2 gameplay layered on LevelSim: puzzle valves, thrown distractions, tripline
 * alarms, the radio lure, posted-rule enforcement (Concierge), companions and talking to
 * coworkers. Kept apart so LevelSim stays readable.
 */
import type { LevelSim, Interactable } from './sim';
import { itemDef } from '../systems/items';
import type { Entity } from '../entities/ai';
import type { InputFrame } from '../core/input/logic';
import type { Vec2 } from '../gen/types';

const THROWABLE: [string, number][] = [['distraction', 1.3], ['bottle', 0.95], ['can', 0.75]];

export class SimExtras {
  valves = new Map<string, number>();
  seq = new Map<string, number>();
  triplines: { x: number; z: number }[] = [];
  radio: { x: number; z: number; t: number; tick: number } | null = null;
  radioCooldown = 0;
  ruleCooldown = 0;
  companion: Entity | null = null;
  companionLost = false;
  violations = 0;
  passHeld: 'none' | 'real' | 'forged' = 'none';

  constructor(private sim: LevelSim) {
    for (const pz of sim.plan.puzzles ?? []) for (const p of pz.parts) this.valves.set(p.id, 0);
  }

  update(dt: number, f: InputFrame): void {
    const s = this.sim, p = s.player;
    this.ruleCooldown = Math.max(0, this.ruleCooldown - dt);
    this.radioCooldown = Math.max(0, this.radioCooldown - dt);
    this.passHeld = s.inv.has('hall_pass') ? 'real' : s.inv.has('forged_pass') ? 'forged' : 'none';
    if (f.pressed.Throw) this.throwItem();
    // tripline: clatters (loud noise) when anything non-friendly crosses it
    for (const t of [...this.triplines]) {
      const hit = s.ew.entities.find((e) => e.def.id !== 'companion' && e.def.id !== 'coworker' && Math.hypot(e.x - t.x, e.z - t.z) < 1.1);
      if (hit) { s.noise.emit(s.ew.nav.roomAt(t.x, t.z), t.x, t.z, 1.3); this.triplines.splice(this.triplines.indexOf(t), 1); s.emit({ type: 'alarm', x: t.x, z: t.z }); }
    }
    // radio lure
    if (this.radio) {
      this.radio.t -= dt; this.radio.tick -= dt;
      if (this.radio.tick <= 0) { this.radio.tick = 1.5; s.noise.emit(s.ew.nav.roomAt(this.radio.x, this.radio.z), this.radio.x, this.radio.z, 0.85); }
      if (this.radio.t <= 0) this.radio = null;
    }
    // posted rules (Terror Hotel): breaking a REAL rule summons the Concierge; false rules do nothing
    for (const r of s.plan.rules ?? []) {
      if (!r.real || this.ruleCooldown > 0 || s.hidden) continue;
      const inHall = s.plan.rooms[s.room]?.kind === 'hall';
      const broken = (r.kind === 'noRunning' && p.sprinting && inHall) || (r.kind === 'noLight' && s.flash.on && s.inv.has('flashlight') && inHall) || (r.kind === 'noNoise' && p.noise > 0.9 && inHall);
      if (broken) this.violate(r.text);
    }
    // hostile entities can hurt the companion
    const c = this.companion;
    if (c && (c.data.hp as number) > 0) {
      for (const e of s.ew.entities) {
        if (e === c || e.def.id === 'coworker' || e.cooldown > 0 || !s.ew.isHunting(e.state)) continue;
        if (Math.hypot(e.x - c.x, e.z - c.z) < 1.1 && Math.hypot(e.x - p.x, e.z - p.z) > 1.4) {
          c.data.hp = (c.data.hp as number) - 40; e.cooldown = e.def.cooldown || 1.5;
          s.emit({ type: 'companion', what: 'hurt' });
          if ((c.data.hp as number) <= 0) { s.ew.remove(c); this.companion = null; this.companionLost = true; s.emit({ type: 'companion', what: 'lost' }); }
        }
      }
    }
  }

  violate(text: string): void {
    const s = this.sim, p = s.player;
    this.ruleCooldown = 30; this.violations++;
    // spawn the Concierge out of sight, 14-26 m away (nearest room centre in that band)
    const rooms = s.plan.rooms.map((r) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 })).filter((q) => { const d = Math.hypot(q.x - p.x, q.z - p.z); return d > 14 && d < 28 && !s.world.segmentBlocked(p.x, p.z, q.x, q.z); });
    const far = s.plan.rooms.map((r) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 })).filter((q) => Math.hypot(q.x - p.x, q.z - p.z) > 12);
    const at: Vec2 = rooms[0] ?? far[0] ?? { x: p.x + 10, z: p.z };
    const e = s.ew.spawn('concierge', at.x, at.z, 90 + this.violations);
    e.data.life = 70;
    s.emit({ type: 'violation', rule: text });
  }

  // ---- interactables ----
  interactables(): Interactable[] {
    const s = this.sim, out: Interactable[] = [];
    for (const pz of s.plan.puzzles ?? []) {
      if (s.keys.has(pz.lock)) continue;
      pz.parts.forEach((pt, i) => {
        const label = pz.kind === 'valves' ? `Turn valve ${'ABC'[i]} (${this.valves.get(pt.id)})` : pz.kind === 'sequence' ? `Reboot server ${'ABCD'[i]}` : 'Flip the breaker';
        out.push({ kind: 'custom', x: pt.pos.x, z: pt.pos.z, label, ref: { type: pz.kind === 'valves' ? 'valve' : pz.kind === 'sequence' ? 'seq' : 'breaker', puzzle: pz.id, part: pt.id } });
      });
    }
    for (const e of s.ew.entities) {
      if (e.def.behavior === 'coworker' || (e.def.behavior === 'skinstealer' && e.data.disguised !== false && e.state !== 'chase' && e.state !== 'tell')) out.push({ kind: 'custom', x: e.x, z: e.z, label: 'Talk to coworker', ref: { type: 'talk', id: e.id } });
      if (e.def.behavior === 'companion' && !e.data.following) out.push({ kind: 'custom', x: e.x, z: e.z, label: 'Ask Pim to come along', ref: { type: 'recruit', id: e.id } });
    }
    return out;
  }

  /** Handle our custom interactions. Returns true if handled. */
  handle(ref: { type: string; puzzle?: string; part?: string; id?: number }): boolean {
    const s = this.sim;
    if (ref.type === 'valve') {
      const pz = s.plan.puzzles!.find((q) => q.id === ref.puzzle)!;
      const part = pz.parts.find((q) => q.id === ref.part)!;
      this.valves.set(part.id, ((this.valves.get(part.id) ?? 0) + 1) % part.states);
      const solved = pz.parts.every((q, i) => this.valves.get(q.id) === pz.solution[i]);
      s.noise.emit(s.room, s.player.x, s.player.z, 0.5);
      s.emit({ type: 'valve', puzzle: pz.id, solved });
      if (solved) { s.keys.add(pz.lock); s.emit({ type: 'puzzle', id: pz.id }); }
      return true;
    }
    if (ref.type === 'seq' || ref.type === 'breaker') {
      const pz = s.plan.puzzles!.find((q) => q.id === ref.puzzle)!;
      s.noise.emit(s.room, s.player.x, s.player.z, 0.45);
      if (ref.type === 'breaker') {
        s.keys.add(pz.lock);
        const rooms = s.plan.sections?.find((q) => q.lock === pz.lock)?.rooms ?? [];
        for (const r of rooms) s.unlit.delete(r);
        s.emit({ type: 'lights', lock: pz.lock, rooms }); s.emit({ type: 'puzzle', id: pz.id });
        return true;
      }
      const idx = pz.parts.findIndex((q) => q.id === ref.part);
      const prog = this.seq.get(pz.id) ?? 0;
      if (pz.solution[prog] === idx) {
        this.seq.set(pz.id, prog + 1);
        s.emit({ type: 'seq', puzzle: pz.id, ok: true, progress: prog + 1 });
        if (prog + 1 >= pz.solution.length) { s.keys.add(pz.lock); s.emit({ type: 'puzzle', id: pz.id }); }
      } else { this.seq.set(pz.id, 0); s.emit({ type: 'seq', puzzle: pz.id, ok: false, progress: 0 }); }
      return true;
    }
    if (ref.type === 'recruit') {
      const e = s.ew.entities.find((q) => q.id === ref.id);
      if (e) { e.data.following = true; e.data.hp = 100; this.companion = e; s.emit({ type: 'companion', what: 'recruited' }); }
      return true;
    }
    return false;
  }

  /** The real coworker answers the badge question correctly; the Skin-stealer slips. */
  ask(entityId: number): { answer: string; fake: boolean } | null {
    const e = this.sim.ew.entities.find((q) => q.id === entityId);
    const v = this.sim.plan.verify;
    if (!e || !v) return null;
    const fake = e.def.behavior === 'skinstealer';
    if (fake) e.data.reveal = true;
    return { answer: fake ? v.wrong : v.answer, fake };
  }

  spawnCompanion(hp: number): void {
    const p = this.sim.player;
    const e = this.sim.ew.spawn('companion', p.x - 1.2, p.z + 0.5, 0);
    e.data.following = true; e.data.hp = hp;
    this.companion = e;
  }

  // ---- items ----
  throwItem(): boolean {
    const s = this.sim, p = s.player;
    const t = THROWABLE.find(([id]) => s.inv.has(id));
    if (!t) return false;
    s.inv.remove(t[0], 1);
    let x = p.x, z = p.z; const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
    for (let d = 0.5; d <= 11; d += 0.5) { const nx = p.x + dx * d, nz = p.z + dz * d; if (s.world.segmentBlocked(x, z, nx, nz)) break; x = nx; z = nz; }
    s.noise.emit(s.ew.nav.roomAt(x, z) >= 0 ? s.ew.nav.roomAt(x, z) : s.room, x, z, t[1]);
    s.emit({ type: 'throw', x, z, item: t[0] });
    return true;
  }

  useSpecial(id: string): boolean | null {
    const s = this.sim, p = s.player;
    if (id === 'radio') {
      if (this.radioCooldown > 0 || this.radio) return false;
      this.radio = { x: p.x, z: p.z, t: 20, tick: 0 }; this.radioCooldown = 60;
      s.emit({ type: 'radio', x: p.x, z: p.z });
      return true;
    }
    if (id === 'tripline') { this.triplines.push({ x: p.x, z: p.z }); s.inv.remove('tripline', 1); s.emit({ type: 'use', item: 'tripline' }); return true; }
    void itemDef;
    return null;
  }
}
