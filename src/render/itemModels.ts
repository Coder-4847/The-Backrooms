/**
 * Item models: small procedural props for every hotbar item, built from primitives around a grip axis
 * (-z forward, ~2 cm grip radius at the origin) at real-world size. Used by the first-person hand
 * (viewmodel) and for pickups lying in the world, so what you see on the floor is what you will hold.
 * Materials scale with the quality tier (Lambert on Low/Potato, Standard above).
 */
import {
  BoxGeometry, CircleGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial,
  SphereGeometry, TorusGeometry, type BufferGeometry, type Material,
} from 'three';

export class ItemModelKit {
  readonly mats: Material[] = [];
  readonly geos: BufferGeometry[] = [];
  readonly glowMats: { mat: MeshBasicMaterial; base: Color }[] = [];
  constructor(readonly level: number, readonly lensMat: MeshBasicMaterial = new MeshBasicMaterial({ color: 0xfff1d6 })) { this.mats.push(lensMat); }


  private mat(color: number, rough = 0.6, metal = 0, emissive = 0): Material {
    const m = this.level <= 1
      ? new MeshLambertMaterial({ color, emissive: new Color(emissive) })
      : new MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive: new Color(emissive) });
    this.mats.push(m);
    return m;
  }
  private glow(color: number, k: number): MeshBasicMaterial {
    const base = new Color(color).multiplyScalar(k);
    const m = new MeshBasicMaterial({ color: base.clone() });
    this.mats.push(m); this.glowMats.push({ mat: m, base });
    return m;
  }
  private seg(n: number): number { return this.level >= 3 ? n : Math.max(6, Math.round(n * 0.6)); }
  /** Cylinder along -z (the grip axis), from z0 (back) to z1 (front). */
  private tube(g: Group, r0: number, r1: number, z0: number, z1: number, m: Material, x = 0, y = 0, open = false): Mesh {
    const geo = new CylinderGeometry(r1, r0, Math.abs(z1 - z0), this.seg(18), 1, open);
    geo.rotateX(-Math.PI / 2); // +y -> -z
    this.geos.push(geo);
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, (z0 + z1) / 2);
    g.add(mesh);
    return mesh;
  }
  private box(g: Group, w: number, h: number, d: number, m: Material, x: number, y: number, z: number): Mesh {
    const geo = new BoxGeometry(w, h, d); this.geos.push(geo);
    const mesh = new Mesh(geo, m); mesh.position.set(x, y, z); g.add(mesh);
    return mesh;
  }

  build(id: string): Group {
    const g = new Group();
    const dark = (c: number) => this.mat(c, 0.5, 0.2);
    switch (id) {
      case 'flashlight': {
        const alu = this.mat(0x2a2c30, 0.35, 0.85), rub = this.mat(0x141414, 0.9), chrome = this.mat(0xb8bcc4, 0.2, 1);
        this.tube(g, 0.0195, 0.0195, 0.13, 0.0, alu);
        for (let i = 0; i < 6; i++) this.tube(g, 0.0205, 0.0205, 0.09 - i * 0.014, 0.084 - i * 0.014, rub); // knurled grip rings
        this.tube(g, 0.0195, 0.027, 0.0, -0.09, alu); // flared head
        this.tube(g, 0.029, 0.029, -0.09, -0.15, alu);
        this.tube(g, 0.03, 0.03, -0.142, -0.152, chrome); // bezel
        this.box(g, 0.01, 0.006, 0.016, rub, 0, 0.021, 0.05); // switch
        const lens = new Mesh(new CircleGeometry(0.025, this.seg(20)), this.lensMat);
        this.geos.push(lens.geometry);
        lens.position.set(0, 0, -0.1525); lens.rotation.y = Math.PI; lens.name = 'lens';
        g.add(lens);
        break;
      }
      case 'camcorder': {
        const body = dark(0x222428), trim = this.mat(0x55585e, 0.4, 0.6), glass = this.mat(0x0a0c12, 0.05, 0.5);
        this.tube(g, 0.019, 0.019, 0.05, -0.06, dark(0x111111)); // hand strap / grip
        this.box(g, 0.06, 0.06, 0.15, body, 0.006, 0.05, -0.02);
        this.tube(g, 0.024, 0.026, -0.095, -0.13, trim, 0.006, 0.05);
        this.tube(g, 0.02, 0.02, -0.13, -0.132, glass, 0.006, 0.05);
        this.box(g, 0.006, 0.042, 0.06, this.glow(0x6fa0c0, 0.6), -0.028, 0.05, 0.01); // flip-out screen
        this.box(g, 0.008, 0.008, 0.008, this.glow(0xff2010, 3), 0.03, 0.084, -0.08); // REC led
        break;
      }
      case 'battery': {
        this.tube(g, 0.016, 0.016, 0.03, -0.03, this.mat(0x1c3a1c, 0.4, 0.3));
        this.tube(g, 0.0162, 0.0162, -0.03, -0.045, this.mat(0xc08a30, 0.3, 0.9));
        this.tube(g, 0.006, 0.006, -0.045, -0.05, this.mat(0xc0c4c8, 0.3, 1));
        break;
      }
      case 'almond_water': case 'bottled_water': case 'dirty_water': case 'bottle': case 'distraction': {
        const liquid = id === 'almond_water' ? 0xe8e0c8 : id === 'dirty_water' ? 0x6a5a30 : id === 'bottle' ? 0x2a4a2a : 0x9fc8e0;
        const glass = this.level <= 1 ? this.mat(liquid) : new MeshStandardMaterial({ color: liquid, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82 });
        if (!this.mats.includes(glass)) this.mats.push(glass);
        this.tube(g, 0.024, 0.024, 0.06, -0.06, glass);
        this.tube(g, 0.024, 0.01, -0.06, -0.085, glass);
        this.tube(g, 0.01, 0.01, -0.085, -0.1, glass);
        this.tube(g, 0.0115, 0.0115, -0.1, -0.112, this.mat(id === 'almond_water' ? 0xd0c8b0 : 0x2050a0, 0.5));
        if (id === 'almond_water' || id === 'bottled_water') this.tube(g, 0.0245, 0.0245, 0.02, -0.03, this.mat(id === 'almond_water' ? 0xf0e8d0 : 0x3a78c0, 0.8), 0, 0, true); // label
        if (id === 'distraction') for (let i = 0; i < 3; i++) this.box(g, 0.008, 0.008, 0.008, this.mat(0x806040), 0.006 * i, -0.01, 0.03 - i * 0.02); // rattling pebbles
        break;
      }
      case 'can': case 'canned_food': case 'tripline': {
        const tin = this.mat(0xa8acb0, 0.35, 0.9);
        this.tube(g, 0.026, 0.026, 0.035, -0.04, tin);
        if (id !== 'can') this.tube(g, 0.0262, 0.0262, 0.025, -0.03, this.mat(id === 'canned_food' ? 0xb03020 : 0x50603a, 0.7), 0, 0, true);
        if (id === 'tripline') this.tube(g, 0.002, 0.002, -0.04, -0.14, this.mat(0xd0c8a0, 0.9), 0.02, -0.02);
        break;
      }
      case 'cracker': {
        this.box(g, 0.05, 0.03, 0.09, this.mat(0xc89a40, 0.85), 0, 0.005, -0.01);
        this.box(g, 0.051, 0.012, 0.03, this.mat(0xb02020, 0.8), 0, 0.012, -0.01);
        break;
      }
      case 'bandage': {
        const roll = new TorusGeometry(0.022, 0.011, this.seg(10), this.seg(20)); this.geos.push(roll);
        const m = new Mesh(roll, this.mat(0xeee8dc, 0.95)); m.position.set(0, 0.01, -0.01); g.add(m);
        break;
      }
      case 'glowstick': {
        this.tube(g, 0.008, 0.008, 0.05, -0.13, this.glow(0x60ff70, 2.2));
        this.tube(g, 0.0095, 0.0095, 0.05, 0.04, this.mat(0x202020));
        break;
      }
      case 'flare': {
        this.tube(g, 0.016, 0.016, 0.06, -0.09, this.mat(0xb01818, 0.6));
        this.tube(g, 0.017, 0.017, -0.09, -0.11, this.mat(0x202020, 0.7));
        break;
      }
      case 'crowbar': {
        const steel = this.mat(0x30343a, 0.45, 0.8), red = this.mat(0x8a1a14, 0.5, 0.4);
        this.tube(g, 0.012, 0.012, 0.09, -0.24, red);
        const hook = new TorusGeometry(0.035, 0.011, this.seg(8), this.seg(16), Math.PI); this.geos.push(hook);
        const hm = new Mesh(hook, steel); hm.rotation.y = Math.PI / 2; hm.position.set(0, 0.035, -0.24); g.add(hm);
        break;
      }
      case 'radio': {
        this.box(g, 0.05, 0.1, 0.035, dark(0x2a2a24), 0.0, 0.035, -0.02);
        this.tube(g, 0.003, 0.003, 0, -0.12, this.mat(0x101010), 0.012, 0.08).rotation.x = -1.2;
        this.box(g, 0.002, 0.02, 0.03, this.glow(0xffa040, 1.4), -0.026, 0.06, -0.02);
        break;
      }
      case 'compass': {
        this.tube(g, 0.028, 0.028, 0.006, -0.006, this.mat(0xa08040, 0.3, 0.9));
        const face = new CircleGeometry(0.024, this.seg(20)); this.geos.push(face);
        const fm = new Mesh(face, this.mat(0xe8e0c8, 0.6)); fm.position.set(0, 0, -0.0065); fm.rotation.y = Math.PI; g.add(fm);
        this.box(g, 0.003, 0.03, 0.001, this.mat(0xc02020), 0, 0, -0.007);
        g.rotation.x = -1.1;
        break;
      }
      case 'grapple': {
        this.tube(g, 0.01, 0.01, 0.06, -0.12, this.mat(0x606468, 0.4, 0.8));
        for (let i = 0; i < 3; i++) { const t = new TorusGeometry(0.03, 0.006, this.seg(6), this.seg(12), Math.PI * 0.7); this.geos.push(t); const m = new Mesh(t, this.mat(0x606468, 0.4, 0.8)); m.position.z = -0.12; m.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI * 2); g.add(m); }
        break;
      }
      case 'rope': {
        const t = new TorusGeometry(0.032, 0.012, this.seg(8), this.seg(18)); this.geos.push(t);
        const m = new Mesh(t, this.mat(0x8a7040, 0.95)); m.position.set(0, 0.01, -0.01); g.add(m);
        break;
      }
      case 'cooked_meal': {
        this.tube(g, 0.03, 0.026, 0.03, -0.03, this.mat(0x908070, 0.6, 0.4));
        const s = new SphereGeometry(0.026, this.seg(10), this.seg(8)); this.geos.push(s);
        const m = new Mesh(s, this.mat(0x8a5030, 0.8)); m.position.set(0, 0.012, 0); m.scale.set(1, 0.5, 1); g.add(m);
        break;
      }
      case 'key1': case 'key2': case 'key3': {
        const brass = this.mat(id === 'key2' ? 0x9aa0a8 : id === 'key3' ? 0x9ab8c8 : 0xc8a040, 0.3, 1, 0x302000);
        const ring = new TorusGeometry(0.016, 0.005, this.seg(8), this.seg(16)); this.geos.push(ring);
        const rm = new Mesh(ring, brass); rm.position.z = 0.02; g.add(rm);
        this.tube(g, 0.0035, 0.0035, 0.004, -0.06, brass);
        this.box(g, 0.003, 0.012, 0.006, brass, 0, -0.007, -0.05); this.box(g, 0.003, 0.009, 0.005, brass, 0, -0.006, -0.038);
        break;
      }
      case 'fuse1': case 'fuse2': case 'fuse3': {
        const band = id === 'fuse1' ? 0xb02020 : id === 'fuse2' ? 0x2040b0 : 0xe0e0e0;
        this.tube(g, 0.014, 0.014, 0.03, -0.03, this.mat(0xe8e0d0, 0.5));
        this.tube(g, 0.0145, 0.0145, 0.008, -0.008, this.mat(band, 0.6, 0, band));
        this.tube(g, 0.012, 0.012, 0.042, 0.03, this.mat(0xb0b4b8, 0.3, 1));
        this.tube(g, 0.012, 0.012, -0.03, -0.042, this.mat(0xb0b4b8, 0.3, 1));
        break;
      }
      default: {
        // papers, passes, rags, anchors...: a small generic object in the palm
        this.box(g, 0.045, 0.012, 0.06, this.mat(id.startsWith('anchor') ? 0x8a7a50 : 0xd8d0b8, 0.85), 0, 0.006, -0.02);
      }
    }
    return g;
  }

  /** Pulse emissive parts (glowsticks, screens, LEDs). */
  pulse(t: number): void { const k = 0.85 + 0.15 * Math.sin(t * 3); for (const g of this.glowMats) g.mat.color.copy(g.base).multiplyScalar(k); }

  dispose(): void { this.mats.forEach((m) => m.dispose()); this.geos.forEach((g) => g.dispose()); }
}
