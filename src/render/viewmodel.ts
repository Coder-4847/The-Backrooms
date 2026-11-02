/**
 * First-person viewmodel: the player's right hand holding the flashlight, sculpted with the same
 * toolkit as the entities (sleeve, wrist, palm, fingers wrapped round a knurled aluminium body,
 * a glowing lens). Parented to the camera; sways with look and bobs with steps.
 */
import { Color, Group, Mesh, MeshBasicMaterial, CircleGeometry, Vector3, type Camera, type Material } from 'three';
import { Sculptor, surface } from '../entities/sculpt';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

export class Viewmodel {
  readonly group = new Group();
  private inner = new Group();
  private lensMat: MeshBasicMaterial;
  private mats: Material[] = [];
  private mesh: Mesh;
  private lens: Mesh;
  private lastYaw = 0; private lastPitch = 0;
  private swayX = 0; private swayY = 0;
  private dropped = 1;

  constructor(level: number) {
    const sc = new Sculptor(level, 'viewmodel2');
    const b = sc.bone('hand', -1, 0, 0, 0);
    // flashlight along -z: tail cap, knurled grip, head, bezel
    sc.sweep([V(0, 0, 0.13), V(0, 0, 0.0), V(0, 0, -0.08), V(0, 0, -0.11), V(0, 0, -0.15)], [0.019, 0.019, 0.019, 0.026, 0.028], {
      slot: 1, stops: [[0, b], [1, b]], capStart: true,
      mod: (t, a) => 1 + (t > 0.15 && t < 0.55 ? 0.05 * (Math.sign(Math.sin(a * 16 + t * 90)) * 0.5 + 0.5) : 0) + (Math.abs(t - 0.78) < 0.02 ? 0.06 : 0),
    }, 1.6);
    // Right hand, overhand grip: the back of the hand lies along the right of the barrel (towards the
    // camera), knuckles on top, three-segment fingers curl over and down the far side, thumb wraps under.
    const R = 0.019;
    sc.sweep([V(0.072, -0.046, 0.046), V(0.05, -0.012, 0.03), V(0.03, 0.022, 0.02)], [0.036, 0.04, 0.041], {
      slot: 0, stops: [[0, b], [1, b]], flat: [0.36, 1], up: V(0, 0, 1),
      mod: (t, a) => 1 + 0.06 * Math.max(0, Math.cos(a)) * Math.sin(t * Math.PI) + (t > 0.85 ? 0.04 * Math.cos(a * 4) : 0), // tendons, knuckle ridge
    }, 1.2);
    const fingerZ = [-0.013, 0.008, 0.028, 0.046];
    const fingerLen = [0.088, 0.096, 0.09, 0.07];
    fingerZ.forEach((z, f) => {
      const len = fingerLen[f], rr = f === 3 ? 0.0078 : 0.0094;
      sc.blob(V(0.027, 0.029, z), 0.009, 0.009, 0.01, 0, b, undefined, 0.4); // knuckle
      const a0 = 0.85, a1 = a0 + len / 0.029;
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8, a = a0 + (a1 - a0) * u, rad = R + 0.009 + 0.01 * Math.max(0, 1 - u * 3);
        pts.push(V(Math.cos(a) * rad, Math.sin(a) * rad, z - u * 0.006 * (f === 0 ? 2 : 1)));
      }
      sc.sweep(pts, [rr * 1.08, rr, rr * 0.92, rr * 0.9, rr * 0.82, rr * 0.8, rr * 0.74], {
        slot: 0, stops: [[0, b], [1, b]], capEnd: true, flat: [1, 0.92],
        mod: (t) => 1 + 0.13 * (Math.exp(-Math.pow((t - 0.49) / 0.035, 2)) + Math.exp(-Math.pow((t - 0.78) / 0.03, 2))), // joints
      }, 0.7);
      const an = a1 - 0.2, nr = R + 0.009 + rr * 0.72;
      sc.blob(V(Math.cos(an) * nr, Math.sin(an) * nr, z - 0.006), 0.0045, 0.0045, 0.0055, 3, b, undefined, 0.3); // nail
    });
    const thumb: Vector3[] = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6, a = -0.75 - u * 1.25, rad = R + 0.011 + 0.012 * (1 - u); thumb.push(V(Math.cos(a) * rad + 0.02 * (1 - u), Math.sin(a) * rad, 0.038 - u * 0.05)); }
    sc.sweep(thumb, [0.014, 0.012, 0.0105, 0.0095, 0.0085], { slot: 0, stops: [[0, b], [1, b]], capEnd: true, mod: (t) => 1 + 0.12 * Math.exp(-Math.pow((t - 0.55) / 0.04, 2)) }, 0.6);
    // wrist, forearm and a jacket cuff running out of frame to the lower right
    sc.sweep([V(0.07, -0.044, 0.045), V(0.09, -0.08, 0.12), V(0.12, -0.13, 0.27)], [0.028, 0.031, 0.036], { slot: 0, stops: [[0, b], [1, b]], flat: [0.8, 1], up: V(0, 0, 1) }, 0.7);
    sc.sweep([V(0.088, -0.074, 0.105), V(0.1, -0.096, 0.15), V(0.13, -0.15, 0.32)], [0.044, 0.046, 0.05], {
      slot: 2, stops: [[0, b], [1, b]], capStart: true, mod: (t, a) => 1 + 0.05 * Math.sin(a * 3 + t * 9) + (t < 0.12 ? 0.06 : 0),
    }, 0.9);
    const skin = surface(level, { color: 0xc8a08a, rough: 0.5, kind: 'skin' });
    const alu = surface(level, { color: 0x2a2c30, rough: 0.35, metal: 0.85 });
    const cloth = surface(level, { color: 0x3a3c34, rough: 0.9, kind: 'cloth' });
    const nail = surface(level, { color: 0xe6cfc4, rough: 0.28, clearcoat: 0.7 });
    this.mats.push(skin, alu, cloth, nail);
    this.mesh = sc.build([skin, alu, cloth, nail]);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.lensMat = new MeshBasicMaterial({ color: new Color(0xfff1d6) });
    this.lens = new Mesh(new CircleGeometry(0.024, 18), this.lensMat);
    this.lens.position.set(0, 0, -0.1505); this.lens.rotation.y = Math.PI;
    this.inner.add(this.mesh, this.lens);
    this.inner.rotation.set(0.06, 0.12, -0.32); // rolled so the back of the hand faces the camera
    this.inner.scale.setScalar(0.5); // half size at half distance: same on screen, but never pokes through walls
    this.group.add(this.inner);
    this.group.position.set(0.085, -0.085, -0.16);
    this.group.renderOrder = 5;
  }

  attachTo(cam: Camera): void { cam.add(this.group); }

  /** @param flash lens output 0..1, @param moving 0..1 walk amount, @param bob step phase */
  update(dt: number, show: boolean, flash: number, yaw: number, pitch: number, moving: number, t: number): void {
    this.dropped += ((show ? 0 : 1) - this.dropped) * Math.min(1, dt * 8);
    this.group.visible = this.dropped < 0.98;
    const dyaw = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw)), dp = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    // lag behind the view a little (weight), spring back
    this.swayX += (-dyaw * 0.6 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (dp * 0.6 - this.swayY) * Math.min(1, dt * 10);
    const bob = Math.sin(t * 9) * 0.006 * moving, bobX = Math.cos(t * 4.5) * 0.008 * moving;
    this.group.position.set(0.085 + (this.swayX * 0.4 + bobX) * 0.5, -0.085 + (-this.dropped * 0.3 + this.swayY * 0.3 + bob + Math.sin(t * 1.3) * 0.002) * 0.5, -0.16);
    this.group.rotation.set(this.swayY * 0.5, this.swayX * 0.8, -this.swayX * 0.3);
    this.lensMat.color.setRGB(1, 0.94, 0.84).multiplyScalar(0.25 + flash * 4);
  }

  /** World position of the lens (the flashlight beam starts here). */
  lensWorld(out: Vector3): Vector3 { return this.lens.getWorldPosition(out); }

  dispose(): void {
    this.group.removeFromParent();
    this.mats.forEach((m) => m.dispose()); this.lensMat.dispose(); this.lens.geometry.dispose();
    if (!this.mesh.geometry.userData.shared) this.mesh.geometry.dispose();
  }
}
