/**
 * Procedural entity bodies (spec 7.2), sculpted and skinned (see sculpt.ts): every creature is one
 * continuous SkinnedMesh on a real bone rig with anatomical proportions, a sculpted skull (sockets,
 * brow, nose, cheekbones, jaw), hands with fingers on High+, and physically based skin/cloth
 * (sheen, clearcoat, detail normals) on High/Ultra. Animation is procedural (gait cycles with knee
 * and elbow bend, counter-rotation, breathing, twitches). Detail scales by tier. Front is -z.
 */
import {
  Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3, type Bone, type BufferGeometry, type Material, type SkinnedMesh,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Sculptor, surface, type SurfDef } from './sculpt';

export interface Body { group: Group; update(speed: number, t: number, dt: number, tell: boolean, seen: boolean): void; dispose(): void }

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Slots shared by all rigs. */
const enum S { Skin = 0, Cloth = 1, Pants = 2, Shoes = 3, Eye = 4, Hair = 5, Accent = 6, Dark = 7, Lip = 8, Nail = 9 }

interface Built { mesh: SkinnedMesh; mats: Material[]; extras: { geo: BufferGeometry[]; mats: Material[] } }

function finish(sc: Sculptor, defs: Partial<Record<S, SurfDef>>, level: number, ghost = false): Built {
  const mats: Material[] = [];
  const sk = defs[S.Skin]!;
  const auto: Partial<Record<S, SurfDef>> = {
    [S.Lip]: { ...sk, color: new Color(sk.color).lerp(new Color(0x8a3a34), 0.32).getHex(), rough: 0.42 },
    [S.Nail]: { color: new Color(sk.color).lerp(new Color(0xf0dcd0), 0.45).getHex(), rough: 0.3, clearcoat: 0.6 },
  };
  for (let i = 0; i <= 9; i++) {
    const d = defs[i as S] ?? auto[i as S] ?? sk;
    mats.push(surface(level, ghost ? { ...d, transparent: true, opacity: 0.42 } : d));
  }
  const mesh = sc.build(mats);
  mesh.castShadow = level >= 3 && !ghost;
  mesh.receiveShadow = level >= 3;
  return { mesh, mats, extras: { geo: [], mats: [] } };
}

/** A small mesh attached to a bone (eyes that blink/glow, mouths that gape). */
function attach(b: Built, bone: Bone, geo: BufferGeometry, mat: Material, x: number, y: number, z: number, worldJoint: Vector3): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x - worldJoint.x, y - worldJoint.y, z - worldJoint.z);
  bone.add(m);
  b.extras.geo.push(geo); b.extras.mats.push(mat);
  return m;
}

function disposeBuilt(b: Built): void {
  if (!b.mesh.geometry.userData.shared) b.mesh.geometry.dispose();
  b.mats.forEach((m) => m.dispose());
  b.extras.geo.forEach((g) => g.dispose()); b.extras.mats.forEach((m) => m.dispose());
  b.mesh.skeleton.dispose();
}

// ---------------------------------------------------------------- humanoid rig

interface Proportions {
  height: number; shoulder: number; hip: number; thick: number; arm: number; leg: number; torso: number; neck: number; head: number;
  /** 0..1: emaciation (visible ribs, hollow belly) */ gaunt: number;
  finger: number; headLong?: number; belly?: number;
}
const HUMAN: Proportions = { height: 1.75, shoulder: 0.19, hip: 0.1, thick: 1, arm: 0.76, leg: 0.85, torso: 0.52, neck: 0.1, head: 1, gaunt: 0, finger: 1 };

interface Dress { shirt: boolean; pants: boolean; shoes: boolean; hair: boolean; tie: boolean; hat?: boolean; sash?: boolean; eyes: 'human' | 'void' | 'glow' | 'none'; sockets?: number }

interface HumanRig {
  root: number; spine: number; chest: number; neck: number; head: number;
  sh: [number, number]; el: [number, number]; wr: [number, number]; hp: [number, number]; kn: [number, number]; an: [number, number];
  eyePos: Vector3[]; headTop: number; handPos: Vector3[];
}

/** Sculpt a standing human-like figure into `sc`. Proportions drive everything from a coworker to the Stick. */
function sculptHuman(sc: Sculptor, P: Proportions, D: Dress): HumanRig {
  const k = P.height / 1.75;
  const yAnkle = 0.085 * k, yHip = yAnkle + P.leg * k, yKnee = yAnkle + P.leg * k * 0.49;
  const yRoot = yHip + 0.05 * k, yNeck = yRoot + P.torso * k, ySpine = yRoot + P.torso * k * 0.33, yChest = yRoot + P.torso * k * 0.66;
  const yHead = yNeck + P.neck * k, ySh = yNeck - 0.06 * k;
  const yEl = ySh - P.arm * k * 0.5, yWr = ySh - P.arm * k;
  const sw = P.shoulder * k, hw = P.hip * k, th = P.thick * k, bulk = 0.55 + 0.45 * P.thick;

  const root = sc.bone('root', -1, 0, yRoot, 0);
  const spine = sc.bone('spine', root, 0, ySpine, 0.01 * k);
  const chest = sc.bone('chest', spine, 0, yChest, 0);
  const neck = sc.bone('neck', chest, 0, yNeck, 0.01 * k);
  const head = sc.bone('head', neck, 0, yHead, -0.005 * k);
  const sh: [number, number] = [0, 0], el: [number, number] = [0, 0], wr: [number, number] = [0, 0], hp: [number, number] = [0, 0], kn: [number, number] = [0, 0], an: [number, number] = [0, 0];
  [-1, 1].forEach((sx, i) => {
    sh[i] = sc.bone(`sh${i}`, chest, sx * sw, ySh, 0.01 * k);
    el[i] = sc.bone(`el${i}`, sh[i], sx * (sw + 0.025 * k), yEl, 0.03 * k);
    wr[i] = sc.bone(`wr${i}`, el[i], sx * (sw + 0.035 * k), yWr, 0);
    hp[i] = sc.bone(`hp${i}`, root, sx * hw, yHip, 0);
    kn[i] = sc.bone(`kn${i}`, hp[i], sx * (hw + 0.005 * k), yKnee, -0.015 * k);
    an[i] = sc.bone(`an${i}`, kn[i], sx * (hw + 0.005 * k), yAnkle, 0.03 * k);
  });

  // ---- torso: elliptical, hips -> waist -> ribcage -> shoulders -> neck base
  const gaunt = P.gaunt;
  const torsoSlot = D.shirt ? S.Cloth : S.Skin;
  sc.sweep([V(0, yHip - 0.07 * k, 0.01 * k), V(0, yRoot + 0.02 * k, 0.012 * k), V(0, ySpine, 0.015 * k), V(0, yChest, 0.005 * k), V(0, ySh - 0.035 * k, 0.01 * k), V(0, ySh + 0.035 * k, 0.012 * k), V(0, yNeck + 0.02 * k, 0.015 * k)],
    [1.5 * hw, 1.62 * hw, 0.14 * k * bulk * (1 - gaunt * 0.25) * (1 + (P.belly ?? 0)), 0.165 * k * bulk * (sw / (0.19 * k)) ** 0.6, 0.185 * k * (sw / (0.19 * k)) * (0.75 + 0.25 * bulk), 0.12 * k * (sw / (0.19 * k)) ** 0.5, 0.068 * k],
    {
      slot: torsoSlot, stops: [[0, root], [0.2, root], [0.4, spine], [0.62, chest], [1, chest]], flat: [1, 0.62], up: V(0, 0, -1), capStart: true,
      mod: (t, a) => {
        const front = Math.max(0, Math.sin(a)), back = Math.max(0, -Math.sin(a));
        let m = 1;
        // ribs: horizontal ridges on the front/sides of the ribcage (strong when gaunt), hollow belly under them
        if (t > 0.42 && t < 0.78) m += (Math.cos((t - 0.42) * Math.PI * 2 * 7) * 0.5 + 0.5) * (0.012 + gaunt * 0.06) * (0.4 + front * 0.6) * smooth(0.42, 0.5, t) * smooth(0.78, 0.7, t);
        if (t > 0.2 && t < 0.45) m -= gaunt * 0.12 * front * smooth(0.2, 0.3, t) * smooth(0.45, 0.38, t);
        // spine groove + shoulder blades
        m -= back * Math.exp(-Math.pow(Math.cos(a) * 6, 2)) * 0.05;
        if (t > 0.6 && t < 0.82) m += back * 0.025 * Math.sin(((t - 0.6) / 0.22) * Math.PI) * (1 - Math.exp(-Math.pow(Math.cos(a) * 3, 2)));
        // chest / pectorals
        if (t > 0.6 && t < 0.85 && !D.shirt) m += front * 0.03 * Math.sin(((t - 0.6) / 0.25) * Math.PI) * (1 - gaunt);
        return m;
      },
    }, 1.3);
  if (D.shirt) {
    // collar + a tie (office workers)
    sc.sweep([V(0, yNeck - 0.02 * k, 0.012 * k), V(0, yNeck + 0.035 * k, 0.012 * k)], [0.07 * k, 0.062 * k], { slot: S.Cloth, stops: [[0, chest], [1, neck]], flat: [1, 0.95], up: V(0, 0, -1) }, 0.6);
    if (D.tie) sc.sweep([V(0, yNeck - 0.02 * k, -0.075 * k), V(0, ySh - 0.12 * k, -0.105 * k), V(0, yChest - 0.12 * k, -0.105 * k)], [0.012 * k, 0.03 * k, 0.026 * k], { slot: S.Accent, stops: [[0, chest], [1, chest]], flat: [1, 0.25], up: V(0, 0, -1), capEnd: true }, 0.5);
  }
  if (D.sash) sc.sweep([V(-sw * 0.9, ySh, 0), V(0, yChest, -0.115 * k), V(sw * 0.8, yRoot + 0.05 * k, 0)], [0.05 * k, 0.05 * k, 0.05 * k], { slot: S.Accent, stops: [[0, chest], [1, spine]], flat: [1, 0.15], up: V(0, 1, 0) }, 0.7);

  // ---- neck
  sc.sweep([V(0, yNeck - 0.04 * k, 0.012 * k), V(0, yNeck + 0.04 * k, 0.005 * k), V(0, yHead + 0.04 * k, -0.005 * k)],
    [0.058 * k * (1 - gaunt * 0.2), 0.05 * k * (1 - gaunt * 0.25), 0.05 * k], { slot: S.Skin, stops: [[0, chest], [0.35, neck], [1, head]], mod: (_t, a) => 1 + Math.max(0, Math.sin(a)) * gaunt * 0.12 * Math.abs(Math.cos(a * 2)) }, 0.8);

  // ---- head: sculpted skull
  const hs = P.head * k, hl = P.headLong ?? 1;
  const hc = V(0, yHead + 0.105 * hs * hl, -0.012 * k);
  const rx = 0.082 * hs, ry = 0.112 * hs * hl, rz = 0.1 * hs;
  const sockets = D.sockets ?? 1;
  const eyeL = (sx: number) => V(sx * 0.37, 0.1, -0.92);
  sc.blob(hc, rx, ry, rz, S.Skin, head, (p, l) => {
    const front = Math.max(0, -l.z);
    if (l.y < 0) { p.x -= l.x * rx * 0.24 * -l.y * (0.6 + 0.4 * front); p.z -= 0.012 * hs * front * -l.y; } // jaw taper, chin
    p.z += 0.016 * hs * Math.max(0, l.z) * Math.max(0, l.y + 0.4);                                       // occiput
    for (const sx of [-1, 1]) {
      const e = eyeL(sx), d = Math.hypot(l.x - e.x, (l.y - e.y) * 1.25, l.z - e.z);
      if (d < 0.36) p.z += (Math.cos((d / 0.36) * Math.PI) * 0.5 + 0.5) * 0.017 * hs * sockets;           // eye sockets
      const cb = Math.hypot(l.x - sx * 0.62, l.y + 0.08, l.z + 0.72); if (cb < 0.3) p.x += sx * (0.3 - cb) * 0.02 * hs; // cheekbones
    }
    if (l.y > 0.18 && l.y < 0.4) p.z -= front * front * 0.006 * hs * Math.sin(((l.y - 0.18) / 0.22) * Math.PI);  // brow ridge
    const nd = Math.hypot(l.x / 0.13, (l.y + 0.05) / 0.32, (l.z + 1) / 0.6);
    if (nd < 1) p.z -= (1 - nd * nd) * 0.026 * hs * (D.eyes === 'void' ? 0.3 : 1);                       // nose
    if (Math.abs(l.y + 0.42) < 0.05 && Math.abs(l.x) < 0.3 && front > 0.75) p.z += 0.004 * hs;          // mouth line
    if (l.y < -0.55) p.y += 0.006 * hs * front;                                                          // chin underside
  }, 1.5);
  // ears
  if (D.eyes !== 'void') for (const sx of [-1, 1]) sc.blob(V(hc.x + sx * rx * 0.98, hc.y - 0.005 * hs, hc.z + 0.01 * hs), 0.012 * hs, 0.03 * hs, 0.02 * hs, S.Skin, head, undefined, 0.5);
  const eyePos = [-1, 1].map((sx) => { const e = eyeL(sx); return V(hc.x + e.x * rx * 0.94, hc.y + e.y * ry, hc.z + e.z * rz * 0.86); });
  const surf = (x: number, y: number, z: number, out = 0) => { const l = V(x, y, z).normalize(); return V(hc.x + l.x * rx, hc.y + l.y * ry, hc.z + l.z * rz - out); };
  if (D.eyes === 'human' || D.eyes === 'glow') {
    const er = 0.0125 * k;
    for (const e of eyePos) {
      // upper lid hooding the top of the eyeball, a thinner lower lid; crisp lid edges
      sc.blob(V(e.x, e.y + er * 0.42, e.z - er * 0.12), er * 1.38, er * 0.78, er * 1.02, S.Skin, head, (p, l) => { if (l.y < -0.1) p.y = Math.max(p.y, e.y + er * 0.12); }, 0.45);
      sc.blob(V(e.x, e.y - er * 0.66, e.z - er * 0.02), er * 1.2, er * 0.42, er * 0.95, S.Skin, head, undefined, 0.35);
    }
    if (sc.level >= 2) {
      for (const sx of [-1, 1]) { // eyebrows
        const pts = [surf(sx * 0.14, 0.31, -0.95, 0.004 * hs), surf(sx * 0.36, 0.35, -0.87, 0.004 * hs), surf(sx * 0.58, 0.29, -0.74, 0.003 * hs)];
        sc.sweep(pts, [0.0042 * hs, 0.0038 * hs, 0.0022 * hs], { slot: S.Hair, stops: [[0, head], [1, head]], flat: [1, 0.45], capStart: true, capEnd: true }, 0.35);
      }
    }
    // lips: upper and lower, following the curve of the face
    const lip = (y: number, r: number) => sc.sweep([-0.27, -0.14, 0, 0.14, 0.27].map((x) => surf(x, y, -0.95 + Math.abs(x) * 0.3, 0.0015 * hs)), [r * 0.3, r * 0.85, r, r * 0.85, r * 0.3], { slot: S.Lip, stops: [[0, head], [1, head]], flat: [1, 0.7], capStart: true, capEnd: true }, 0.4);
    lip(-0.4, 0.0052 * hs); lip(-0.465, 0.0062 * hs);
  }
  if (D.hair) sc.blob(V(hc.x, hc.y + 0.008 * hs, hc.z + 0.004 * hs), rx * 1.07, ry * 1.04, rz * 1.06, S.Hair, head, (p, l) => {
    // keep the hair cap above the brow and ears: tuck everything else inside the skull
    const front = -l.z;
    const keep = l.y > 0.05 + Math.max(0, front) * 0.42 || (l.z > 0.15 && l.y > -0.45);
    if (!keep) p.sub(hc).multiplyScalar(0.85).add(hc);
  }, 1.2);
  if (D.hat) {
    sc.sweep([V(0, hc.y + ry * 0.55, hc.z), V(0, hc.y + ry * 0.55 + 0.17 * hs, hc.z)], [rx * 1.2, rx * 1.12], { slot: S.Cloth, stops: [[0, head], [1, head]], capEnd: true }, 0.6);
    sc.sweep([V(0, hc.y + ry * 0.5, hc.z), V(0, hc.y + ry * 0.52, hc.z)], [rx * 2.0, rx * 2.0], { slot: S.Cloth, stops: [[0, head], [1, head]], capStart: true, capEnd: true }, 0.6);
  }

  // ---- arms (one continuous sweep shoulder -> elbow -> wrist) + hands
  const armSlot = D.shirt ? S.Cloth : S.Skin;
  const handPos: Vector3[] = [];
  [-1, 1].forEach((sx, i) => {
    const s0 = sc.jointPos(sh[i]), e0 = sc.jointPos(el[i]), w0 = sc.jointPos(wr[i]);
    sc.sweep([V(sx * sw * 0.55, ySh - 0.015 * k, 0.012 * k), s0, e0, w0],
      [0.048 * th, 0.052 * th * (1 - gaunt * 0.3), 0.048 * th * (1 - gaunt * 0.35), 0.04 * th * (1 - gaunt * 0.3), 0.043 * th * (1 - gaunt * 0.4), 0.03 * th],
      {
        slot: armSlot, stops: [[0, chest], [0.18, sh[i]], [0.52, sh[i]], [0.62, el[i]], [0.97, el[i]], [1, wr[i]]],
        mod: (t, a) => 1 + (t > 0.25 && t < 0.55 ? Math.sin(((t - 0.25) / 0.3) * Math.PI) * 0.08 * Math.max(0, Math.sin(a)) * (1 - gaunt) : 0) + (gaunt > 0.4 && Math.abs(t - 0.6) < 0.05 ? 0.25 * gaunt : 0)
          // sleeve creases bunching at the elbow, a looser drape on the upper arm
          + (D.shirt ? 0.035 * Math.sin(t * 74 + a * 1.7) * smooth(0.42, 0.55, t) * smooth(0.78, 0.62, t) + 0.015 * Math.sin(a * 3 + t * 11) : 0),
      }, 1);
    if (D.shirt) sc.sweep([V(w0.x, w0.y + 0.06 * k, w0.z), V(w0.x, w0.y + 0.015 * k, w0.z)], [0.034 * th, 0.032 * th], { slot: S.Skin, stops: [[0, el[i]], [1, wr[i]]] }, 0.5);
    // hand: palm + fingers (curled slightly toward the thigh)
    const fl = P.finger;
    const palm = V(w0.x + sx * 0.004 * k, w0.y - 0.05 * k, w0.z - 0.005 * k);
    handPos.push(V(palm.x, palm.y - 0.05 * k * fl, palm.z));
    sc.blob(palm, 0.017 * k, 0.048 * k, 0.04 * k, S.Skin, wr[i], undefined, 0.7);
    if (sc.level >= 3) {
      for (let f = 0; f < 4; f++) {
        const fz = palm.z + (-0.027 + f * 0.018) * k, base = V(palm.x, palm.y - 0.04 * k, fz);
        const len = (f === 0 || f === 3 ? 0.06 : 0.072) * k * fl;
        sc.sweep([base, V(base.x - sx * 0.004 * k, base.y - len * 0.55, fz - 0.002 * k), V(base.x - sx * 0.014 * k, base.y - len, fz - 0.004 * k)],
          [0.009 * k, 0.008 * k, 0.0065 * k], { slot: S.Skin, stops: [[0, wr[i]], [1, wr[i]]], capEnd: true, mod: (t) => 1 + (Math.abs(t - 0.5) < 0.06 ? 0.15 : 0) }, 0.4);
        const tip = V(base.x - sx * 0.014 * k, base.y - len, fz - 0.004 * k);
        sc.blob(V(tip.x + sx * 0.0045 * k, tip.y + 0.007 * k, tip.z), 0.0022 * k, 0.0075 * k, 0.0055 * k, S.Nail, wr[i], undefined, 0.3);
      }
      const tb = V(palm.x - sx * 0.008 * k, palm.y - 0.01 * k, palm.z - 0.04 * k);
      sc.sweep([tb, V(tb.x - sx * 0.008 * k, tb.y - 0.03 * k, tb.z - 0.016 * k), V(tb.x - sx * 0.012 * k, tb.y - 0.05 * k * fl, tb.z - 0.02 * k)], [0.011 * k, 0.009 * k, 0.007 * k], { slot: S.Skin, stops: [[0, wr[i]], [1, wr[i]]], capEnd: true }, 0.4);
    }
  });

  if (D.pants) { // belt
    sc.sweep([V(0, yHip + 0.03 * k, 0.012 * k), V(0, yHip + 0.065 * k, 0.012 * k)], [1.6 * hw * 1.04, 1.62 * hw * 1.04], { slot: S.Shoes, stops: [[0, root], [1, root]], flat: [1, 0.64], up: V(0, 0, -1) }, 0.6);
    sc.blob(V(0, yHip + 0.048 * k, 0.012 * k - 1.6 * hw * 1.04 * 0.64 - 0.004 * k), 0.022 * k, 0.016 * k, 0.006 * k, S.Nail, root, undefined, 0.3); // buckle
  }
  // ---- legs (hip -> knee -> ankle) + feet
  const legSlot = D.pants ? S.Pants : S.Skin;
  [-1, 1].forEach((sx, i) => {
    const h0 = sc.jointPos(hp[i]), k0 = sc.jointPos(kn[i]), a0 = sc.jointPos(an[i]);
    sc.sweep([V(sx * hw * 0.5, yHip + 0.05 * k, 0.005 * k), h0, k0, a0],
      [0.095 * th, 0.088 * th * (1 - gaunt * 0.3), 0.068 * th * (1 - gaunt * 0.35), 0.05 * th, 0.058 * th * (1 - gaunt * 0.4), 0.042 * th, 0.036 * th],
      {
        slot: legSlot, stops: [[0, root], [0.15, hp[i]], [0.52, hp[i]], [0.6, kn[i]], [0.97, kn[i]], [1, an[i]]],
        mod: (t, a) => 1 + (t > 0.62 && t < 0.85 ? Math.sin(((t - 0.62) / 0.23) * Math.PI) * 0.1 * Math.max(0, -Math.sin(a)) * (1 - gaunt) : 0) + (Math.abs(t - 0.56) < 0.04 ? (D.pants ? 0.03 : 0.08 + gaunt * 0.2) : 0)
          // trouser creases behind the knee and the break over the shoe
          + (D.pants ? 0.03 * Math.sin(t * 60 + a * 2.2) * smooth(0.48, 0.56, t) * smooth(0.7, 0.6, t) + 0.05 * smooth(0.9, 1, t) + 0.012 * Math.sin(a * 2 + t * 7) : 0),
      }, 1);
    const footSlot = D.shoes ? S.Shoes : S.Skin;
    sc.sweep([V(a0.x, a0.y + 0.03 * k, a0.z + 0.035 * k), V(a0.x, 0.045 * k, a0.z - 0.03 * k), V(a0.x + sx * 0.005 * k, 0.035 * k, a0.z - 0.12 * k * (P.finger > 1.5 ? 1.4 : 1)), V(a0.x + sx * 0.008 * k, 0.03 * k, a0.z - 0.17 * k * (P.finger > 1.5 ? 1.4 : 1))],
      [0.042 * k, 0.045 * k, 0.04 * k, 0.032 * k], { slot: footSlot, stops: [[0, an[i]], [1, an[i]]], flat: [1.05, 0.62], up: V(0, 1, 0), capStart: true, capEnd: true }, 0.7);
  });

  return { root, spine, chest, neck, head, sh, el, wr, hp, kn, an, eyePos, headTop: hc.y + ry, handPos };
}

/** Walk cycle + idle for a human rig. Returns the phase accumulator owner. */
function humanAnimator(sc: Sculptor, r: HumanRig, opts: { stride?: number; hunch?: number; armOut?: number } = {}) {
  const B = sc.bones;
  const rootY = B[r.root].position.y;
  let ph = Math.random() * 6;
  return (speed: number, t: number, dt: number, tell: boolean) => {
    const amt = Math.min(1, speed / 1.4);
    ph += dt * (1.2 + speed * 2.6) * (opts.stride ?? 1);
    const s = Math.sin(ph), c = Math.cos(ph);
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? 1 : -1;
      B[r.hp[i]].rotation.x = sg * s * 0.48 * amt - 0.02;
      B[r.kn[i]].rotation.x = -Math.max(0, Math.sin(ph * 1 + (i === 0 ? 1.7 : 1.7 + Math.PI))) * 0.95 * amt - 0.04;
      B[r.an[i]].rotation.x = Math.max(0, -sg * s) * 0.25 * amt;
      B[r.sh[i]].rotation.x = -sg * s * 0.4 * amt + (tell ? -0.25 : 0);
      B[r.sh[i]].rotation.z = (i === 0 ? -1 : 1) * ((opts.armOut ?? 0.05) + (tell ? 0.55 : 0) + Math.sin(t * 1.3 + i) * 0.02);
      B[r.el[i]].rotation.x = 0.18 + Math.max(0, -sg * s) * 0.35 * amt + (tell ? 0.4 : 0);
    }
    B[r.root].position.y = rootY + (Math.abs(c) - 0.6) * 0.035 * amt;
    B[r.root].rotation.y = s * 0.07 * amt;
    B[r.chest].rotation.y = -s * 0.12 * amt;
    B[r.spine].rotation.x = (opts.hunch ?? 0) + Math.sin(t * 1.6) * 0.012; // breathing
    B[r.chest].rotation.x = Math.sin(t * 1.6 + 0.5) * 0.015 + (opts.hunch ?? 0) * 0.5;
    B[r.head].rotation.x = tell ? 0.35 : Math.sin(t * 0.6) * 0.04 - (opts.hunch ?? 0) * 0.8;
  };
}

// ---------------------------------------------------------------- the Stick (tall, gaunt, faceless)

export function buildStick(level: number, ghost = false): Body {
  const sc = new Sculptor(level, 'stick');
  const P: Proportions = { ...HUMAN, height: 2.8, shoulder: 0.15, hip: 0.062, thick: 0.6, arm: 1.0, leg: 0.96, torso: 0.5, neck: 0.16, head: 0.95, headLong: 1.35, gaunt: 0.9, finger: 2.4 };
  const r = sculptHuman(sc, P, { shirt: false, pants: false, shoes: false, hair: false, tie: false, eyes: 'void', sockets: 2.2 });
  const b = finish(sc, { [S.Skin]: { color: 0x2a2620, rough: 0.8, kind: 'flesh', emissive: 0x050403, sheen: 0.2, clearcoat: 0.25 } }, level, ghost);
  const group = new Group(); group.add(b.mesh);
  // the void where its eyes should be: two pin-pricks of reflected light
  const eyeM = new MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 0, transparent: ghost, opacity: ghost ? 0.4 : 1 });
  const eg = new SphereGeometry(0.012 * 2.8 / 1.75, 8, 6);
  const head = sc.bones[r.head], hj = sc.jointPos(r.head);
  r.eyePos.forEach((p) => attach(b, head, eg.clone(), eyeM, p.x, p.y, p.z, hj));
  eg.dispose();
  const anim = humanAnimator(sc, r, { stride: 0.55, hunch: 0.14, armOut: 0.07 });
  let twitch = 0, nextTwitch = 0.4;
  return {
    group,
    update(speed, t, dt, tell, seen) {
      anim(speed, t, dt, tell);
      nextTwitch -= dt;
      if (nextTwitch <= 0) { nextTwitch = 0.25 + Math.random() * (seen ? 1.4 : 0.6); twitch = (Math.random() - 0.5) * (seen ? 0.12 : 0.6); }
      head.rotation.z += (twitch - head.rotation.z) * Math.min(1, 18 * dt);
      if (tell) head.rotation.x = 0.5;
      sc.bones[r.wr[0]].rotation.z = Math.sin(t * 2.3) * 0.15; sc.bones[r.wr[1]].rotation.z = Math.sin(t * 1.9 + 1) * 0.15; // fingers flex
      group.rotation.z = Math.sin(t * 2.1) * 0.01 * (seen ? 3 : 1);
    },
    dispose() { disposeBuilt(b); },
  };
}

// ---------------------------------------------------------------- Hound (a person that forgot how to stand)

export function buildHound(level: number): Body {
  const sc = new Sculptor(level, 'hound');
  const root = sc.bone('pelvis', -1, 0, 0.6, 0.36);
  const spine = sc.bone('spine', root, 0, 0.66, 0.05);
  const chest = sc.bone('chest', spine, 0, 0.64, -0.24);
  const neck = sc.bone('neck', chest, 0, 0.6, -0.44);
  const head = sc.bone('head', neck, 0, 0.55, -0.56);
  const jaw = sc.bone('jaw', head, 0, 0.5, -0.6);
  const legs: { a: number; b: number; c: number; front: boolean; side: number }[] = [];
  for (const sx of [-1, 1]) {
    const s = sc.bone('sh', chest, sx * 0.17, 0.62, -0.3), e = sc.bone('el', s, sx * 0.2, 0.34, -0.22), w = sc.bone('wr', e, sx * 0.19, 0.05, -0.32);
    legs.push({ a: s, b: e, c: w, front: true, side: sx });
    const h = sc.bone('hp', root, sx * 0.13, 0.58, 0.4), k = sc.bone('kn', h, sx * 0.17, 0.3, 0.16), a = sc.bone('an', k, sx * 0.15, 0.1, 0.5);
    legs.push({ a: h, b: k, c: a, front: false, side: sx });
  }
  // torso: horizontal, ribs and vertebrae showing
  sc.sweep([V(0, 0.6, 0.5), V(0, 0.665, 0.18), V(0, 0.66, -0.12), V(0, 0.63, -0.36), V(0, 0.6, -0.46)], [0.13, 0.12, 0.15, 0.165, 0.07], {
    slot: S.Skin, stops: [[0, root], [0.3, spine], [0.55, spine], [0.75, chest], [1, chest]], flat: [1, 0.78], up: V(0, 1, 0), capStart: true,
    mod: (t, a) => {
      const top = Math.max(0, Math.sin(a)), side = Math.abs(Math.cos(a)), under = Math.max(0, -Math.sin(a));
      let m = 1 + top * Math.exp(-Math.pow(Math.cos(a) * 7, 2)) * (0.08 + 0.05 * Math.max(0, Math.cos(t * Math.PI * 2 * 9)));  // vertebrae
      if (t > 0.45 && t < 0.85) m += side * 0.07 * (Math.cos((t - 0.45) * Math.PI * 2 * 6) * 0.5 + 0.5) * Math.sin(((t - 0.45) / 0.4) * Math.PI); // ribs
      if (t > 0.2 && t < 0.45) m -= under * 0.22 * Math.sin(((t - 0.2) / 0.25) * Math.PI); // tucked belly
      return m;
    },
  }, 1.3);
  sc.sweep([V(0, 0.62, -0.4), V(0, 0.6, -0.5), V(0, 0.56, -0.57)], [0.06, 0.05, 0.05], { slot: S.Skin, stops: [[0, chest], [0.4, neck], [1, head]] }, 0.7);
  // skull, long and low; lower jaw on its own bone
  const hc = V(0, 0.58, -0.66);
  sc.blob(hc, 0.075, 0.08, 0.12, S.Skin, head, (p, l) => {
    const front = Math.max(0, -l.z);
    for (const sx of [-1, 1]) { const d = Math.hypot(l.x - sx * 0.42, l.y - 0.2, l.z + 0.8); if (d < 0.35) p.z += (0.35 - d) * 0.05; }
    if (l.y < -0.2) p.y += 0.01 * front;
    p.y -= front * front * 0.012;
  }, 1.2);
  sc.blob(V(0, 0.535, -0.69), 0.055, 0.025, 0.1, S.Skin, jaw, (p, l) => { p.y -= Math.max(0, -l.z) * 0.006; }, 0.8);
  // matted hair hanging off the skull
  const strands = [0, 8, 14, 22, 34][level];
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 1.6 - 0.8, x = Math.sin(a) * 0.07, z = -0.62 + Math.cos(a) * 0.06;
    const len = 0.22 + ((i * 37) % 11) / 30;
    sc.sweep([V(x, 0.64, z), V(x * 1.5, 0.6, z + 0.02), V(x * 1.9, 0.6 - len * 0.6, z - 0.01), V(x * 2.0 + Math.sin(i) * 0.02, 0.6 - len, z - 0.03)], [0.016, 0.014, 0.01, 0.004], { slot: S.Hair, stops: [[0, head], [0.5, head], [1, neck]], capEnd: true }, 0.35);
  }
  // limbs: arms as forelegs (hands flat, long fingers), legs folded under
  for (const L of legs) {
    const p0 = sc.jointPos(L.a), p1 = sc.jointPos(L.b), p2 = sc.jointPos(L.c);
    sc.sweep([V(L.side * (L.front ? 0.1 : 0.08), p0.y + 0.03, p0.z), p0, p1, p2], L.front ? [0.055, 0.05, 0.035, 0.04, 0.026] : [0.08, 0.075, 0.045, 0.045, 0.03],
      { slot: S.Skin, stops: [[0, L.front ? chest : root], [0.2, L.a], [0.5, L.a], [0.6, L.b], [0.95, L.b], [1, L.c]], mod: (t) => 1 + (Math.abs(t - 0.55) < 0.05 ? 0.25 : 0) }, 0.9);
    if (L.front) {
      sc.blob(V(p2.x, 0.035, p2.z - 0.04), 0.035, 0.016, 0.05, S.Skin, L.c, undefined, 0.6);
      if (level >= 2) for (let f = 0; f < 4; f++) { const fx = p2.x + (-0.024 + f * 0.016) * L.side; sc.sweep([V(fx, 0.03, p2.z - 0.07), V(fx, 0.02, p2.z - 0.13), V(fx, 0.008, p2.z - 0.17)], [0.008, 0.007, 0.004], { slot: S.Skin, stops: [[0, L.c], [1, L.c]], capEnd: true }, 0.35); }
    } else sc.sweep([V(p2.x, 0.12, p2.z + 0.02), V(p2.x, 0.04, p2.z - 0.06), V(p2.x, 0.025, p2.z - 0.18)], [0.04, 0.04, 0.026], { slot: S.Skin, stops: [[0, L.c], [1, L.c]], flat: [1, 0.6], up: V(0, 1, 0), capEnd: true, capStart: true }, 0.6);
  }
  const b = finish(sc, { [S.Skin]: { color: 0x4a4038, rough: 0.7, kind: 'flesh', sheen: 0.25, clearcoat: 0.3 }, [S.Hair]: { color: 0x0e0c0b, rough: 0.7, kind: 'fur', sheen: 0.6 } }, level);
  const group = new Group(); group.add(b.mesh);
  const eyeMat = new MeshBasicMaterial({ color: new Color(0xff5a20).multiplyScalar(4) });
  const hj = sc.jointPos(head);
  for (const sx of [-1, 1]) attach(b, sc.bones[head], new SphereGeometry(0.014, 8, 6), eyeMat, sx * 0.032, 0.6, -0.755, hj);
  b.extras.mats.push(eyeMat);
  const B = sc.bones;
  let phase = 0;
  return {
    group,
    update(speed, t, dt, tell) {
      phase += speed * dt * 3.2 + dt * 0.3;
      const amt = Math.min(1, speed * 0.4);
      legs.forEach((L, i) => {
        const diag = (L.front ? L.side : -L.side) > 0 ? 0 : Math.PI;
        const s = Math.sin(phase + diag);
        B[L.a].rotation.x = s * 0.55 * amt;
        B[L.b].rotation.x = (L.front ? 1 : -1) * Math.max(0, Math.sin(phase + diag + 1.5)) * 0.6 * amt;
        void i;
      });
      B[root].position.y = 0.6 + Math.abs(Math.sin(phase)) * 0.035 * amt;
      B[spine].rotation.x = Math.sin(phase * 2) * 0.03 * amt + Math.sin(t * 1.9) * 0.015;
      B[head].rotation.x = tell ? 0.3 + Math.sin(t * 40) * 0.03 : Math.sin(t * 0.9) * 0.08;
      B[head].rotation.y = Math.sin(t * 0.5) * 0.15 * (1 - amt);
      B[jaw].rotation.x = tell ? 0.45 + Math.sin(t * 30) * 0.08 : 0.04;
      group.rotation.z = Math.sin(t * 17) * (tell ? 0.025 : 0);
    },
    dispose() { disposeBuilt(b); },
  };
}

// ---------------------------------------------------------------- dressed humans (coworkers, the Concierge, the Companion...)

interface HumanOpts { height: number; suit: number; skin?: number; hat?: boolean; sash?: number; blink?: boolean; lantern?: boolean; wide?: boolean; hair?: number; pants?: number; gaunt?: number; eyes?: Dress['eyes'] }

export function buildHumanoid(level: number, o: HumanOpts): Body {
  const sc = new Sculptor(level, `human:${JSON.stringify(o)}`);
  const P: Proportions = { ...HUMAN, height: o.height, shoulder: o.wide ? 0.24 : 0.19, thick: o.wide ? 1.2 : 1, belly: o.wide ? 0.15 : 0, gaunt: o.gaunt ?? 0 };
  const r = sculptHuman(sc, P, { shirt: true, pants: true, shoes: true, hair: o.hair !== undefined || !o.hat, tie: !o.sash && !o.lantern, hat: o.hat, sash: o.sash !== undefined, eyes: o.eyes ?? 'human' });
  const skin = o.skin ?? 0xb8a890;
  const b = finish(sc, {
    [S.Skin]: { color: skin, rough: 0.58, kind: 'skin' },
    [S.Cloth]: { color: o.suit, rough: 0.85, kind: 'cloth' },
    [S.Pants]: { color: o.pants ?? new Color(o.suit).multiplyScalar(0.55).getHex(), rough: 0.85, kind: 'cloth' },
    [S.Shoes]: { color: 0x15110e, rough: 0.35, clearcoat: 0.6 },
    [S.Hair]: { color: o.hair ?? 0x2a2018, rough: 0.6, kind: 'fur', sheen: 0.5 },
    [S.Accent]: { color: o.sash ?? 0x5a1a1a, rough: 0.7, kind: 'cloth' },
  }, level);
  const group = new Group(); group.add(b.mesh);
  const head = sc.bones[r.head], hj = sc.jointPos(r.head);
  const eyes: Mesh[] = [];
  if (o.eyes !== 'none') {
    const irises = [0x5a3a22, 0x3a5a6a, 0x4a5a32, 0x2a1e16, 0x6a6a5a];
    const iris = irises[Math.abs(Math.round(o.suit + o.height * 100)) % irises.length];
    const em = o.eyes === 'glow' ? new MeshBasicMaterial({ color: new Color(0xf4f0d0).multiplyScalar(2.5) })
      : level <= 1 ? surface(level, { color: 0x6a5a4c, kind: 'eye' }) : surface(level, { color: 0xffffff, kind: 'eye', iris, rough: 0.06, clearcoat: 1 });
    const seg = level >= 3 ? 16 : 10;
    for (const p of r.eyePos) eyes.push(attach(b, head, new SphereGeometry(0.0125 * o.height / 1.75, seg, Math.round(seg * 0.75)), em, p.x, p.y, p.z, hj));
  }
  if (o.lantern) {
    const lm = new MeshBasicMaterial({ color: new Color(0xffb050).multiplyScalar(3) }), hp = r.handPos[1];
    attach(b, sc.bones[r.wr[1]], new SphereGeometry(0.05, 10, 8), lm, hp.x, hp.y - 0.06, hp.z, sc.jointPos(r.wr[1]));
  }
  const anim = humanAnimator(sc, r, { hunch: o.gaunt ? 0.15 : 0 });
  let blinkT = 2 + Math.random() * 3;
  return {
    group,
    update(speed, t, dt, tell) {
      anim(speed, t, dt, tell);
      blinkT -= dt;
      if (o.blink) { const closed = blinkT < 0.12; for (const e of eyes) e.scale.y = closed ? 0.1 : 1; if (blinkT < 0) blinkT = 2 + Math.random() * 4; }
    },
    dispose() { disposeBuilt(b); },
  };
}

// ---------------------------------------------------------------- Howler (hulking, blind, all mouth)

export function buildHowler(level: number): Body {
  const sc = new Sculptor(level, 'howler');
  const P: Proportions = { ...HUMAN, height: 2.05, shoulder: 0.3, hip: 0.13, thick: 1.55, arm: 0.98, leg: 0.8, torso: 0.6, neck: 0.06, head: 1.25, gaunt: 0.35, finger: 1.6, belly: 0.1 };
  const r = sculptHuman(sc, P, { shirt: false, pants: false, shoes: false, hair: false, tie: false, eyes: 'void', sockets: 0 });
  const b = finish(sc, { [S.Skin]: { color: 0x3a363a, rough: 0.65, kind: 'flesh', sheen: 0.25, clearcoat: 0.35 } }, level);
  const group = new Group(); group.add(b.mesh);
  const mouthM = new MeshBasicMaterial({ color: 0x050204 });
  const hj = sc.jointPos(r.head), k = 2.05 / 1.75;
  const mouth = attach(b, sc.bones[r.head], new SphereGeometry(1, 12, 8), mouthM, 0, hj.y + 0.06 * k, -0.105 * k * 1.25, hj);
  mouth.scale.set(0.07, 0.025, 0.03);
  const anim = humanAnimator(sc, r, { stride: 0.8, hunch: 0.32, armOut: 0.12 });
  return {
    group,
    update(speed, t, dt, tell) {
      anim(speed, t, dt, tell);
      const head = sc.bones[r.head];
      head.rotation.z = Math.sin(t * 1.9) * 0.18; // listening: head cocked, swaying
      head.rotation.x = tell ? -0.5 : -0.2;
      mouth.scale.set(0.07 * (1 + (tell ? 1.2 : 0)), 0.025 * (tell ? 6 + Math.sin(t * 40) * 1.5 : 1), 0.03);
    },
    dispose() { disposeBuilt(b); },
  };
}

// ---------------------------------------------------------------- Leviathan (mostly submerged)

export function buildLeviathan(level: number): Body {
  const sc = new Sculptor(level, 'leviathan');
  const N = 6, bones: number[] = [];
  for (let i = 0; i < N; i++) bones.push(sc.bone(`s${i}`, i ? bones[i - 1] : -1, 0, 0.4, -4 + i * 1.6));
  const stops: [number, number][] = bones.map((bn, i) => [i / (N - 1), bn]);
  sc.sweep([V(0, 0.5, -4.4), V(0, 0.45, -3.2), V(0, 0.4, -1.5), V(0, 0.4, 0.5), V(0, 0.35, 2.4), V(0, 0.3, 4.2)], [0.3, 0.8, 1.05, 0.95, 0.55, 0.12], {
    slot: S.Skin, stops, flat: [1.1, 0.85], up: V(0, 1, 0), capStart: true, capEnd: true,
    mod: (t, a) => 1 + Math.max(0, Math.sin(a)) * 0.05 * Math.sin(t * 60) + Math.max(0, -Math.sin(a)) * 0.04 * Math.sin(t * 25 + a * 3),
  }, 2);
  for (let i = 0; i < 5; i++) { const z = -2 + i * 0.9; sc.sweep([V(0, 1.15 - i * 0.05, z), V(0, 1.6 - i * 0.08, z + 0.35)], [0.22 - i * 0.025, 0.02], { slot: S.Skin, stops: [[0, bones[Math.min(N - 1, 1 + Math.floor(i / 2))]], [1, bones[Math.min(N - 1, 1 + Math.floor(i / 2))]]], flat: [0.25, 1], capStart: true }, 0.5); }
  const b = finish(sc, { [S.Skin]: { color: 0x1c2228, rough: 0.35, metal: 0.1, kind: 'flesh', clearcoat: 0.8 } }, level);
  const group = new Group(), inner = new Group(); group.add(inner); inner.add(b.mesh);
  const eyeM = new MeshBasicMaterial({ color: new Color(0xc8e8ff).multiplyScalar(1.5) });
  const j0 = sc.jointPos(bones[0]);
  for (const sx of [-1, 1]) attach(b, sc.bones[bones[0]], new SphereGeometry(0.07, 8, 6), eyeM, sx * 0.42, 0.72, -4.0, j0);
  return {
    group,
    update(speed, t, _dt, tell) {
      inner.position.y = -1.1 + Math.sin(t * 0.8) * 0.15 + (speed > 1 || tell ? 0.6 : 0); // mostly submerged, surfacing when it moves
      bones.forEach((bn, i) => { sc.bones[bn].rotation.y = Math.sin(t * 1.4 - i * 0.7) * 0.08 * (1 + Math.min(1, speed)); });
      inner.rotation.z = Math.sin(t * 1.1) * 0.05;
    },
    dispose() { disposeBuilt(b); },
  };
}

// ---------------------------------------------------------------- Smiler (darkness with teeth)

export function buildSmiler(level: number): Body {
  const geos: BufferGeometry[] = []; const mats: Material[] = [];
  const glow = new MeshBasicMaterial({ color: new Color(0xf4f0d0).multiplyScalar(3) }); mats.push(glow);
  const dark = new MeshStandardMaterial({ color: 0x050505, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false }); mats.push(dark);
  const group = new Group();
  const add = (g: BufferGeometry, m: Material): Mesh => { geos.push(g); const mesh = new Mesh(g, m); group.add(mesh); return mesh; };
  const seg = [6, 8, 12, 16, 24][level];
  const body = add(new SphereGeometry(1, seg, seg), dark); body.scale.set(0.3, 0.8, 0.2); body.position.y = 1.0;
  // the grin: 17 teeth merged into one mesh (one draw call); the whole row stretches on the tell
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 17; i++) {
    const a = -0.95 + (i / 16) * 1.9;
    const g = new SphereGeometry(1, 6, 5); g.scale(0.022, 0.045 + Math.cos(a) * 0.012, 0.012); g.translate(Math.sin(a) * 0.26, -Math.cos(a) * 0.1, -0.2 - Math.cos(a) * 0.02);
    parts.push(g);
  }
  const teethG = mergeGeometries(parts)!; parts.forEach((g) => g.dispose());
  const teeth = add(teethG, glow); teeth.position.y = 1.7;
  for (const sx of [-1, 1]) { const e = add(new SphereGeometry(1, 8, 6), glow); e.scale.set(0.045, 0.022, 0.015); e.position.set(sx * 0.1, 1.78, -0.2); e.rotation.z = sx * 0.25; }
  return {
    group,
    update(_speed, t, _dt, tell) {
      group.position.y = Math.sin(t * 1.3) * 0.04;
      teeth.scale.y = tell ? 2 + Math.sin(t * 30) * 0.3 : 1;
      body.scale.x = 0.3 * (1 + (tell ? 0.3 : 0));
    },
    dispose() { geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose()); },
  };
}

// ---------------------------------------------------------------- Leech (segmented, wet)

export function buildLeech(level: number): Body {
  const sc = new Sculptor(level, 'leech');
  const b0 = sc.bone('a', -1, 0, 0.15, -0.4), b1 = sc.bone('b', b0, 0, 0.18, 0), b2 = sc.bone('c', b1, 0, 0.15, 0.4);
  sc.sweep([V(0, 0.13, -0.55), V(0.08, 0.22, -0.2), V(-0.08, 0.2, 0.15), V(0, 0.12, 0.55)], [0.08, 0.17, 0.16, 0.06], {
    slot: S.Skin, stops: [[0, b0], [0.5, b1], [1, b2]], capStart: true, capEnd: true, flat: [1, 0.8], up: V(0, 1, 0),
    mod: (t) => 1 + 0.07 * Math.max(0, Math.cos(t * Math.PI * 2 * 9)),
  }, 1.4);
  const b = finish(sc, { [S.Skin]: { color: 0x382e20, rough: 0.3, metal: 0.05, kind: 'flesh', clearcoat: 1 } }, level);
  const group = new Group(); group.add(b.mesh);
  return {
    group,
    update(speed, t) {
      const k = 0.3 + Math.min(1, speed);
      sc.bones[b0].rotation.y = Math.sin(t * 3) * 0.25 * k; sc.bones[b1].rotation.y = Math.sin(t * 3 - 1) * 0.3 * k; sc.bones[b2].rotation.y = Math.sin(t * 3 - 2) * 0.3 * k;
      b.mesh.scale.z = 1 + Math.sin(t * 6) * 0.1 * k;
    },
    dispose() { disposeBuilt(b); },
  };
}

/** Wrap a body: tint every non-eye material and scale it (cheap variants like pale Drowned or small crawlers). */
function variant(b: Body, scale: number, color?: number, emissive?: number): Body {
  b.group.scale.setScalar(scale);
  b.group.traverse((o) => {
    const mm = (o as Mesh).material;
    if (!mm) return;
    for (const m of Array.isArray(mm) ? mm : [mm]) {
      if (m.userData.keep || m instanceof MeshBasicMaterial) continue;
      const s = m as MeshStandardMaterial;
      if (color !== undefined && s.color) s.color.setHex(color);
      if (emissive !== undefined && s.emissive) s.emissive.setHex(emissive);
    }
  });
  return b;
}

export function buildBody(defId: string, level: number): Body {
  switch (defId) {
    case 'hound': return buildHound(level);
    case 'howler': return buildHowler(level);
    case 'coworker': return buildHumanoid(level, { height: 1.75, suit: 0x56606a, blink: true });
    case 'skinstealer': return buildHumanoid(level, { height: 1.78, suit: 0x56606a, blink: false });
    case 'concierge': return buildHumanoid(level, { height: 2.1, suit: 0x141214, hat: true, skin: 0xa89c90, gaunt: 0.4 });
    case 'monitor': return buildHumanoid(level, { height: 1.9, suit: 0x2a4a3a, sash: 0xd8c040, blink: true, wide: true });
    case 'companion': return buildHumanoid(level, { height: 1.65, suit: 0xa8602a, blink: true, lantern: true, hair: 0x4a3420 });
    case 'lurker': return variant(buildHowler(level), 1.12, 0x0e0e12);
    case 'leviathan': return buildLeviathan(level);
    case 'crawler': return variant(buildHound(level), 0.55, 0x1c2a22);
    case 'smiler': return buildSmiler(level);
    case 'drowned': return variant(buildHumanoid(level, { height: 1.8, suit: 0x4a5a60, skin: 0x8ea0a4, blink: false, gaunt: 0.5, hair: 0x1a1e1e }), 1, undefined, 0x0a1418);
    case 'leech': return buildLeech(level);
    case 'static': { const b = variant(buildStick(level), 0.7, 0x0a2a30, 0x0a5a66); const g = b.group; const up = b.update; b.update = (sp, t, dt, tell, seen) => { up(sp, t, dt, tell, seen); g.position.x += (Math.random() - 0.5) * 0.04; g.scale.y = 0.7 * (1 + (Math.random() < 0.08 ? 0.3 : 0)); }; return b; }
    case 'wraith': return variant(buildStick(level), 0.85, 0x2a3040, 0x101828);
    case 'partygoer': return buildHumanoid(level, { height: 1.75, suit: 0xc0306a, hat: true, blink: false, skin: 0xe8d8c8, eyes: 'void' });
    case 'watcher': return buildHumanoid(level, { height: 1.8, suit: 0xd8d8d0, skin: 0xe8e8e0, blink: false, eyes: 'glow' });
    case 'stalker': return variant(buildStick(level), 1.0, 0xe8f0f8, 0x405060);
    case 'windowman': return variant(buildStick(level), 0.78, 0x6a7080, 0x101420);
    case 'echo': return variant(buildHumanoid(level, { height: 1.75, suit: 0x40d8ff, blink: false }), 1, 0x40d8ff, 0x1080a0);
    case 'curator': return buildHumanoid(level, { height: 2.3, suit: 0x8a6a2a, hat: true, sash: 0x401010, blink: false, skin: 0xc8b890, gaunt: 0.5 });
    case 'pursuer': { const b = variant(buildHowler(level), 2.6, 0x3a0e0e, 0x300606); return b; }
    case 'architect': return buildHumanoid(level, { height: 2.4, suit: 0xe8e0c8, skin: 0xf0ead8, blink: false, wide: true, eyes: 'none' });
    case 'faceling': return buildHumanoid(level, { height: 1.7, suit: 0xa8602a, blink: false, lantern: true, eyes: 'none' });
    default: return buildStick(level);
  }
}
