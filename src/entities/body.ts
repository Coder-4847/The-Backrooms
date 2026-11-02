/**
 * Procedural entity bodies (spec 7.2): lofted tubes along curves + ellipsoids, assembled at
 * runtime and animated procedurally (gait phase, twitchy secondary motion). Detail scales by tier:
 * a few hundred triangles on Potato, many thousands on Ultra. Distinct silhouettes in the dark:
 * the Stick is impossibly tall and thin; the Hound is low with two ember eyes.
 */
import { BoxGeometry, CatmullRomCurve3, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, TubeGeometry, Vector3, type BufferGeometry, type Material } from 'three';

export interface Body { group: Group; update(speed: number, t: number, dt: number, tell: boolean, seen: boolean): void; dispose(): void }

const radial = (level: number) => [3, 4, 6, 8, 12][Math.max(0, Math.min(4, level))];
const tubular = (level: number) => [4, 6, 8, 12, 18][Math.max(0, Math.min(4, level))];

function tube(points: Vector3[], radius: number, level: number): TubeGeometry {
  return new TubeGeometry(new CatmullRomCurve3(points), tubular(level), radius, radial(level), false);
}
function ellipsoid(rx: number, ry: number, rz: number, level: number): SphereGeometry {
  const g = new SphereGeometry(1, [5, 6, 8, 12, 20][level], [4, 5, 6, 9, 14][level]);
  g.scale(rx, ry, rz);
  return g;
}

export function buildStick(level: number, ghost = false): Body {
  const geos: BufferGeometry[] = [];
  const skin = new MeshStandardMaterial({ color: 0x1d1c19, roughness: 0.85, metalness: 0.05, emissive: new Color(0x120f0a), transparent: ghost, opacity: ghost ? 0.45 : 1 });
  const group = new Group();
  const part = (g: BufferGeometry, m: Material = skin): Mesh => { geos.push(g); const mesh = new Mesh(g, m); group.add(mesh); return mesh; };
  // spine/torso: a long tapered tube, 1.1 m of chest on 1.2 m legs, 2.8 m tall overall
  part(tube([new Vector3(0, 1.2, 0), new Vector3(0, 1.8, 0.03), new Vector3(0, 2.35, 0.0)], 0.085, level));
  const head = part(ellipsoid(0.1, 0.22, 0.09, level)); head.position.set(0, 2.62, 0);
  const armL = new Group(), armR = new Group(), legL = new Group(), legR = new Group();
  for (const [g, sx] of [[armL, -1], [armR, 1]] as const) {
    const m = new Mesh((geos[geos.push(tube([new Vector3(0, 0, 0), new Vector3(sx * 0.18, -0.55, 0.05), new Vector3(sx * 0.22, -1.15, 0.12), new Vector3(sx * 0.2, -1.55, 0.2)], 0.035, level)) - 1]), skin);
    g.add(m); g.position.set(sx * 0.12, 2.3, 0); group.add(g);
  }
  for (const [g, sx] of [[legL, -1], [legR, 1]] as const) {
    const m = new Mesh((geos[geos.push(tube([new Vector3(0, 0, 0), new Vector3(sx * 0.03, -0.6, 0.05), new Vector3(sx * 0.02, -1.2, 0)], 0.045, level)) - 1]), skin);
    g.add(m); g.position.set(sx * 0.07, 1.2, 0); group.add(g);
  }
  let twitch = 0, nextTwitch = 0.4;
  return {
    group,
    update(speed, t, dt, tell, seen) {
      const swing = Math.sin(t * 4.2) * Math.min(1, speed / 1.5);
      legL.rotation.x = swing * 0.5; legR.rotation.x = -swing * 0.5;
      armL.rotation.x = -swing * 0.25; armR.rotation.x = swing * 0.25;
      armL.rotation.z = Math.sin(t * 1.3) * 0.04 + (tell ? -0.5 : 0); armR.rotation.z = -Math.sin(t * 1.1) * 0.04 + (tell ? 0.5 : 0);
      nextTwitch -= dt;
      if (nextTwitch <= 0) { nextTwitch = 0.25 + Math.random() * (seen ? 1.4 : 0.6); twitch = (Math.random() - 0.5) * (seen ? 0.12 : 0.5); }
      head.rotation.z += (twitch - head.rotation.z) * Math.min(1, 18 * dt);
      head.rotation.x = tell ? 0.4 : Math.sin(t * 0.7) * 0.05;
      group.rotation.z = Math.sin(t * 2.1) * 0.01 * (seen ? 3 : 1);
    },
    dispose() { geos.forEach((g) => g.dispose()); skin.dispose(); },
  };
}

export function buildHound(level: number): Body {
  const geos: BufferGeometry[] = [];
  const skin = new MeshStandardMaterial({ color: 0x24201c, roughness: 0.8, metalness: 0.05 });
  const eyeMat = new MeshBasicMaterial({ color: new Color(0xff5a20).multiplyScalar(4) });
  const group = new Group();
  const part = (g: BufferGeometry, m: Material = skin): Mesh => { geos.push(g); const mesh = new Mesh(g, m); group.add(mesh); return mesh; };
  const body = part(ellipsoid(0.22, 0.2, 0.55, level)); body.position.set(0, 0.62, 0);
  const neck = part(tube([new Vector3(0, 0.7, -0.4), new Vector3(0, 0.82, -0.62), new Vector3(0, 0.78, -0.86)], 0.08, level));
  void neck;
  const head = new Group(); head.position.set(0, 0.76, -0.9); group.add(head);
  const skull = new Mesh((geos[geos.push(ellipsoid(0.1, 0.1, 0.2, level)) - 1]), skin); head.add(skull);
  for (const sx of [-1, 1]) { const eye = new Mesh((geos[geos.push(ellipsoid(0.022, 0.022, 0.022, Math.min(level, 2))) - 1]), eyeMat); eye.position.set(sx * 0.055, 0.03, -0.17); head.add(eye); }
  const legs: Group[] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const g = new Group(); g.position.set(sx * 0.16, 0.6, sz * 0.38);
    g.add(new Mesh((geos[geos.push(tube([new Vector3(0, 0, 0), new Vector3(sx * 0.02, -0.28, sz * -0.06), new Vector3(0, -0.6, sz * 0.05)], 0.035, level)) - 1]), skin));
    legs.push(g); group.add(g);
  }
  const tail = part(tube([new Vector3(0, 0.66, 0.5), new Vector3(0, 0.6, 0.8), new Vector3(0, 0.4, 1.0)], 0.03, level));
  let phase = 0;
  return {
    group,
    update(speed, t, dt, tell) {
      phase += speed * dt * 2.6;
      legs.forEach((l, i) => { l.rotation.x = Math.sin(phase + (i === 0 || i === 3 ? 0 : Math.PI)) * Math.min(0.9, speed * 0.3); });
      body.position.y = 0.62 + Math.abs(Math.sin(phase)) * 0.04 * Math.min(1, speed / 2);
      head.rotation.x = tell ? -0.3 + Math.sin(t * 40) * 0.03 : Math.sin(t * 0.9) * 0.08; // growl: head lowered, trembling
      tail.rotation.y = Math.sin(t * 3) * 0.2;
      group.rotation.z = Math.sin(t * 17) * (tell ? 0.03 : 0);
    },
    dispose() { geos.forEach((g) => g.dispose()); skin.dispose(); eyeMat.dispose(); },
  };
}

interface HumanOpts { height: number; suit: number; skin?: number; hat?: boolean; sash?: number; blink?: boolean; lantern?: boolean; wide?: boolean }

/** Restrained mannequin-like human: tubes for limbs, ellipsoids for torso/head; used by coworkers, Skin-stealer, Concierge, Monitor, Companion. */
export function buildHumanoid(level: number, o: HumanOpts): Body {
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const suit = new MeshStandardMaterial({ color: o.suit, roughness: 0.85 }), skin = new MeshStandardMaterial({ color: o.skin ?? 0xb8a890, roughness: 0.95 });
  mats.push(suit, skin);
  const group = new Group();
  const sc = o.height / 1.75;
  const add = (g: BufferGeometry, m: Material, parent: Group = group): Mesh => { geos.push(g); const mesh = new Mesh(g, m); parent.add(mesh); return mesh; };
  const torso = add(ellipsoid(o.wide ? 0.28 : 0.2, 0.34, 0.13, level), suit); torso.position.y = 1.2 * sc;
  const head = new Group(); head.position.y = 1.62 * sc; group.add(head);
  add(ellipsoid(0.11, 0.14, 0.11, level), skin, head);
  const eyes: Mesh[] = [];
  const eyeMat = new MeshBasicMaterial({ color: 0x050505 }); mats.push(eyeMat);
  for (const sx of [-1, 1]) { const e = add(ellipsoid(0.014, 0.014, 0.01, Math.min(level, 2)), eyeMat, head); e.position.set(sx * 0.04, 0.02, -0.1); eyes.push(e); }
  if (o.hat) { const hat = add(new CylinderGeometry(0.12, 0.13, 0.16, radial(level) + 4), suit, head); hat.position.y = 0.18; const brim = add(new CylinderGeometry(0.19, 0.19, 0.02, radial(level) + 4), suit, head); brim.position.y = 0.1; }
  if (o.sash) { const sash = new Mesh((geos[geos.push(new BoxGeometry(0.06, 0.6, 0.3)) - 1]), (() => { const m = new MeshStandardMaterial({ color: o.sash!, roughness: 0.8 }); mats.push(m); return m; })()); sash.position.set(0.1, 1.2 * sc, 0); sash.rotation.z = 0.5; group.add(sash); }
  const arms: Group[] = [], legs: Group[] = [];
  for (const sx of [-1, 1]) {
    const a = new Group(); a.position.set(sx * 0.22 * (o.wide ? 1.3 : 1), 1.45 * sc, 0); add(tube([new Vector3(0, 0, 0), new Vector3(sx * 0.03, -0.3 * sc, 0.02), new Vector3(sx * 0.04, -0.62 * sc, 0.05)], 0.04, level), suit, a); group.add(a); arms.push(a);
    const l = new Group(); l.position.set(sx * 0.09, 0.9 * sc, 0); add(tube([new Vector3(0, 0, 0), new Vector3(0, -0.45 * sc, 0.02), new Vector3(0, -0.88 * sc, 0)], 0.055, level), suit, l); group.add(l); legs.push(l);
  }
  if (o.lantern) { const lan = add(ellipsoid(0.05, 0.07, 0.05, Math.min(level, 2)), new MeshBasicMaterial({ color: new Color(0xffb050).multiplyScalar(3) })); lan.position.set(0.3, 0.95 * sc, -0.1); }
  let blinkT = 2 + Math.random() * 3;
  return {
    group,
    update(speed, t, dt, tell) {
      const sw = Math.sin(t * 4.6) * Math.min(1, speed / 1.4);
      legs[0].rotation.x = sw * 0.5; legs[1].rotation.x = -sw * 0.5; arms[0].rotation.x = -sw * 0.35; arms[1].rotation.x = sw * 0.35;
      if (tell) { arms[0].rotation.z = -0.5; arms[1].rotation.z = 0.5; head.rotation.x = 0.35; } else { arms[0].rotation.z = 0; arms[1].rotation.z = 0; head.rotation.x = Math.sin(t * 0.6) * 0.04; }
      blinkT -= dt;
      if (o.blink) { const closed = blinkT < 0.12; for (const e of eyes) e.scale.y = closed ? 0.1 : 1; if (blinkT < 0) blinkT = 2 + Math.random() * 4; }
      torso.scale.y = 1 + Math.sin(t * 1.6) * 0.01;
    },
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}

export function buildHowler(level: number): Body {
  const geos: BufferGeometry[] = []; const mats: Material[] = [];
  const skin = new MeshStandardMaterial({ color: 0x2b2a2e, roughness: 0.75 }), mouthM = new MeshBasicMaterial({ color: 0x050204 });
  mats.push(skin, mouthM);
  const group = new Group();
  const add = (g: BufferGeometry, m: Material, parent: Group = group): Mesh => { geos.push(g); const mesh = new Mesh(g, m); parent.add(mesh); return mesh; };
  const body = add(ellipsoid(0.38, 0.55, 0.28, level), skin); body.position.y = 1.0;
  const head = new Group(); head.position.y = 1.78; group.add(head);
  add(ellipsoid(0.26, 0.3, 0.24, level), skin, head);
  const mouth = add(ellipsoid(0.12, 0.05, 0.05, level), mouthM, head); mouth.position.set(0, -0.08, -0.2); // a blind head: no eyes, only a mouth
  const arms: Group[] = [];
  for (const sx of [-1, 1]) { const a = new Group(); a.position.set(sx * 0.4, 1.4, 0); add(tube([new Vector3(0, 0, 0), new Vector3(sx * 0.12, -0.5, 0.05), new Vector3(sx * 0.1, -1.0, 0.1), new Vector3(sx * 0.08, -1.3, 0.2)], 0.06, level), skin, a); group.add(a); arms.push(a); }
  const legs: Group[] = [];
  for (const sx of [-1, 1]) { const l = new Group(); l.position.set(sx * 0.16, 0.55, 0); add(tube([new Vector3(0, 0, 0), new Vector3(0, -0.28, 0.04), new Vector3(0, -0.55, 0)], 0.09, level), skin, l); group.add(l); legs.push(l); }
  return {
    group,
    update(speed, t, _dt, tell) {
      const sw = Math.sin(t * 3.4) * Math.min(1, speed / 1.5);
      legs[0].rotation.x = sw * 0.6; legs[1].rotation.x = -sw * 0.6; arms[0].rotation.x = -sw * 0.4; arms[1].rotation.x = sw * 0.4;
      head.rotation.z = Math.sin(t * 1.9) * 0.18; // listening: head cocked, swaying
      mouth.scale.set(1 + (tell ? 1.4 : 0), tell ? 8 + Math.sin(t * 40) * 2 : 1, 1);
      head.rotation.x = tell ? -0.5 : 0;
    },
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}

export function buildBody(defId: string, level: number): Body {
  switch (defId) {
    case 'hound': return buildHound(level);
    case 'howler': return buildHowler(level);
    case 'coworker': return buildHumanoid(level, { height: 1.75, suit: 0x56606a, blink: true });
    case 'skinstealer': return buildHumanoid(level, { height: 1.78, suit: 0x56606a, blink: false });
    case 'concierge': return buildHumanoid(level, { height: 2.1, suit: 0x141214, hat: true, skin: 0xa89c90 });
    case 'monitor': return buildHumanoid(level, { height: 1.9, suit: 0x2a4a3a, sash: 0xd8c040, blink: true, wide: true });
    case 'companion': return buildHumanoid(level, { height: 1.65, suit: 0xa8602a, blink: true, lantern: true });
    default: return buildStick(level);
  }
}
