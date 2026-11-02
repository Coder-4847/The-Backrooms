/**
 * Test-room props gallery: exercises materials (one pedestal per procedural material), lighting
 * (coloured flickering lights, glowing orb for bloom), wet-floor reflections, fog and collision.
 */
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, SphereGeometry, type Object3D } from 'three';
import { Rng } from '../gen/rng';
import type { Collider } from '../core/collision';
import type { MaterialLibrary } from '../render/materials';
import type { Room } from '../gen/types';
import type { TexKind } from '../gen/textures';

export interface PropSet { group: Group; colliders: Collider[]; update(t: number): void; lights: PointLight[]; dispose(): void }

export async function buildTestProps(room: Room, lib: MaterialLibrary, seed: number, withLights: boolean, shadows: boolean): Promise<PropSet> {
  const rng = new Rng(seed ^ 0xbeef);
  const group = new Group();
  const colliders: Collider[] = [];
  const disposables: { dispose(): void }[] = [];
  const kinds: [TexKind, number][] = [['wallpaper', 0], ['carpet', 0], ['concrete', 0], ['tile', 1], ['metal', 0]];
  const mats = await Promise.all(kinds.map(([k, v]) => lib.propMaterial(k, v)));

  const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, m: Mesh['material'], collide = true): Mesh => {
    const g = new BoxGeometry(w, h, d);
    disposables.push(g);
    const mesh = new Mesh(g, m);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    return mesh;
  };

  // material pedestals along the north wall
  const spacing = Math.min(1.7, (room.w - 4) / (kinds.length - 1));
  const z0 = room.z + 1.6;
  kinds.forEach((_, i) => addBox(1, 1, 1, room.x + 2 + i * spacing, 0, z0, mats[i]));

  // pillars + crates
  const pillar = mats[2];
  for (const fx of [0.3, 0.7]) for (const fz of [0.45, 0.8]) addBox(0.6, room.height, 0.6, room.x + room.w * fx, 0, room.z + room.d * fz, pillar);
  for (let i = 0; i < 4; i++) {
    const s = 0.7 + rng.next() * 0.5;
    addBox(s, s, s, room.x + 1.5 + rng.next() * (room.w - 3), 0, room.z + room.d * 0.55 + rng.next() * (room.d * 0.4 - 1.5), mats[4]);
  }

  // wet floor patch: very low roughness so reflections/specular show up
  const wetG = new PlaneGeometry(3.2, 2.2); disposables.push(wetG);
  const wetM = new MeshStandardMaterial({ color: new Color(0x0c0b08), roughness: 0.03, metalness: 0, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -3 });
  disposables.push(wetM);
  const wet = new Mesh(wetG, wetM);
  wet.rotation.x = -Math.PI / 2; wet.position.set(room.x + room.w * 0.5, 0.008, room.z + room.d * 0.3);
  group.add(wet);

  // glowing orb for bloom, coloured lights for lighting checks
  const orbG = new SphereGeometry(0.16, 24, 16); disposables.push(orbG);
  const orbM = new MeshBasicMaterial({ color: new Color(0xff5a30).multiplyScalar(6) }); disposables.push(orbM);
  const orb = new Mesh(orbG, orbM);
  orb.position.set(room.x + room.w * 0.8, 1.4, room.z + room.d * 0.3);
  group.add(orb);

  const lights: PointLight[] = [];
  if (withLights) {
    const red = new PointLight(0xff3a1a, 8, 9, 2); red.position.copy(orb.position); red.castShadow = false; group.add(red); lights.push(red);
    const blue = new PointLight(0x3a7aff, 6, 9, 2); blue.position.set(room.x + 2.5, 1.2, room.z + room.d - 2.5); group.add(blue); lights.push(blue);
  }

  return {
    group, colliders, lights,
    update(t: number) {
      orb.position.y = 1.4 + Math.sin(t * 1.3) * 0.12;
      if (lights[0]) lights[0].intensity = 6 + Math.sin(t * 23) * Math.sin(t * 7.3) * 4 + 2;
      lights.forEach((l, i) => { if (i === 0) l.position.y = orb.position.y; });
    },
    dispose() { disposables.forEach((d) => d.dispose()); group.removeFromParent(); },
  } as PropSet;
}

export function disposeTree(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh;
    m.geometry?.dispose?.();
  });
}
