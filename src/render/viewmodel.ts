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
    const sc = new Sculptor(level, 'viewmodel');
    const b = sc.bone('hand', -1, 0, 0, 0);
    // flashlight along -z: tail cap, knurled grip, head, bezel
    sc.sweep([V(0, 0, 0.13), V(0, 0, 0.0), V(0, 0, -0.08), V(0, 0, -0.11), V(0, 0, -0.15)], [0.019, 0.019, 0.019, 0.026, 0.028], {
      slot: 1, stops: [[0, b], [1, b]], capStart: true,
      mod: (t, a) => 1 + (t > 0.15 && t < 0.55 ? 0.05 * (Math.sign(Math.sin(a * 16 + t * 90)) * 0.5 + 0.5) : 0) + (Math.abs(t - 0.78) < 0.02 ? 0.06 : 0),
    }, 1.6);
    // right hand gripping from the side: palm on the right of the barrel, fingers curling under it,
    // thumb resting along the top; knuckle bumps on the back of the hand
    sc.blob(V(0.033, 0.0, 0.035), 0.015, 0.03, 0.044, 0, b, (p, l) => { if (l.x > 0.2) p.x += 0.003 * Math.max(0, Math.cos(l.z * 9)); }, 1);
    for (let f = 0; f < 4; f++) {
      const z = 0.006 + f * 0.021, r = 0.0098 - (f === 3 ? 0.0016 : 0);
      const pts: Vector3[] = [];
      for (let i = 0; i <= 5; i++) { const a = -0.25 - (i / 5) * 2.9; pts.push(V(Math.cos(a) * 0.0295, Math.sin(a) * 0.0295, z - i * 0.0015)); }
      sc.sweep(pts, [r * 1.05, r, r * 0.95, r * 0.9, r * 0.82, r * 0.72], { slot: 0, stops: [[0, b], [1, b]], capEnd: true, mod: (t) => 1 + (Math.abs(t - 0.4) < 0.06 || Math.abs(t - 0.72) < 0.05 ? 0.12 : 0) }, 0.5);
    }
    sc.sweep([V(0.03, 0.022, 0.05), V(0.016, 0.029, 0.02), V(0.004, 0.03, -0.012), V(0.0, 0.028, -0.03)], [0.012, 0.0115, 0.01, 0.0085], { slot: 0, stops: [[0, b], [1, b]], capEnd: true }, 0.5);
    // wrist and sleeve, running back toward the lower right of the screen
    sc.sweep([V(0.034, -0.002, 0.07), V(0.05, -0.03, 0.13), V(0.065, -0.055, 0.19)], [0.026, 0.03, 0.033], { slot: 0, stops: [[0, b], [1, b]] }, 0.6);
    sc.sweep([V(0.052, -0.032, 0.125), V(0.075, -0.07, 0.24), V(0.11, -0.12, 0.42)], [0.042, 0.047, 0.052], { slot: 2, stops: [[0, b], [1, b]], capStart: true, mod: (t, a) => 1 + 0.05 * Math.sin(a * 3 + t * 9) }, 0.9);
    const skin = surface(level, { color: 0xc49a82, rough: 0.55, kind: 'skin' });
    const alu = surface(level, { color: 0x2a2c30, rough: 0.35, metal: 0.85 });
    const cloth = surface(level, { color: 0x3a3c34, rough: 0.9, kind: 'cloth' });
    this.mats.push(skin, alu, cloth);
    this.mesh = sc.build([skin, alu, cloth]);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.lensMat = new MeshBasicMaterial({ color: new Color(0xfff1d6) });
    this.lens = new Mesh(new CircleGeometry(0.024, 18), this.lensMat);
    this.lens.position.set(0, 0, -0.1505); this.lens.rotation.y = Math.PI;
    this.inner.add(this.mesh, this.lens);
    this.inner.rotation.set(0.05, 0.1, -0.15);
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
