/**
 * First-person viewmodel: the player's right hand holding whatever is selected on the hotbar.
 * The hand is sculpted with the same toolkit as the entities (sleeve, wrist, palm, fingers curled round a
 * ~2 cm grip). Each held item is a small prop built around that grip axis (-z is forward), so switching
 * items lowers the hand, swaps the prop and raises it again. Parented to the camera; sways with look and
 * bobs with steps. Props are built lazily (first time an item is held) and cached for the level.
 */
import { Color, Group, Mesh, MeshBasicMaterial, Vector3, type Camera, type Material, type Object3D } from 'three';
import { Sculptor, surface } from '../entities/sculpt';
import { ItemModelKit } from './itemModels';

const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Grip radius the fingers curl around (metres, before the 0.5 viewmodel scale). */
const R = 0.019;

export class Viewmodel {
  readonly group = new Group();
  private inner = new Group();
  private hand: Mesh;
  private mats: Material[] = [];
  private props = new Map<string, Group>();
  private lensMat: MeshBasicMaterial;
  private kit: ItemModelKit;
  private lens: Mesh | null = null;
  private lastYaw = 0; private lastPitch = 0;
  private swayX = 0; private swayY = 0;
  private dropped = 1;
  /** Item currently in the hand, and the one the player has selected (swapped at the bottom of the lower). */
  private current: string | null = null;
  private want: string | null = null;
  private useKick = 0;

  constructor(level: number) {
    const sc = new Sculptor(level, 'vmhand');
    const b = sc.bone('hand', -1, 0, 0, 0);
    // Right hand, overhand grip: the back of the hand lies along the right of the grip (towards the
    // camera), knuckles on top, three-segment fingers curl over and down the far side, thumb wraps under.
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
      // fingernail: a thin shell lying on the fingertip (it used to be a fat pale ball)
      const an = a1 - 0.16, nr = R + 0.009 + rr * 0.62;
      sc.blob(V(Math.cos(an) * nr, Math.sin(an) * nr, z - 0.006), 0.0036, 0.0016, 0.0042, 3, b, undefined, 0.3);
    });
    const thumb: Vector3[] = [];
    for (let i = 0; i <= 6; i++) { const u = i / 6, a = -0.75 - u * 1.25, rad = R + 0.011 + 0.012 * (1 - u); thumb.push(V(Math.cos(a) * rad + 0.02 * (1 - u), Math.sin(a) * rad, 0.038 - u * 0.05)); }
    sc.sweep(thumb, [0.014, 0.012, 0.0105, 0.0095, 0.0085], { slot: 0, stops: [[0, b], [1, b]], capEnd: true, mod: (t) => 1 + 0.12 * Math.exp(-Math.pow((t - 0.55) / 0.04, 2)) }, 0.6);
    // wrist, forearm and a jacket cuff running out of frame to the lower right
    sc.sweep([V(0.07, -0.044, 0.045), V(0.09, -0.08, 0.12), V(0.12, -0.13, 0.27)], [0.028, 0.031, 0.036], { slot: 0, stops: [[0, b], [1, b]], flat: [0.8, 1], up: V(0, 0, 1) }, 0.7);
    sc.sweep([V(0.088, -0.074, 0.105), V(0.1, -0.096, 0.15), V(0.13, -0.15, 0.32)], [0.044, 0.046, 0.05], {
      slot: 2, stops: [[0, b], [1, b]], capStart: true, mod: (t, a) => 1 + 0.05 * Math.sin(a * 3 + t * 9) + (t < 0.12 ? 0.06 : 0),
    }, 0.9);
    const skin = surface(level, { color: 0xc49a84, rough: 0.55, kind: 'skin' });
    const cloth = surface(level, { color: 0x3a3c34, rough: 0.9, kind: 'cloth' });
    const nail = surface(level, { color: 0xc9a598, rough: 0.35, clearcoat: 0.5 });
    this.mats.push(skin, cloth, nail);
    this.hand = sc.build([skin, skin, cloth, nail]);
    this.hand.frustumCulled = false;
    this.hand.castShadow = false;
    this.lensMat = new MeshBasicMaterial({ color: new Color(0xfff1d6) });
    this.kit = new ItemModelKit(level, this.lensMat);
    this.inner.add(this.hand);
    this.inner.rotation.set(0.06, 0.12, -0.32); // rolled so the back of the hand faces the camera
    this.inner.scale.setScalar(0.5); // half size at half distance: same on screen, but never pokes through walls
    this.group.add(this.inner);
    this.group.position.set(0.085, -0.085, -0.16);
    this.group.renderOrder = 5;
  }

  attachTo(cam: Camera): void { cam.add(this.group); }

  /** Item id currently drawn in the hand (null while empty-handed). */
  get holding(): string | null { return this.dropped < 0.98 ? this.current : null; }

  /** A small recoil / lift when the held item is used. */
  kick(): void { this.useKick = 1; }

  private prop(id: string): Group {
    let g = this.props.get(id);
    if (!g) {
      g = this.kit.build(id);
      g.traverse((o: Object3D) => { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 5; });
      if (id === 'flashlight') this.lens = g.getObjectByName('lens') as Mesh;
      g.visible = false; this.inner.add(g); this.props.set(id, g);
    }
    return g;
  }

  /**
   * @param item the selected hotbar item (null = empty hand), @param flash lens output 0..1,
   * @param moving 0..1 walk amount, @param t time
   */
  update(dt: number, item: string | null, flash: number, yaw: number, pitch: number, moving: number, t: number): void {
    this.want = item;
    // switching: lower fully, swap the prop at the bottom, raise again
    const swapping = this.want !== this.current;
    if (swapping && this.dropped > 0.9) {
      if (this.current) this.prop(this.current).visible = false;
      this.current = this.want;
      if (this.current) this.prop(this.current).visible = true;
    }
    const target = this.want !== this.current || !this.current ? 1 : 0;
    this.dropped += (target - this.dropped) * Math.min(1, dt * (target ? 14 : 9));
    this.group.visible = this.dropped < 0.98;
    const dyaw = Math.atan2(Math.sin(yaw - this.lastYaw), Math.cos(yaw - this.lastYaw)), dp = pitch - this.lastPitch;
    this.lastYaw = yaw; this.lastPitch = pitch;
    // lag behind the view a little (weight), spring back
    this.swayX += (-dyaw * 0.6 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (dp * 0.6 - this.swayY) * Math.min(1, dt * 10);
    this.useKick = Math.max(0, this.useKick - dt * 3.5);
    const kick = Math.sin(this.useKick * Math.PI) * 0.05;
    const bob = Math.sin(t * 9) * 0.006 * moving, bobX = Math.cos(t * 4.5) * 0.008 * moving;
    this.group.position.set(0.085 + (this.swayX * 0.4 + bobX) * 0.5, -0.085 + (-this.dropped * 0.3 + this.swayY * 0.3 + bob + kick + Math.sin(t * 1.3) * 0.002) * 0.5, -0.16);
    this.group.rotation.set(this.swayY * 0.5 + kick * 2, this.swayX * 0.8, -this.swayX * 0.3);
    this.lensMat.color.setRGB(1, 0.94, 0.84).multiplyScalar(0.25 + flash * 4);
    this.kit.pulse(t);
  }

  /** World position of the flashlight lens (the beam starts here), or null when the flashlight is not in hand. */
  lensWorld(out: Vector3): Vector3 | null {
    if (this.holding !== 'flashlight' || !this.lens) return null;
    return this.lens.getWorldPosition(out);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mats.forEach((m) => m.dispose());
    this.kit.dispose();
    if (!this.hand.geometry.userData.shared) this.hand.geometry.dispose();
  }
}
