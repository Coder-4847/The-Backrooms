/**
 * Procedural sculpting + skinning toolkit for entity bodies. Bodies are ONE continuous SkinnedMesh
 * (per material slot group) driven by a real bone hierarchy, so elbows, knees and the neck bend
 * smoothly instead of being separate primitives:
 *  - `sweep`: a variable-radius, elliptical tube along a Catmull-Rom curve with domed caps, an
 *    optional per-vertex radius modifier (ribs, muscles, knuckles) and bone weights blended along it;
 *  - `blob`: a sculpted ellipsoid (welded sphere + displacement callback) bound to one bone;
 *  - `build`: merges everything into a SkinnedMesh with material groups.
 * Detail normal maps (skin pores, fabric weave, matted fur) are generated once per page.
 */
import {
  Bone, BufferAttribute, BufferGeometry, CatmullRomCurve3, DataTexture, LinearMipmapLinearFilter, LinearFilter, RepeatWrapping, NoColorSpace,
  Color, Material, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Skeleton, SkinnedMesh, SphereGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightToNormal } from '../gen/textures';

/** Bone stop along a sweep: at curve parameter t (0..1) the vertex belongs to `bone`. Weights blend linearly between stops. */
export type Stops = [number, number][];

export interface SweepOpts {
  slot: number;
  stops: Stops;
  /** Cross-section scale: x (side) and z/depth relative to the curve frame. */
  flat?: [number, number];
  capStart?: boolean; capEnd?: boolean;
  /** Radius multiplier per vertex: t along (0..1), a = angle around (0 = frame normal side). */
  mod?: (t: number, a: number) => number;
  /** Fixed "up" for the frame (keeps flattened sections oriented, e.g. torso width along x). */
  up?: Vector3;
}

const RES = [
  { radial: 5, seg: 4 }, { radial: 6, seg: 6 }, { radial: 9, seg: 9 }, { radial: 12, seg: 14 }, { radial: 18, seg: 22 },
];

export class Sculptor {
  readonly bones: Bone[] = [];
  private joint: Vector3[] = [];
  private parts = new Map<number, BufferGeometry[]>();
  /** Geometry is cached per body type + tier: later spawns only rebuild the (cheap) bone rig. */
  private cached: { geo: BufferGeometry; slots: number[] } | null;
  constructor(readonly level: number, readonly cacheKey = '') { this.cached = cacheKey ? GEO_CACHE.get(`${cacheKey}:${level}`) ?? null : null; }

  get res() { return RES[Math.max(0, Math.min(4, this.level))]; }

  /** Add a bone at a model-space joint position. Returns its index. */
  bone(name: string, parent: number, x: number, y: number, z: number): number {
    const b = new Bone(); b.name = name;
    const p = new Vector3(x, y, z);
    if (parent >= 0) { b.position.copy(p).sub(this.joint[parent]); this.bones[parent].add(b); } else b.position.copy(p);
    this.bones.push(b); this.joint.push(p);
    return this.bones.length - 1;
  }
  jointPos(i: number): Vector3 { return this.joint[i].clone(); }

  private push(slot: number, g: BufferGeometry): void { (this.parts.get(slot) ?? this.parts.set(slot, []).get(slot)!).push(g); }

  /** Variable-radius tube. `radii` are sampled evenly along the curve and interpolated smoothly. */
  sweep(points: Vector3[], radii: number[], o: SweepOpts, detail = 1): void {
    if (this.cached) return;
    const curve = new CatmullRomCurve3(points, false, 'centripetal');
    const R = Math.max(4, Math.round(this.res.radial * Math.min(1.5, detail)));
    const S = Math.max(2, Math.round(this.res.seg * detail * Math.min(2, 0.6 + curve.getLength())));
    const capRings = o.capStart || o.capEnd ? (this.level >= 3 ? 4 : 2) : 0;
    const rad = (t: number) => {
      const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)), u = f - i;
      const p0 = radii[Math.max(0, i - 1)], p1 = radii[i], p2 = radii[i + 1], p3 = radii[Math.min(radii.length - 1, i + 2)];
      return Math.max(0.002, 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u));
    };
    const [fx, fz] = o.flat ?? [1, 1];
    const up = o.up ?? null;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [];
    const uRep = Math.max(1, Math.round(Math.max(...radii) * 6.28 / 0.12));
    const tan = new Vector3(), nrm = new Vector3(), bin = new Vector3(), p = new Vector3(), dir = new Vector3(), tmp = new Vector3();
    const len = curve.getLength();
    const weights = (t: number): [number, number, number] => {
      const st = o.stops;
      if (t <= st[0][0]) return [st[0][1], st[0][1], 0];
      for (let k = 0; k + 1 < st.length; k++) {
        const [t0, b0] = st[k], [t1, b1] = st[k + 1];
        if (t <= t1) { const w = t1 > t0 ? (t - t0) / (t1 - t0) : 1; return [b0, b1, w]; }
      }
      const l = st[st.length - 1][1]; return [l, l, 0];
    };
    // rings: optional cap rings (dome) + body rings
    type Ring = { t: number; c: Vector3; r: number; k: number; tangent: Vector3; along: number };
    const rings: Ring[] = [];
    const frameAt = (t: number) => { curve.getTangentAt(t, tan).normalize(); return tan.clone(); };
    const startT = frameAt(0), endT = frameAt(1);
    const r0 = rad(0), r1 = rad(1);
    if (o.capStart) for (let i = capRings; i >= 1; i--) { const a = (i / (capRings + 0.0001)) * Math.PI / 2; rings.push({ t: 0, c: curve.getPointAt(0).addScaledVector(startT, -Math.sin(a) * r0 * 0.9), r: r0 * Math.cos(a), k: Math.sin(a), tangent: startT, along: -Math.sin(a) * r0 }); }
    for (let i = 0; i <= S; i++) { const t = i / S; rings.push({ t, c: curve.getPointAt(t), r: rad(t), k: 0, tangent: frameAt(t), along: t * len }); }
    if (o.capEnd) for (let i = 1; i <= capRings; i++) { const a = (i / (capRings + 0.0001)) * Math.PI / 2; rings.push({ t: 1, c: curve.getPointAt(1).addScaledVector(endT, Math.sin(a) * r1 * 0.9), r: r1 * Math.cos(a), k: -Math.sin(a), tangent: endT, along: len + Math.sin(a) * r1 }); }
    // parallel-transport frame
    let prevN: Vector3 | null = null;
    for (let ri = 0; ri < rings.length; ri++) {
      const g = rings[ri];
      const T = g.tangent;
      if (up) { nrm.copy(up).sub(tmp.copy(T).multiplyScalar(up.dot(T))); if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0); nrm.normalize(); }
      else if (!prevN) { nrm.set(0, 0, 1); if (Math.abs(T.z) > 0.9) nrm.set(1, 0, 0); nrm.sub(tmp.copy(T).multiplyScalar(nrm.dot(T))).normalize(); }
      else { nrm.copy(prevN).sub(tmp.copy(T).multiplyScalar(prevN.dot(T))).normalize(); }
      prevN = nrm.clone();
      bin.crossVectors(T, nrm).normalize();
      // radius slope for normals
      const dt = 0.01, dr = (rad(Math.min(1, g.t + dt)) - rad(Math.max(0, g.t - dt))) / (2 * dt * Math.max(0.01, len));
      const [b0, b1, w] = weights(g.t);
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2;
        const m = o.mod ? o.mod(g.t, a) : 1;
        const cx = Math.cos(a) * fx, cz = Math.sin(a) * fz;
        dir.copy(bin).multiplyScalar(cx).addScaledVector(nrm, cz);
        p.copy(g.c).addScaledVector(dir, g.r * m);
        pos.push(p.x, p.y, p.z);
        // normal: ellipse normal tilted by the radius slope (or the cap dome)
        const en = tmp.copy(bin).multiplyScalar(Math.cos(a) / fx).addScaledVector(nrm, Math.sin(a) / fz).normalize();
        if (g.k !== 0) en.multiplyScalar(Math.sqrt(1 - g.k * g.k)).addScaledVector(T, -g.k);
        else en.addScaledVector(T, -dr).normalize();
        en.normalize();
        nor.push(en.x, en.y, en.z);
        uv.push((j / R) * uRep, g.along / 0.12);
        si.push(b0, b1, 0, 0); sw.push(1 - w, w, 0, 0);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < R; j++) {
      const a = i * (R + 1) + j, b = a + R + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    // close caps with a centre vertex
    const closeCap = (ringIndex: number, tip: Vector3, n: Vector3, flip: boolean) => {
      const base = pos.length / 3;
      pos.push(tip.x, tip.y, tip.z); nor.push(n.x, n.y, n.z); uv.push(0.5, 0);
      const rs = ringIndex * (R + 1);
      si.push(si[rs * 4], si[rs * 4 + 1], 0, 0); sw.push(sw[rs * 4], sw[rs * 4 + 1], 0, 0);
      for (let j = 0; j < R; j++) { if (flip) idx.push(base, rs + j, rs + j + 1); else idx.push(base, rs + j + 1, rs + j); }
    };
    if (o.capStart) closeCap(0, curve.getPointAt(0).addScaledVector(startT, -r0 * 0.9), startT.clone().negate(), false);
    if (o.capEnd) closeCap(rings.length - 1, curve.getPointAt(1).addScaledVector(endT, r1 * 0.9), endT.clone(), true);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geo.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(si), 4));
    geo.setAttribute('skinWeight', new BufferAttribute(new Float32Array(sw), 4));
    geo.setIndex(idx);
    this.push(o.slot, geo);
  }

  /** Sculpted ellipsoid around `c` bound to one bone (or blended to a second by `blend(p)` 0..1). */
  blob(c: Vector3, rx: number, ry: number, rz: number, slot: number, bone: number, deform?: (p: Vector3, local: Vector3) => void, detail = 1, blend?: { bone: number; w: (p: Vector3) => number }): void {
    if (this.cached) return;
    const ws = Math.max(5, Math.round(this.res.radial * 1.4 * detail)), hs = Math.max(4, Math.round(this.res.radial * detail));
    let g: BufferGeometry = new SphereGeometry(1, ws, hs);
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    g = mergeVertices(g);
    const pa = g.getAttribute('position') as BufferAttribute;
    const p = new Vector3(), l = new Vector3();
    const n = pa.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), uvs = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      l.fromBufferAttribute(pa, i);
      uvs[i * 2] = (Math.atan2(l.z, l.x) / (Math.PI * 2) + 0.5) * Math.max(1, Math.round((rx + rz) * 3.14 / 0.12));
      uvs[i * 2 + 1] = (l.y * 0.5 + 0.5) * Math.max(1, ry * 2 / 0.12);
      p.set(l.x * rx, l.y * ry, l.z * rz).add(c);
      deform?.(p, l);
      pa.setXYZ(i, p.x, p.y, p.z);
      const w = blend ? Math.max(0, Math.min(1, blend.w(p))) : 0;
      si[i * 4] = bone; si[i * 4 + 1] = blend ? blend.bone : bone; sw[i * 4] = 1 - w; sw[i * 4 + 1] = w;
    }
    g.computeVertexNormals();
    g.setAttribute('uv', new BufferAttribute(uvs, 2));
    g.setAttribute('skinIndex', new BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new BufferAttribute(sw, 4));
    this.push(slot, g);
  }

  /** Merge into one SkinnedMesh (one group per material slot that has geometry). */
  build(mats: Material[]): SkinnedMesh {
    let geo: BufferGeometry, slots: number[];
    if (this.cached) ({ geo, slots } = this.cached);
    else {
      slots = [...this.parts.keys()].sort((a, b) => a - b);
      const merged = slots.map((s) => mergeGeometries(this.parts.get(s)!, false)!);
      geo = mergeGeometries(merged, true)!;
      merged.forEach((g) => g.dispose());
      this.parts.forEach((list) => list.forEach((g) => g.dispose()));
      geo.computeBoundingSphere();
      if (geo.boundingSphere) geo.boundingSphere.radius *= 1.6; // poses reach beyond the bind pose
      geo.userData.shared = !!this.cacheKey;
      if (this.cacheKey) GEO_CACHE.set(`${this.cacheKey}:${this.level}`, { geo, slots });
    }
    const groupMats = slots.map((s) => mats[s] ?? mats[0]);
    const mesh = new SkinnedMesh(geo, groupMats);
    const roots = this.bones.filter((b) => !(b.parent instanceof Bone));
    roots.forEach((r) => mesh.add(r));
    mesh.updateMatrixWorld(true);
    mesh.bind(new Skeleton(this.bones));
    mesh.frustumCulled = true;
    return mesh;
  }
}

const GEO_CACHE = new Map<string, { geo: BufferGeometry; slots: number[] }>();

// ---------- detail maps + materials ----------

type DetailKind = 'skin' | 'cloth' | 'fur';
const detailCache = new Map<DetailKind, DataTexture>();
const hash = (x: number, y: number, s: number) => { let n = Math.imul(x * 374761393 + y * 668265263 + s * 1442695041, 1274126177); n ^= n >>> 13; n = Math.imul(n, 1103515245); n ^= n >>> 16; return (n >>> 0) / 4294967296; };

/** Tileable detail normal map (128px): pores + fine wrinkles, fabric weave, or matted fur strands. */
export function detailNormal(kind: DetailKind): DataTexture {
  const hit = detailCache.get(kind);
  if (hit) return hit;
  const N = 128, h = new Float32Array(N * N);
  const vn = (x: number, y: number, p: number, s: number) => { // tileable value noise, period p cells
    const fx = (x / N) * p, fy = (y / N) * p, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const a = hash(ix % p, iy % p, s), b = hash((ix + 1) % p, iy % p, s), c = hash(ix % p, (iy + 1) % p, s), d = hash((ix + 1) % p, (iy + 1) % p, s);
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    if (kind === 'skin') v = vn(x, y, 32, 1) * 0.5 + vn(x, y, 64, 2) * 0.35 - (vn(x, y, 64, 3) > 0.78 ? 0.6 : 0) + vn(x, y, 8, 4) * 0.3;
    else if (kind === 'cloth') { const wx = Math.sin((x / N) * Math.PI * 2 * 48), wy = Math.sin((y / N) * Math.PI * 2 * 48); v = ((x + y) % 2 ? wx : wy) * 0.3 + (wx * wy) * 0.4 + vn(x, y, 32, 5) * 0.4; }
    else v = vn(x * 0.25, y, 16, 6) * 0.3 + Math.sin((x / N) * Math.PI * 2 * 24 + vn(x, y, 8, 7) * 6) * 0.35 + vn(x, y, 64, 8) * 0.3;
    h[y * N + x] = v;
  }
  const data = heightToNormal(h, N, kind === 'cloth' ? 2.5 : kind === 'fur' ? 3 : 2);
  const t = new DataTexture(data as unknown as Uint8Array, N, N);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace; t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  detailCache.set(kind, t);
  return t;
}

export interface SurfDef { color: number; rough?: number; metal?: number; kind?: DetailKind | 'eye' | 'glow' | 'flat'; emissive?: number; glow?: number; sheen?: number; clearcoat?: number; transparent?: boolean; opacity?: number }

/** Material for a slot, scaled by tier: Physical (sheen/clearcoat, detail normals) on High+, Standard on Medium, Lambert below. */
export function surface(level: number, d: SurfDef): Material {
  const transparent = !!d.transparent, opacity = d.opacity ?? 1;
  if (d.kind === 'glow') { const m = new MeshBasicMaterial({ color: new Color(d.color).multiplyScalar(d.glow ?? 3), transparent, opacity }); m.userData.keep = true; return m; }
  if (level <= 1) {
    const m = new MeshLambertMaterial({ color: d.color, emissive: new Color(d.emissive ?? 0), transparent, opacity });
    if (d.kind === 'eye') m.userData.keep = true;
    return m;
  }
  const detail = d.kind === 'skin' || d.kind === 'cloth' || d.kind === 'fur' ? detailNormal(d.kind) : null;
  const ns = d.kind === 'cloth' ? 0.55 : d.kind === 'fur' ? 0.8 : 0.35;
  const base = {
    color: d.color, roughness: d.rough ?? 0.7, metalness: d.metal ?? 0, emissive: new Color(d.emissive ?? 0), transparent, opacity,
    ...(detail ? { normalMap: detail, normalScale: new Vector2(ns, ns) } : {}),
  };
  let m: MeshStandardMaterial;
  if (level >= 3) {
    m = new MeshPhysicalMaterial({
      ...base,
      // sheen tinted from the base colour (a fixed tint turns dark skin red under a flashlight)
      sheen: Math.min(0.35, d.sheen ?? (d.kind === 'cloth' ? 0.6 : d.kind === 'skin' ? 0.15 : 0)), sheenRoughness: 0.65,
      sheenColor: new Color(d.color).lerp(new Color(d.kind === 'skin' ? 0xc89080 : 0xffffff), 0.25),
      clearcoat: d.clearcoat ?? (d.kind === 'eye' ? 1 : d.kind === 'skin' ? 0.12 : 0), clearcoatRoughness: d.kind === 'eye' ? 0.05 : 0.45,
    });
  } else m = new MeshStandardMaterial(base);
  if (d.kind === 'eye') m.userData.keep = true;
  return m;
}
