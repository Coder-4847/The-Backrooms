/**
 * Fake volumetric light, Medium tier and up (Low/Potato skip it entirely):
 *  - LampShafts: three crossed, soft-edged quads hanging under every ceiling panel, additive, fading to nothing
 *    about 1.8 m down. Instanced per chunk (one draw call), coloured per instance so flicker, broken lamps and
 *    blackouts drive them exactly like the panels.
 *  - FlashBeam: a double-sided, open cone from the flashlight lens, additive, fading with distance and near
 *    the lens so it never washes over the camera. Reads as the beam cutting through the dusty air.
 * Neither writes depth or casts shadows, and neither adds a light (no shader recompiles).
 */
import {
  AdditiveBlending, BufferGeometry, CanvasTexture, Color, ConeGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, ShaderMaterial, SRGBColorSpace, Vector3, type Object3D,
} from 'three';

const SHAFT_H = 1.8;

function shaftTexture(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const v = y / 127, u = (x / 63) * 2 - 1;
    const a = Math.pow(1 - v, 2.2) * Math.exp(-u * u * 3.2) * (v < 0.04 ? v / 0.04 : 1);
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * a); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

/** Three vertical quads crossed at 60°, top edge at y=0, hanging down to -SHAFT_H. */
function shaftGeometry(w: number, d: number): BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const top = Math.max(w, d) * 0.9, bottom = Math.max(w, d) * 1.8;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, cx = Math.cos(a), cz = Math.sin(a), b = pos.length / 3;
    pos.push(-cx * top / 2, 0, -cz * top / 2, cx * top / 2, 0, cz * top / 2, cx * bottom / 2, -SHAFT_H, cz * bottom / 2, -cx * bottom / 2, -SHAFT_H, -cz * bottom / 2);
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class LampShafts {
  readonly geo: BufferGeometry;
  readonly mat: MeshBasicMaterial;
  private tex: CanvasTexture;
  private base: Color;
  private m = new Matrix4();
  constructor(lampW: number, lampD: number, lampColor: number, strength = 0.11) {
    this.tex = shaftTexture();
    this.geo = shaftGeometry(lampW, lampD);
    this.base = new Color(lampColor).multiplyScalar(strength);
    this.mat = new MeshBasicMaterial({ map: this.tex, color: this.base.clone(), transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: true });
  }

  /** One instanced mesh for a chunk's lamps (positions are the lamp centres, just under the panel). */
  build(points: { x: number; y: number; z: number }[]): InstancedMesh {
    const im = new InstancedMesh(this.geo, this.mat, points.length);
    points.forEach((p, i) => { this.m.makeRotationY((i * 0.7) % Math.PI).setPosition(p.x, p.y - 0.02, p.z); im.setMatrixAt(i, this.m); });
    im.frustumCulled = false; im.renderOrder = 4;
    return im;
  }

  /** Global dimming (blackout, dark levels). */
  setLevel(k: number): void { this.mat.color.copy(this.base).multiplyScalar(k); }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); }
}

export class FlashBeam {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private tmp = new Vector3();
  constructor(length = 6, radius = 1.15) {
    const geo = new ConeGeometry(radius, length, 24, 1, true);
    geo.translate(0, -length / 2, 0); // apex at the origin, opening along -y
    geo.rotateX(-Math.PI / 2);         // ... now along -z (lookAt points +z at the target, so flip below)
    this.mat = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(0xfff1d6) }, uK: { value: 0 }, uLen: { value: length } },
      vertexShader: /* glsl */`
        varying float vAlong;
        void main() {
          vAlong = clamp(-position.z / ${length.toFixed(2)}, 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uK;
        varying float vAlong;
        void main() {
          float a = pow(1.0 - vAlong, 1.8) * smoothstep(0.0, 0.12, vAlong) * uK;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  /** Aim from `from` towards `to`, with intensity k (0 hides it). */
  update(from: Vector3, to: Vector3, k: number, parent: Object3D): void {
    if (!this.mesh.parent) parent.add(this.mesh);
    this.mesh.visible = k > 0.01;
    this.mat.uniforms.uK.value = k;
    this.mesh.position.copy(from);
    // the cone opens along local -z: look *away* from the target so -z points at it
    this.tmp.copy(from).multiplyScalar(2).sub(to);
    this.mesh.lookAt(this.tmp);
  }

  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}
