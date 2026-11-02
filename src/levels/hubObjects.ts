/**
 * Hub dressing + interactables: level doors (portals with nameplates, sealed/open/complete states),
 * wing gates, stations (stash, notice board, bestiary, gallery, camcorder, kitchen, crafting) and
 * the survivors as restrained mannequins. Visual only; the headless sim gets `hubInteractables`.
 */
import { BoxGeometry, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, SRGBColorSpace, Color, type Scene } from 'three';
import { CAMPAIGN } from './campaign';
import { isImplemented } from './registry';
import { NPCS } from '../story/npcs';
import { fmtTime } from '../ui/dom';
import type { Collider } from '../core/collision';
import type { Interactable } from './sim';
import type { LevelPlan } from '../gen/types';

export interface HubState { frontier: number; completed: Record<string, { bestTime: number; difficulty: string }>; }
export type HubRef =
  | { type: 'door'; index: number }
  | { type: 'npc'; id: string }
  | { type: 'station'; kind: string };

const STATION_LABEL: Record<string, string> = { stash: 'Stash lockers', noteboard: 'Notice board', bestiary: 'Bestiary wall', gallery: 'Ending gallery', camcorder: 'Camcorder station', kitchen: 'Kitchen', crafting: 'Crafting table' };

export const doorState = (index: number, hub: HubState): 'continue' | 'replay' | 'sealed' | 'unbuilt' => {
  const e = CAMPAIGN[index];
  if (index > hub.frontier) return 'sealed';
  if (!isImplemented(e.id)) return 'unbuilt';
  return index === hub.frontier ? 'continue' : 'replay';
};

export const actReached = (hub: HubState): number => CAMPAIGN[Math.min(hub.frontier, CAMPAIGN.length - 1)].act;

function label(text: string, sub = '', color = '#e6dfc4', w = 512, h = 128): CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(12,11,8,0.9)'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(216,194,122,0.5)'; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6);
  g.fillStyle = color; g.textAlign = 'center'; g.font = 'bold 34px ui-monospace, Menlo, monospace'; g.fillText(text.length > 26 ? text.slice(0, 25) + '…' : text, w / 2, sub ? 52 : 74);
  if (sub) { g.fillStyle = '#9c9570'; g.font = '24px ui-monospace, Menlo, monospace'; g.fillText(sub, w / 2, 94); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
}

export function hubInteractables(plan: LevelPlan, hub: HubState): Interactable[] {
  const out: Interactable[] = [];
  const h = plan.hub!;
  for (const d of h.doors) {
    const st = doorState(d.index, hub);
    const e = CAMPAIGN[d.index];
    const text = st === 'continue' ? `Continue Campaign: ${e.name}` : st === 'replay' ? `Replay: ${e.name}` : st === 'unbuilt' ? `${e.name} (not built yet)` : 'Sealed door';
    out.push({ kind: 'custom', x: d.pos.x, z: d.pos.z + (d.side === 'N' ? 1.7 : -1.7), label: text, ref: { type: 'door', index: d.index } satisfies HubRef });
  }
  for (const n of h.npcs) out.push({ kind: 'custom', x: n.pos.x, z: n.pos.z, label: `Talk to ${NPCS[n.id].name}`, ref: { type: 'npc', id: n.id } satisfies HubRef });
  for (const s of h.stations) out.push({ kind: 'custom', x: s.pos.x, z: s.pos.z, label: STATION_LABEL[s.kind], ref: { type: 'station', kind: s.kind } satisfies HubRef });
  return out;
}

export function buildHubObjects(scene: Scene, plan: LevelPlan, hub: HubState): { colliders: Collider[]; update(t: number, px: number, pz: number): void; dispose(): void } {
  const h = plan.hub!;
  const toDispose: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T): T => { toDispose.push(x); return x; };
  const group = new Group(); scene.add(group);
  const metal = own(new MeshStandardMaterial({ color: 0x2a2a26, roughness: 0.5, metalness: 0.6 }));
  const wood = own(new MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.85 }));
  const post = own(new BoxGeometry(0.14, 2.5, 0.2)), lintel = own(new BoxGeometry(1.9, 0.16, 0.2)), plane = own(new PlaneGeometry(1.6, 2.35));
  const plate = own(new PlaneGeometry(1.9, 0.48));

  for (const d of h.doors) {
    const e = CAMPAIGN[d.index];
    const st = doorState(d.index, hub);
    const g = new Group(); g.position.set(d.pos.x, 0, d.pos.z); g.rotation.y = d.yaw;
    for (const sx of [-0.88, 0.88]) { const p = new Mesh(post, metal); p.position.set(sx, 1.25, 0); g.add(p); }
    const l = new Mesh(lintel, metal); l.position.set(0, 2.5, 0); g.add(l);
    const open = st === 'continue' || st === 'replay';
    const col = new Color(e.color).multiplyScalar(open ? 1.7 : st === 'unbuilt' ? 0.5 : 0.04);
    const portal = new Mesh(plane, own(new MeshBasicMaterial({ color: col }))); portal.position.set(0, 1.2, -0.05); g.add(portal);
    if (st === 'sealed') for (const a of [0.5, -0.5]) { const plank = new Mesh(own(new BoxGeometry(2, 0.14, 0.06)), wood); plank.position.set(0, 1.2 + a * 0.7, 0.02); plank.rotation.z = a * 0.35; g.add(plank); }
    const done = hub.completed[e.id];
    const sub = st === 'sealed' ? 'sealed' : done ? `done ${fmtTime(done.bestTime)} (${done.difficulty})` : st === 'unbuilt' ? 'coming soon' : st === 'continue' ? 'continue' : 'replay';
    const nameplate = new Mesh(plate, own(new MeshBasicMaterial({ map: own(label(`${d.index + 1}. ${e.name.replace(/^Level \d+: /, '')}`, sub, open ? '#f0e6b0' : '#6a6650', 512, 128)) })));
    nameplate.position.set(0, 2.85, 0.02); g.add(nameplate);
    group.add(g);
  }

  const colliders: Collider[] = [];
  const act = actReached(hub);
  for (const gate of h.gates) if (act < gate.act) {
    colliders.push(gate.box);
    const m = new Mesh(own(new BoxGeometry(gate.box.x1 - gate.box.x0 + 0.2, 3.2, gate.box.z1 - gate.box.z0)), own(new MeshStandardMaterial({ color: 0x3a2a24, roughness: 0.7, metalness: 0.5 })));
    m.position.set((gate.box.x0 + gate.box.x1) / 2, 1.6, (gate.box.z0 + gate.box.z1) / 2); group.add(m);
  }

  const stationBox = own(new BoxGeometry(1.4, 1.2, 0.7));
  const stationMat = own(new MeshStandardMaterial({ color: 0x4a4636, roughness: 0.8 }));
  for (const s of h.stations) {
    const m = new Mesh(stationBox, stationMat); m.position.set(s.pos.x, 0.6, s.pos.z); m.rotation.y = s.yaw; group.add(m);
    const lab = new Mesh(own(new PlaneGeometry(1.4, 0.35)), own(new MeshBasicMaterial({ map: own(label(STATION_LABEL[s.kind], '', '#d8c27a', 512, 128)) })));
    lab.position.set(s.pos.x - Math.sin(s.yaw) * 0.4, 1.55, s.pos.z - Math.cos(s.yaw) * 0.4); lab.rotation.y = s.yaw + Math.PI; group.add(lab);
    colliders.push({ x0: s.pos.x - 0.75, x1: s.pos.x + 0.75, z0: s.pos.z - 0.75, z1: s.pos.z + 0.75 });
  }

  const bodyG = own(new CylinderGeometry(0.2, 0.26, 1.2, 10)), headG = own(new SphereGeometry(0.14, 12, 10));
  const npcs = h.npcs.map((n) => {
    const def = NPCS[n.id];
    const g = new Group(); g.position.set(n.pos.x, 0, n.pos.z); g.rotation.y = n.yaw;
    const mat = own(new MeshStandardMaterial({ color: def.color, roughness: 0.9 }));
    const b = new Mesh(bodyG, mat); b.position.y = 0.8; g.add(b);
    const hd = new Mesh(headG, own(new MeshStandardMaterial({ color: 0xb8a890, roughness: 0.95 }))); hd.position.y = 1.55; g.add(hd);
    const tag = new Mesh(own(new PlaneGeometry(1.0, 0.25)), own(new MeshBasicMaterial({ map: own(label(def.name.split(' ')[0], def.role, '#cfc7a0', 320, 100)), transparent: true })));
    tag.position.y = 2.0; g.add(tag);
    group.add(g);
    colliders.push({ x0: n.pos.x - 0.35, x1: n.pos.x + 0.35, z0: n.pos.z - 0.35, z1: n.pos.z + 0.35 });
    return { g, tag, head: hd, base: n.yaw, x: n.pos.x, z: n.pos.z };
  });

  return {
    colliders,
    update(t, px, pz) {
      for (const n of npcs) {
        const near = Math.hypot(px - n.x, pz - n.z) < 6;
        const want = near ? Math.atan2(-(px - n.x), -(pz - n.z)) : n.base;
        let d = want - n.g.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
        n.g.rotation.y += d * 0.05;
        n.g.position.y = Math.sin(t * 1.4 + n.x) * 0.01; // breathing
        n.tag.rotation.y = -n.g.rotation.y + Math.atan2(px - n.x, pz - n.z);
      }
    },
    dispose() { group.removeFromParent(); toDispose.forEach((d) => d.dispose()); },
  };
}
