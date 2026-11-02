/**
 * LevelScene: the visual + audio wrapper around the headless LevelSim. Builds THREE content from
 * streamed chunks (meshed in workers), light pool, dust, props, waypoints, doors, items and debug
 * overlays. One instance per loaded level; `dispose()` frees everything.
 */
import {
  AmbientLight, Box3, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, FogExp2, Group, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PMREMGenerator, Scene, SpotLight, Vector3, type Material,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LevelSim } from './sim';
import { buildTestProps, type PropSet } from './props';
import { ChunkStreamer } from '../gen/chunks';
import { type ChunkData, type MatKey } from '../gen/mesher';
import { LightPool, flickerAt } from '../render/lights';
import { Dust } from '../render/atmosphere';
import { MaterialLibrary } from '../render/materials';
import { bus } from '../core/events';
import type { Services } from '../core/services';
import type { InputFrame } from '../core/input/logic';
import type { DifficultyId } from '../core/difficulty';
import type { LevelDef, LevelPlan } from '../gen/types';
import type { Surface } from '../audio/sounds';
import type { TierDef } from '../render/quality';

interface ChunkVis { group: Group; lamps: InstancedMesh | null; lampDefs: ChunkData['lights'] }

const LAMP_GEO = new BoxGeometry(1.4, 0.05, 0.55);

export class LevelScene {
  readonly scene = new Scene();
  sim!: LevelSim;
  plan!: LevelPlan;
  prompt: string | null = null;
  flashOn = true;
  onExit: (() => void) | null = null;
  onCheckpoint: ((index: number) => void) | null = null;
  fear = 0;
  private lib!: MaterialLibrary;
  private lights!: LightPool;
  private dust: Dust | null = null;
  private streamer!: ChunkStreamer;
  private chunks = new Map<string, ChunkVis>();
  private props: PropSet | null = null;
  private flash!: SpotLight;
  private flashTarget = new Object3D();
  private overlays = new Map<string, Object3D>();
  private itemMeshes = new Map<string, Mesh>();
  private doorMeshes = new Map<number, Mesh>();
  private wpLeds: MeshBasicMaterial[] = [];
  private extras: { dispose(): void }[] = [];
  private tick = 0;
  private time = 0;
  private humHandles: { stop(f?: number): void }[] = [];
  private tmpM = new Matrix4();
  private tmpC = new Color();
  private fwd = new Vector3();

  constructor(private svc: Services, readonly def: LevelDef, readonly seed: number, readonly difficulty: DifficultyId = 'normal', private tierOverride?: TierDef) {}

  get tier(): TierDef { return this.tierOverride ?? this.svc.tier(); }

  async load(progress: (p: number, label: string) => void = () => {}): Promise<void> {
    const { svc, def } = this;
    const tier = this.tier, st = svc.settings.value;
    progress(0.02, 'Generating layout');
    this.plan = def.generate(this.seed, { difficulty: this.difficulty });
    this.sim = new LevelSim(this.plan, this.difficulty);
    const planId = await svc.pool.setPlan(this.plan);

    progress(0.1, 'Synthesizing materials');
    this.lib = new MaterialLibrary(tier, svc.pool, svc.gfx.maxAnisotropy, def.look, this.seed);
    await this.lib.load((d, t) => progress(0.1 + 0.5 * (d / t), 'Synthesizing materials'));

    const look = def.look;
    this.scene.background = new Color(look.fogColor);
    this.scene.fog = new FogExp2(look.fogColor, look.fogDensity / Math.max(0.5, st.drawDistance));
    this.scene.add(new AmbientLight(look.ambient, look.ambientIntensity));
    if (tier.materials === 'standard') {
      const pm = new PMREMGenerator(svc.gfx.renderer);
      const env = pm.fromScene(new RoomEnvironment(), 0.04);
      this.scene.environment = env.texture;
      this.scene.environmentIntensity = 0.25;
      this.extras.push({ dispose: () => { env.dispose(); pm.dispose(); } });
    }
    const shadowLights = st.shadowQuality === 'off' ? 0 : st.shadowQuality === 'low' ? Math.min(1, tier.shadowLights) : tier.shadowLights;
    this.lights = new LightPool(this.scene, tier.lights, shadowLights, tier.shadowMap);
    this.lights.reduceFlicker = st.reduceFlicker;
    if (tier.dust > 0 && st.dust) { this.dust = new Dust(tier.dust, look.dust); this.dust.addTo(this.scene); }

    // flashlight (spot light parented to the scene, positioned each frame at the camera)
    this.flash = new SpotLight(0xfff1d6, 55, 26, 0.5, 0.55, 1.6);
    this.flash.castShadow = shadowLights > 0;
    this.flash.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    this.flash.shadow.bias = -0.0005;
    this.scene.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;

    progress(0.65, 'Building geometry');
    const radius = tier.drawDistance * st.drawDistance;
    this.streamer = new ChunkStreamer(
      this.plan,
      (cx, cz) => svc.pool.chunk(planId, cx, cz, tier.level),
      { loadRadius: radius, unloadMargin: 14, maxInFlight: 3, maxApplyPerFrame: 2 },
      { onLoad: (c) => this.addChunk(c), onUnload: (k) => this.removeChunk(k) },
    );
    await this.streamer.preload(this.plan.spawn.pos.x, this.plan.spawn.pos.z, Math.min(radius, 30));
    progress(0.85, 'Placing objects');
    await this.buildObjects();
    this.sim.listeners.push((e) => this.onSimEvent(e));
    this.sim.player.onStep = (sprint, crouch) => this.footstep(sprint, crouch);
    this.sim.player.reduceShake = st.reduceShake;
    this.sim.player.holdCrouchToggle = st.holdToggleCrouch === 'toggle';
    this.sim.player.holdSprintToggle = st.holdToggleSprint === 'toggle';
    svc.gfx.applyLook(look);
    this.startAudio();
    progress(1, 'Ready');
    bus.emit('level:loaded', { id: def.id, seed: this.seed });
  }

  private async buildObjects(): Promise<void> {
    const { plan, scene, sim } = this;
    const tier = this.tier;
    // props for the test room live in the spawn room
    if (this.def.id === 'testroom') {
      this.props = await buildTestProps(plan.rooms[plan.spawn.room], this.lib, this.seed, tier.lights >= 3, tier.shadowLights > 0);
      scene.add(this.props.group);
      sim.world.add('props', this.props.colliders);
    }
    const keyMat = new MeshBasicMaterial({ color: new Color(0xffc040).multiplyScalar(3) });
    const lootMat = new MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.4 });
    const box = new BoxGeometry(0.22, 0.22, 0.22);
    this.extras.push(keyMat, lootMat, box);
    for (const it of plan.items) {
      const m = new Mesh(box, it.kind === 'key' ? keyMat : lootMat);
      m.position.set(it.pos.x, 0.6, it.pos.z);
      scene.add(m); this.itemMeshes.set(it.id, m);
    }
    const doorGeo = new BoxGeometry(1, 2.2, 0.16);
    const doorMat = new MeshStandardMaterial({ color: 0x5a1f1a, roughness: 0.6, metalness: 0.3 });
    this.extras.push(doorGeo, doorMat);
    for (const d of sim.doors.values()) {
      const m = new Mesh(doorGeo, doorMat);
      m.scale.x = d.conn.width;
      m.position.set(d.conn.door.x, 1.1, d.conn.door.z);
      if (d.conn.axis === 'z') m.rotation.y = Math.PI / 2;
      scene.add(m); this.doorMeshes.set(d.conn.id, m);
    }
    // waypoints: tripod + camcorder with a blinking red LED
    const legG = new CylinderGeometry(0.015, 0.015, 1.2, 6), bodyG = new BoxGeometry(0.28, 0.18, 0.12), ledG = new BoxGeometry(0.03, 0.03, 0.03);
    const metal = new MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 });
    this.extras.push(legG, bodyG, ledG, metal);
    sim.waypoints.forEach((w, i) => {
      const g = new Group();
      for (let k = 0; k < 3; k++) { const leg = new Mesh(legG, metal); const a = (k / 3) * Math.PI * 2; leg.position.set(Math.cos(a) * 0.18, 0.6, Math.sin(a) * 0.18); leg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); g.add(leg); }
      const body = new Mesh(bodyG, metal); body.position.y = 1.28; g.add(body);
      const led = new MeshBasicMaterial({ color: new Color(0xff2010).multiplyScalar(5) });
      this.wpLeds[i] = led; this.extras.push(led);
      const l = new Mesh(ledG, led); l.position.set(0.1, 1.34, 0.065); g.add(l);
      g.position.set(w.pos.x, 0, w.pos.z);
      scene.add(g);
      const a = this.svc.audio(), s = this.svc.sounds();
      if (a && s) this.humHandles.push(s.beacon(a.spatial(w.pos.x, 1.3, w.pos.z, 'ambience', 0, 0.5)));
    });
    // exit marker
    const exitG = new BoxGeometry(1.5, 2.3, 0.08);
    const exitM = new MeshBasicMaterial({ color: new Color(0x9fe8ff).multiplyScalar(2.5) });
    this.extras.push(exitG, exitM);
    const ex = new Mesh(exitG, exitM);
    ex.position.set(plan.exit.pos.x, 1.15, plan.exit.pos.z);
    scene.add(ex);
  }

  private addChunk(c: ChunkData): void {
    if (this.chunks.has(c.key)) return;
    const group = new Group();
    const shadows = this.tier.shadowLights > 0 && this.svc.settings.value.shadowQuality !== 'off';
    for (const [mk, md] of Object.entries(c.meshes)) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(md.positions, 3));
      g.setAttribute('normal', new BufferAttribute(md.normals, 3));
      g.setAttribute('uv', new BufferAttribute(md.uvs, 2));
      g.setIndex(new BufferAttribute(md.indices, 1));
      g.computeBoundingSphere();
      if (!this.lib.has(mk as MatKey)) continue;
      const mesh = new Mesh(g, this.lib.get(mk as MatKey) as Material);
      mesh.receiveShadow = shadows; mesh.castShadow = shadows && mk.startsWith('wall');
      if (mk === 'decal') mesh.renderOrder = 2;
      group.add(mesh);
    }
    let lamps: InstancedMesh | null = null;
    const defs = c.lights;
    if (defs.length) {
      lamps = new InstancedMesh(LAMP_GEO, this.lib.lamp, defs.length);
      defs.forEach((d, i) => { this.tmpM.makeTranslation(d.x, d.y, d.z); lamps!.setMatrixAt(i, this.tmpM); lamps!.setColorAt(i, this.tmpC.setScalar(d.broken ? 0.02 : 1)); });
      lamps.frustumCulled = false;
      group.add(lamps);
      this.lights.setSources([...this.lights.all, ...defs]);
    }
    this.scene.add(group);
    this.chunks.set(c.key, { group, lamps, lampDefs: defs });
  }

  private removeChunk(key: string): void {
    const v = this.chunks.get(key);
    if (!v) return;
    v.group.traverse((o) => { if ((o as Mesh).isMesh && !(o as InstancedMesh).isInstancedMesh) (o as Mesh).geometry.dispose(); });
    v.lamps?.dispose();
    v.group.removeFromParent();
    this.chunks.delete(key);
    const gone = new Set(v.lampDefs);
    this.lights.setSources(this.lights.all.filter((d) => !gone.has(d)));
  }

  private floorSurface(): Surface {
    const f = this.def.look.floor[0];
    return f === 'carpet' ? 'carpet' : f === 'tile' ? 'tile' : f === 'metal' ? 'metal' : 'concrete';
  }

  private footstep(sprint: boolean, crouch: boolean): void {
    const s = this.svc.sounds(), a = this.svc.audio();
    if (s && a) s.footstep(this.floorSurface(), sprint ? 1.5 : crouch ? 0.35 : 0.9, a.flat('sfx', 0.25));
  }

  private startAudio(): void {
    const a = this.svc.audio(), s = this.svc.sounds();
    if (!a || !s) return;
    this.humHandles.push(s.hum(a.flat('ambience', 0.2), 0.1));
  }

  private onSimEvent(e: Parameters<LevelSim['listeners'][number]>[0]): void {
    const s = this.svc.sounds(), a = this.svc.audio();
    if (e.type === 'pickup') {
      const m = this.itemMeshes.get(e.item.id);
      if (m) { m.removeFromParent(); this.itemMeshes.delete(e.item.id); }
      bus.emit('toast', { text: e.item.kind === 'key' ? `Picked up ${e.item.item}` : `Picked up ${e.item.item.replace('_', ' ')}` });
      s?.click('confirm');
    } else if (e.type === 'unlock') {
      this.doorMeshes.get(e.connection.id)?.removeFromParent();
      this.doorMeshes.delete(e.connection.id);
      bus.emit('toast', { text: 'Door unlocked' });
      if (a && s) s.creak(a.flat('sfx', 0.3));
    } else if (e.type === 'locked') {
      bus.emit('toast', { text: `Locked. Needs ${e.lock}`, kind: 'warn' });
      s?.click('back');
    } else if (e.type === 'checkpoint') {
      this.wpLeds[e.index]?.color.set(0x30ff60).multiplyScalar(4);
      bus.emit('toast', { text: 'Checkpoint set' });
      this.onCheckpoint?.(e.index);
      s?.click('confirm');
    } else if (e.type === 'exit') {
      this.onExit?.();
    }
  }

  /** One fixed simulation step. */
  update(dt: number, f: InputFrame): void {
    this.tick++;
    if (f.pressed.Flashlight) { this.flashOn = !this.flashOn; this.svc.sounds()?.click('tick'); }
    this.sim.step(f, dt);
    if (this.tick % 6 === 0) this.prompt = this.sim.interactables()[0]?.label ?? null;
  }

  /** Per rendered frame. */
  render(alpha: number, dt: number): void {
    const { svc } = this;
    const gfx = svc.gfx, cam = gfx.camera;
    this.time += dt;
    const p = this.sim.player;
    p.apply(cam, alpha, this.fear, this.time);
    cam.getWorldDirection(this.fwd);
    this.streamer.update(cam.position.x, cam.position.z);
    this.lights.update(cam.position.x, cam.position.y, cam.position.z, this.time, dt);
    this.dust?.update(this.time, cam.position.x, cam.position.z);
    this.props?.update(this.time);
    // flashlight follows the camera with a little lag-free offset
    this.flash.visible = this.flashOn;
    this.flash.position.copy(cam.position).addScaledVector(this.fwd, 0.1);
    this.flashTarget.position.copy(cam.position).addScaledVector(this.fwd, 6);
    // flicker lamp emissive per instance (only flickering ones)
    for (const v of this.chunks.values()) {
      if (!v.lamps) continue;
      let dirty = false;
      v.lampDefs.forEach((d, i) => { if (d.flicker) { v.lamps!.setColorAt(i, this.tmpC.setScalar(Math.max(0.03, flickerAt(d, this.time, svc.settings.value.reduceFlicker)))); dirty = true; } });
      if (dirty && v.lamps.instanceColor) v.lamps.instanceColor.needsUpdate = true;
    }
    // bobbing items, blinking waypoint LEDs
    for (const m of this.itemMeshes.values()) { m.position.y = 0.6 + Math.sin(this.time * 2 + m.position.x) * 0.05; m.rotation.y += dt; }
    this.wpLeds.forEach((l, i) => { if (!this.sim.activatedWaypoints.has(i)) l.color.set(0xff2010).multiplyScalar(Math.sin(this.time * 5) > 0 ? 5 : 0.1); });
    const a = svc.audio();
    if (a?.running) a.setListener(cam.position.x, cam.position.y, cam.position.z, this.fwd.x, this.fwd.z);
    gfx.fear = this.fear;
    svc.gfx.setScene(this.scene);
    gfx.render(dt);
  }

  stats() {
    return { chunksLoaded: this.streamer.loaded.size, chunksTotal: this.streamer.chunkCount, chunkBuildAvgMs: this.streamer.buildMs.count ? this.streamer.buildMs.total / this.streamer.buildMs.count : 0, chunkBuildMaxMs: this.streamer.buildMs.max, colliders: this.sim.world.count, rooms: this.plan.rooms.length };
  }

  setOverlay(name: string, on: boolean): void {
    const existing = this.overlays.get(name);
    if (existing) { existing.removeFromParent(); this.overlays.delete(name); }
    if (!on) return;
    const pts: number[] = [];
    let color = 0x00ffff;
    const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => pts.push(x0, y0, z0, x1, y1, z1);
    const { plan } = this;
    if (name === 'nav') { color = 0x30e0ff; for (const e of plan.nav.edges) { const a = plan.nav.nodes[e.a].pos, b = plan.nav.nodes[e.b].pos; line(a.x, 0.3, a.z, b.x, 0.3, b.z); } }
    else if (name === 'rooms') {
      color = 0xff40d0;
      for (const c of plan.connections) { const a = plan.rooms[c.a], b = plan.rooms[c.b]; line(a.x + a.w / 2, 0.6, a.z + a.d / 2, b.x + b.w / 2, 0.6, b.z + b.d / 2); }
    } else if (name === 'path') {
      color = 0xffe040;
      for (let i = 0; i + 1 < plan.criticalPath.length; i++) { const a = plan.rooms[plan.criticalPath[i]], b = plan.rooms[plan.criticalPath[i + 1]]; line(a.x + a.w / 2, 0.9, a.z + a.d / 2, b.x + b.w / 2, 0.9, b.z + b.d / 2); }
    } else if (name === 'chunks') {
      color = 0x40ff60;
      for (const k of this.streamer.allKeys()) { const b = this.streamer.bounds(k)!; const h = 3; const box = new Box3(new Vector3(b.x0, 0, b.z0), new Vector3(b.x1, h, b.z1)); const [x0, y0, z0, x1, y1, z1] = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]; line(x0, y1, z0, x1, y1, z0); line(x1, y1, z0, x1, y1, z1); line(x1, y1, z1, x0, y1, z1); line(x0, y1, z1, x0, y1, z0); line(x0, y0, z0, x0, y1, z0); line(x1, y0, z0, x1, y1, z0); line(x1, y0, z1, x1, y1, z1); line(x0, y0, z1, x0, y1, z1); }
    } else return;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const m = new LineBasicMaterial({ color, depthTest: false, transparent: true });
    const ls = new LineSegments(g, m);
    ls.renderOrder = 999; ls.frustumCulled = false;
    this.scene.add(ls); this.overlays.set(name, ls);
  }

  teleport(x: number, z: number): void { this.sim.player.place(x, z, this.sim.player.yaw); }

  dispose(): void {
    for (const h of this.humHandles) h.stop(0.3);
    for (const k of [...this.chunks.keys()]) this.removeChunk(k);
    this.props?.dispose();
    this.lights.dispose(); this.dust?.dispose(); this.lib.dispose();
    this.extras.forEach((e) => e.dispose());
    this.overlays.forEach((o) => o.removeFromParent());
    this.scene.clear();
  }
}
