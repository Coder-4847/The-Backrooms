/**
 * LevelScene: the visual + audio wrapper around the headless LevelSim. Builds THREE content from
 * streamed chunks (meshed in workers), light pool, dust, props, waypoints, doors, items and debug
 * overlays. One instance per loaded level; `dispose()` frees everything.
 */
import {
  AmbientLight, Box3, PointLight, TorusGeometry, PlaneGeometry, CanvasTexture, SRGBColorSpace, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, FogExp2, Group, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PMREMGenerator, Scene, SpotLight, Vector3, CubeCamera, WebGLCubeRenderTarget, HalfFloatType, type Material,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LevelSim, type SimEvent, type SimOptions, type SimSnapshot } from './sim';
import { EntityVisuals } from './entityVisuals';
import { buildBody, buildStick, type Body } from '../entities/body';
import { planClues, type Clue } from '../gen/clues';
import { bearingWords, hubObjective, levelObjective, type Objective } from './objective';
import { Jumpscare } from './scare';
import { buildClues, loadHandFont, type ClueVisuals } from './clueArt';
import { SceneFx } from './fx';
import { buildHubObjects, hubInteractables, type HubState } from './hubObjects';
import { buildTestProps, type PropSet } from './props';
import { ChunkStreamer } from '../gen/chunks';
import { type ChunkData, type MatKey, type LightDef, LAMP_W, LAMP_D, levelLights } from '../gen/mesher';
import { bakeLighting } from '../render/bake';
import { createSurfaceShared, patchSurface, setBake, type SurfaceShared } from '../render/surface';
import { LightPool, flickerAt } from '../render/lights';
import { Dust } from '../render/atmosphere';
import { MaterialLibrary } from '../render/materials';
import { Viewmodel } from '../render/viewmodel';
import { bus } from '../core/events';
import type { Services } from '../core/services';
import type { InputFrame } from '../core/input/logic';
import type { DifficultyId } from '../core/difficulty';
import type { LevelDef, LevelPlan } from '../gen/types';
import type { Surface } from '../audio/sounds';
import type { TierDef } from '../render/quality';
import { itemDef } from '../systems/items';

interface ChunkVis { group: Group; lamps: InstancedMesh | null; lampDefs: ChunkData['lights'] }

const LAMP_GEO = new BoxGeometry(LAMP_W, 0.022, LAMP_D);
/** Flashlight intensity (candela); ceiling lamps are 9. */
const FLASH_CD = 26;

/** Flashlight cookie: hot centre, a soft reflector ring, dark rings and slight lens grime. */
function flashCookie(): CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 126);
  for (const [o, v] of [[0, 255], [0.12, 250], [0.22, 205], [0.3, 150], [0.38, 170], [0.46, 120], [0.6, 80], [0.72, 58], [0.86, 26], [1, 0]] as [number, number][]) grad.addColorStop(o, `rgb(${v},${Math.round(v * 0.97)},${Math.round(v * 0.9)})`);
  g.fillStyle = grad; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40; i++) { const a = (i * 2.399) % (Math.PI * 2), r = 20 + ((i * 37) % 90); g.fillStyle = `rgba(150,150,150,${0.06 + (i % 5) * 0.02})`; g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 6 + (i % 7) * 3, 0, Math.PI * 2); g.fill(); }
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}
/** Lamp fixture centre relative to its LightDef (defs sit 6 cm under the ceiling; panels hang just under the T-bars). */
const LAMP_DY = 0.06 - 0.011 - 0.016;

export class LevelScene {
  readonly scene = new Scene();
  sim!: LevelSim;
  plan!: LevelPlan;
  prompt: string | null = null;
  onExit: (() => void) | null = null;
  onCheckpoint: ((index: number) => void) | null = null;
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
  private propMeshes: InstancedMesh[] = [];
  private waterMeshes: Mesh[] = [];
  private portraitMeshes: { mesh: Mesh; yaw: number; wrong: boolean }[] = [];
  private fogBase = { color: new Color(), density: 0 };
  private valveMeshes = new Map<string, Mesh>();
  private wpLeds: MeshBasicMaterial[] = [];
  private extras: { dispose(): void }[] = [];
  private tick = 0;
  private time = 0;
  private humHandles: { stop(f?: number): void }[] = [];
  private tmpM = new Matrix4();
  private tmpC = new Color();
  private fwd = new Vector3();

  /** Optional hooks set by the Game. */
  onDeath: (() => void) | null = null;
  onNote: ((id: string) => void) | null = null;
  onCustom: ((ref: unknown) => void) | null = null;
  readonly fearBox = { v: 0 };
  private ev!: EntityVisuals;
  private fx!: SceneFx;
  private ambient!: AmbientLight;
  private ambientBase = 0.4;
  private dyn: PointLight[] = [];
  private hubObj: ReturnType<typeof buildHubObjects> | null = null;
  private surface: SurfaceShared = createSurfaceShared();
  private bakeLamps: LightDef[] = [];
  private viewmodel: Viewmodel | null = null;
  private scare!: Jumpscare;
  private dreadBed: { stop(f?: number): void; set(v: number): void } | null = null;
  private lampBase = new Color();
  private darkDirect = 1; private darkBounce = 0.5;
  private warm: Body[] = [];
  /** What to do next (HUD line) and a bearing hint that only appears once the player has stalled for a while. */
  objective: Objective | null = null;
  objectiveHint: string | null = null;
  private objBestDist = 99; private objKey = ''; private objProgressAt = 0; private objLoot = 0;
  private clues: Clue[] = [];
  private clueVis: ClueVisuals | null = null;

  constructor(private svc: Services, readonly def: LevelDef, readonly seed: number, readonly difficulty: DifficultyId = 'normal', private tierOverride?: TierDef,
    private opts: { hub?: HubState; sim?: SimOptions; snapshot?: SimSnapshot; genParams?: Record<string, unknown> } = {}) {}

  get tier(): TierDef { return this.tierOverride ?? this.svc.tier(); }

  async load(progress: (p: number, label: string) => void = () => {}): Promise<void> {
    const { svc, def } = this;
    const tier = this.tier, st = svc.settings.value;
    progress(0.02, 'Generating layout');
    this.plan = def.generate(this.seed, { difficulty: this.difficulty, ...this.opts.genParams });
    this.sim = new LevelSim(this.plan, this.difficulty, { seed: this.seed, intensity: def.intensity, scare: st.scare, hungerEnabled: st.hunger, ...this.opts.sim });
    if (this.opts.snapshot) this.sim.applySnapshot(this.opts.snapshot);
    if (this.plan.hub) { this.sim.alwaysSafe = true; this.sim.extra = () => hubInteractables(this.plan, this.opts.hub!); }
    const planId = await svc.pool.setPlan(this.plan);

    progress(0.1, 'Synthesizing materials');
    // static lighting bake: every ceiling lamp + first bounce + room-box AO (a few ms)
    this.bakeLamps = levelLights(this.plan);
    setBake(this.surface, bakeLighting(this.plan, this.bakeLamps));
    this.surface.uBakeTint.value.setHex(0xfff2c0);
    // horror grade, every level: less fill light, deeper shadows, and the lamps do the work
    this.darkBounce = (tier.materials === 'standard' ? 0.5 : 0.6) * 0.7;
    this.surface.uBakeBounce.value = this.darkBounce;
    this.surface.uBakeDirect.value = this.darkDirect = 0.7;
    this.surface.uPoolR.value = 0;
    this.extras.push({ dispose: () => { this.surface.uBakeLight.value?.dispose(); this.surface.uBakeGeo.value?.dispose(); } });
    this.lib = new MaterialLibrary(tier, svc.pool, svc.gfx.maxAnisotropy, def.look, this.seed, this.surface);
    await this.lib.load((d, t) => progress(0.1 + 0.5 * (d / t), 'Synthesizing materials'));

    const look = def.look;
    const fogCol = new Color(look.fogColor).multiplyScalar(0.55); // horror grade: the distance is dark, not bright haze
    this.scene.background = fogCol.clone();
    this.scene.fog = new FogExp2(fogCol.clone(), look.fogDensity / Math.max(0.5, st.drawDistance));
    this.fogBase = { color: fogCol.clone(), density: (look.fogDensity * 1.5) / Math.max(0.5, st.drawDistance) };
    this.ambientBase = look.ambientIntensity * 0.3; // horror grade: darker than the bake alone would be
    this.ambient = new AmbientLight(look.ambient, this.ambientBase);
    this.scene.add(this.ambient);
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
    this.flash = new SpotLight(0xfff1d6, FLASH_CD, 26, 0.5, 0.55, 1.6);
    this.flash.castShadow = shadowLights > 0;
    if (this.flash.castShadow) { this.flash.map = flashCookie(); this.extras.push(this.flash.map); } // projected beam pattern (needs the shadow map)
    this.flash.shadow.camera.near = 0.1;
    this.flash.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
    this.flash.shadow.bias = -0.0005;
    this.scene.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;
    for (const col of [0xff6a30, 0x70ff90]) { const l = new PointLight(col, 0, 12, 2); this.scene.add(l); this.dyn.push(l); }
    this.ev = new EntityVisuals(this.scene, tier.level);
    this.lampBase.set(look.lampColor).multiplyScalar(2.6);
    this.viewmodel = new Viewmodel(tier.level);
    this.scene.add(svc.gfx.camera);
    this.viewmodel.attachTo(svc.gfx.camera);

    progress(0.65, 'Building geometry');
    const radius = tier.drawDistance * st.drawDistance;
    this.streamer = new ChunkStreamer(
      this.plan,
      (cx, cz) => svc.pool.chunk(planId, cx, cz, tier.level),
      { loadRadius: radius, unloadMargin: 14, maxInFlight: 3, maxApplyPerFrame: 2 },
      { onLoad: (c) => this.addChunk(c), onUnload: (k) => this.removeChunk(k) },
    );
    await this.streamer.preload(this.plan.spawn.pos.x, this.plan.spawn.pos.z, Math.min(radius, 30));
    if (tier.materials === 'standard') this.captureEnvironment();
    progress(0.85, 'Placing objects');
    await this.buildObjects();
    this.fx = new SceneFx(svc, this.sim, this.ev, () => this.lights, this.fearBox);
    this.scare = new Jumpscare(svc, this.sim, this.ev);
    this.sim.listeners.push((e) => { this.onSimEvent(e); this.fx.onEvent(e); });
    this.sim.player.onStep = (sprint, crouch) => this.footstep(sprint, crouch);
    this.sim.player.reduceShake = st.reduceShake;
    this.sim.player.holdCrouchToggle = st.holdToggleCrouch === 'toggle';
    this.sim.player.holdSprintToggle = st.holdToggleSprint === 'toggle';
    svc.gfx.applyLook(look);
    progress(0.95, 'Compiling shaders');
    await this.prewarm();
    svc.gfx.resetExposure();
    this.startAudio();
    progress(1, 'Ready');
    bus.emit('level:loaded', { id: def.id, seed: this.seed });
  }

  /**
   * Hitch killer: build one body of every creature this level can spawn (fills the geometry cache) and
   * a sample of every surface material, compile all programs (parallel where supported), then render a
   * couple of frames behind the loading screen so shadow/skinning variants exist too. The warm bodies
   * stay (hidden) for the level's lifetime so their programs are never released and recompiled.
   */
  private async prewarm(): Promise<void> {
    const gfx = this.svc.gfx, cam = gfx.camera, tier = this.tier;
    const ids = new Set<string>(this.plan.entitySlots.map((s) => s.entity ?? (s.role === 'nest' ? 'hound' : 'stick')));
    if (this.plan.ruleEntity) ids.add(this.plan.ruleEntity === 'partygoers' ? 'partygoer' : this.plan.ruleEntity);
    ids.add('stick'); ids.add('hound'); if (this.def.id !== 'testroom') ids.add('companion');
    const bodies: Body[] = [...ids].map((id) => buildBody(id, tier.level));
    bodies.push(buildStick(tier.level, true)); // hallucination ghost (transparent variant)
    const holder = new Group();
    const samples: Mesh[] = [];
    const quad = new PlaneGeometry(0.3, 0.3);
    for (const k of ['wall0', 'wall1', 'wall2', 'wall3', 'floor', 'floorTile', 'ceiling', 'trim', 'decal', 'tbar'] as MatKey[]) if (this.lib.has(k)) samples.push(new Mesh(quad, this.lib.get(k)));
    this.extras.push(quad);
    const p = this.sim.player;
    p.apply(cam, 1, 0, 0); cam.updateMatrixWorld();
    cam.getWorldDirection(this.fwd);
    bodies.forEach((b, i) => { b.group.position.set(cam.position.x + this.fwd.x * 3 + (i - bodies.length / 2) * 0.6, 0, cam.position.z + this.fwd.z * 3); b.update(1, 0, 1 / 60, false, false); holder.add(b.group); });
    samples.forEach((m, i) => { m.position.set(cam.position.x + this.fwd.x * 2 + (i - samples.length / 2) * 0.32, 1.2, cam.position.z + this.fwd.z * 2); m.lookAt(cam.position); holder.add(m); });
    this.scene.add(holder);
    this.lights.update(cam.position.x, cam.position.y, cam.position.z, 0, 1);
    try { await gfx.renderer.compileAsync(this.scene, cam); } catch { /* older drivers: the frames below compile synchronously */ }
    this.flash.intensity = FLASH_CD; // compile the flashlight-on path (shadow + cookie) as well
    gfx.setScene(this.scene); gfx.render(1 / 60); gfx.render(1 / 60);
    this.flash.intensity = 0;
    for (const b of bodies) b.group.visible = false;
    samples.forEach((m) => m.removeFromParent());
    this.warm = bodies;
  }

  /** Reflection capture: render the real level around the spawn into a cube map and prefilter it (PMREM). */
  private captureEnvironment(): void {
    const r = this.svc.gfx.renderer;
    const rt = new WebGLCubeRenderTarget(128, { type: HalfFloatType });
    const cam = new CubeCamera(0.05, 60, rt);
    cam.position.set(this.plan.spawn.pos.x, 1.5, this.plan.spawn.pos.z);
    const prevEnv = this.scene.environment, fog = this.scene.fog;
    this.scene.environment = null; this.scene.fog = null;
    this.surface.uPoolR.value = 0; // fully baked lighting for the capture
    this.dust?.points.removeFromParent();
    cam.update(r, this.scene);
    if (this.dust) this.scene.add(this.dust.points);
    this.scene.fog = fog;
    const pm = new PMREMGenerator(r);
    const env = pm.fromCubemap(rt.texture);
    rt.dispose(); pm.dispose();
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.6;
    if (prevEnv) prevEnv.dispose();
    this.extras.push({ dispose: () => env.dispose() });
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
    const noteMat = new MeshStandardMaterial({ color: 0xe8e2c8, roughness: 0.9, emissive: new Color(0x2a2616) });
    const box = new BoxGeometry(0.22, 0.22, 0.22), paper = new BoxGeometry(0.3, 0.02, 0.21);
    this.extras.push(keyMat, lootMat, noteMat, box, paper);
    for (const it of plan.items) {
      if (sim.collected.has(it.id)) continue; // already taken (checkpoint restore) or scarce on this difficulty
      const m = new Mesh(it.kind === 'note' ? paper : box, it.kind === 'key' ? keyMat : it.kind === 'note' ? noteMat : lootMat);
      m.position.set(it.pos.x, it.kind === 'note' ? 0.05 : 0.6, it.pos.z);
      if (it.kind === 'note') m.rotation.y = it.pos.x;
      scene.add(m); this.itemMeshes.set(it.id, m);
    }
    // hiding spots: lockers and desks
    const lockerG = new BoxGeometry(0.6, 1.9, 0.55), deskG = new BoxGeometry(1.2, 0.75, 0.7);
    const lockerM = new MeshStandardMaterial({ color: 0x5a6a60, roughness: 0.5, metalness: 0.6 }), deskM = new MeshStandardMaterial({ color: 0x5a4632, roughness: 0.8 });
    this.extras.push(lockerG, deskG, lockerM, deskM);
    for (const h of plan.hides ?? []) {
      const m = new Mesh(h.kind === 'locker' ? lockerG : deskG, h.kind === 'locker' ? lockerM : deskM);
      m.position.set(h.pos.x, h.kind === 'locker' ? 0.95 : 0.375, h.pos.z); m.rotation.y = h.yaw;
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    // props (racks, desks, pipes...): box meshes per kind (instanced by kind)
    const propGeo = new BoxGeometry(1, 1, 1);
    this.extras.push(propGeo);
    const byColor = new Map<string, { x: number; z: number; w: number; d: number; h: number; color: number; kind: string }[]>();
    for (const pr of plan.props ?? []) { const k = `${pr.color}:${pr.kind === 'glow'}`; (byColor.get(k) ?? byColor.set(k, []).get(k)!).push(pr); }
    for (const [, list] of byColor) {
      const color = list[0].color;
      const mat = new MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.25, ...(list[0].kind === 'glow' ? { emissive: new Color(color).multiplyScalar(1.4) } : {}) });
      this.extras.push(mat);
      const inst = new InstancedMesh(propGeo, mat, list.length);
      list.forEach((pr, i) => { this.tmpM.makeScale(pr.w, pr.h, pr.d).setPosition(pr.x, pr.h / 2, pr.z); inst.setMatrixAt(i, this.tmpM); });
      inst.castShadow = true; inst.receiveShadow = true;
      scene.add(inst); this.propMeshes.push(inst);
    }
    // gallery portraits: framed canvases; the wrong ones turn to follow you
    for (const pt of plan.portraits ?? []) {
      const c = document.createElement('canvas'); c.width = 128; c.height = 160;
      const g2 = c.getContext('2d')!; g2.fillStyle = '#2a2016'; g2.fillRect(0, 0, 128, 160); g2.fillStyle = '#8a6a3a'; g2.fillRect(6, 6, 116, 148); g2.fillStyle = pt.wrong ? '#201a12' : '#3a2e22'; g2.fillRect(12, 12, 104, 136);
      g2.fillStyle = '#c8b890'; g2.beginPath(); g2.ellipse(64, 70, 26, 34, 0, 0, 7); g2.fill(); g2.fillStyle = '#101010'; g2.fillRect(48, 62, 10, 6); g2.fillRect(70, 62, 10, 6);
      if (pt.wrong) { g2.fillStyle = '#f0e8c0'; g2.fillRect(51, 63, 4, 4); g2.fillRect(73, 63, 4, 4); g2.fillStyle = '#101010'; g2.fillRect(50, 88, 28, 3); }
      const tx = new CanvasTexture(c); tx.colorSpace = SRGBColorSpace;
      const geo = new PlaneGeometry(0.9, 1.15), mat = new MeshBasicMaterial({ map: tx });
      const m = new Mesh(geo, mat); m.position.set(pt.x - Math.sin(pt.yaw) * 0.02, 1.7, pt.z - Math.cos(pt.yaw) * 0.02); m.rotation.y = pt.yaw + Math.PI;
      scene.add(m); this.portraitMeshes.push({ mesh: m, yaw: pt.yaw, wrong: pt.wrong });
      this.extras.push(geo, mat, tx);
    }
    // water: a translucent surface per flooded room (wade / swim / flooded heights); sludge is murky brown
    // all water rooms of one kind share ONE merged mesh (draw-call budget): clear water and sludge
    for (const sludge of [false, true]) {
      const parts: PlaneGeometry[] = [];
      for (const w of (plan.water ?? []).filter((q) => !!q.sludge === sludge)) {
        const r = plan.rooms[w.room];
        const g = new PlaneGeometry(r.w - 0.3, r.d - 0.3);
        g.rotateX(-Math.PI / 2);
        g.translate(r.x + r.w / 2, w.depth === 'wade' ? 0.3 : w.depth === 'swim' ? 1.0 : Math.min(2.8, r.height - 0.2), r.z + r.d / 2);
        parts.push(g);
      }
      if (!parts.length) continue;
      const merged = mergeGeometries(parts)!;
      parts.forEach((g) => g.dispose());
      const m = new MeshStandardMaterial({ color: sludge ? 0x3a3a1e : 0x2a6a80, roughness: 0.08, metalness: 0.1, transparent: true, opacity: sludge ? 0.85 : 0.6 });
      const mesh = new Mesh(merged, m);
      scene.add(mesh); this.waterMeshes.push(mesh);
      this.extras.push(m, merged);
    }
    // sound beacon at the exit (navigate by ear in the dark)
    if (plan.beacons?.length) { const a = this.svc.audio(), sn = this.svc.sounds(); if (a && sn) this.humHandles.push(sn.beacon(a.spatial(plan.beacons[0].x, 1.4, plan.beacons[0].z, 'ambience', 0.15, 0.6))); }
    // puzzle valves: a wheel on a stem that turns with its state
    for (const pz of plan.puzzles ?? []) for (const pt of pz.parts) {
      if (sim.keys.has(pz.lock)) break;
      const g = new Group(); g.position.set(pt.pos.x, 0, pt.pos.z);
      const stem = new Mesh(new CylinderGeometry(0.06, 0.06, 1.1, 8), new MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5, metalness: 0.7 })); stem.position.y = 0.55; g.add(stem);
      const wheel = new Mesh(new TorusGeometry(0.28, 0.035, 8, 16), new MeshStandardMaterial({ color: 0xa83a2a, roughness: 0.5, metalness: 0.6 })); wheel.rotation.x = Math.PI / 2; wheel.position.y = 1.15; g.add(wheel);
      scene.add(g); this.valveMeshes.set(pt.id, wheel);
      this.extras.push({ dispose: () => { stem.geometry.dispose(); (stem.material as MeshStandardMaterial).dispose(); wheel.geometry.dispose(); (wheel.material as MeshStandardMaterial).dispose(); } });
    }
    // scrawled clue notes left by earlier wanderers (find this / avoid that, with a crude drawing)
    this.clues = planClues(plan);
    if (this.clues.length) {
      await loadHandFont();
      this.clueVis = buildClues(this.clues, tier.materials === 'lambert', (m) => patchSurface(m, this.surface, { grime: 0, stain: 0, wet: 0, scale: 1, bake: true }));
      scene.add(this.clueVis.group);
      const prev = sim.extra, vis = this.clueVis;
      sim.extra = () => [...(prev?.() ?? []), ...this.clues.map((c) => ({ kind: 'custom' as const, x: c.x, z: c.z, label: 'Read the scrap of paper', ref: { type: 'clue', id: c.id, text: c.text, img: () => vis.image(c.id) } }))];
    }
    if (plan.hub) {
      this.hubObj = buildHubObjects(scene, plan, this.opts.hub!);
      sim.world.add('hubobjs', this.hubObj.colliders);
    }
    const doorGeo = new BoxGeometry(1, 2.2, 0.16);
    const doorMats: Record<string, MeshStandardMaterial> = {
      key: new MeshStandardMaterial({ color: 0x5a1f1a, roughness: 0.6, metalness: 0.3 }), fuse: new MeshStandardMaterial({ color: 0x1f3a5a, roughness: 0.5, metalness: 0.5, emissive: new Color(0x081428) }),
      pry: new MeshStandardMaterial({ color: 0x4a4a3a, roughness: 0.8, metalness: 0.4 }), rope: new MeshStandardMaterial({ color: 0x6a5a3a, roughness: 0.95 }), seq: new MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.4, metalness: 0.7, emissive: new Color(0x061018) }), breaker: new MeshStandardMaterial({ color: 0x3a1a1a, roughness: 0.5, metalness: 0.6, emissive: new Color(0x200808) }), valves: new MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.5, metalness: 0.6 }),
    };
    this.extras.push(doorGeo, ...Object.values(doorMats));
    for (const d of sim.doors.values()) {
      if (d.open) continue;
      const m = new Mesh(doorGeo, doorMats[(d.conn.lock ?? 'key').replace(/\d+$/, '')] ?? doorMats.key);
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
    // exit marker: Level 0's "wrong wall" is a slab that hums a half-step flat
    if (plan.hub) return;
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
      defs.forEach((d, i) => { this.tmpM.makeTranslation(d.x, d.y + LAMP_DY, d.z); lamps!.setMatrixAt(i, this.tmpM); lamps!.setColorAt(i, this.tmpC.setScalar(d.broken ? 0.02 : 1)); });
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
    if (this.sim.waterHere) return 'water';
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
    this.dreadBed = s.dread(a.flat('ambience', 0.1));
    this.humHandles.push(this.dreadBed);
  }

  /** Heart rate for the HUD. */
  get bpm(): number { return this.fx?.bpm ?? 64; }
  get stress(): number { return this.fx?.stress ?? 0; }

  private onSimEvent(e: SimEvent): void {
    const s = this.svc.sounds(), a = this.svc.audio();
    if (e.type === 'lights') this.restoreRooms(e.rooms);
    if (e.type === 'note') { const m = [...this.itemMeshes].find(([id]) => this.plan.items.find((i) => i.id === id)?.item === e.id); if (m) { m[1].removeFromParent(); this.itemMeshes.delete(m[0]); } this.onNote?.(e.id); s?.click('tick'); }
    else if (e.type === 'hit') this.scare.start(e.entity, Jumpscare.kindFor(e.damage, e.lethal));
    else if (e.type === 'death') { if (this.scare.active) this.scare.onDone = () => this.onDeath?.(); else this.onDeath?.(); }
    else if (e.type === 'custom') this.onCustom?.(e.ref);
    else if (e.type === 'pickup') {
      const m = this.itemMeshes.get(e.item.id);
      if (m) { m.removeFromParent(); this.itemMeshes.delete(e.item.id); }
      bus.emit('toast', { text: `Picked up ${itemDef(e.item.item).name}` });
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
    this.sim.step(f, dt);
    if (this.tick % 6 === 0) this.prompt = this.sim.interactables()[0]?.label ?? null;
    if (this.tick % 30 === 0) this.updateObjective();
  }

  private updateObjective(): void {
    const sim = this.sim, p = sim.player;
    const o = this.plan.hub ? hubObjective(this.plan, this.opts.hub!) : levelObjective(sim);
    this.objective = o;
    if (this.plan.hub) { this.objectiveHint = null; return; }
    const loot = sim.collected.size + sim.notes.size + sim.keys.size;
    if (o.key !== this.objKey) { this.objKey = o.key; this.objBestDist = o.dist; this.objProgressAt = sim.time; }
    else if (o.dist < this.objBestDist || loot !== this.objLoot) { this.objBestDist = Math.min(o.dist, this.objBestDist); this.objProgressAt = sim.time; }
    this.objLoot = loot;
    // stalled: nothing new for ~100 s of play -> say roughly which way the next step lies
    this.objectiveHint = o.target && sim.time - this.objProgressAt > 100 ? `Lost? The next step is ${bearingWords(p.x, p.z, p.yaw, o.target)}.` : null;
  }

  /** Per rendered frame. */
  render(alpha: number, dt: number): void {
    const { svc } = this;
    const gfx = svc.gfx, cam = gfx.camera;
    this.time += dt;
    const p = this.sim.player;
    this.scare.update(dt);
    p.apply(cam, alpha, this.fearBox.v, this.time);
    this.scare.applyCamera(cam);
    cam.getWorldDirection(this.fwd);
    this.streamer.update(cam.position.x, cam.position.z);
    this.lights.update(cam.position.x, cam.position.y, cam.position.z, this.time, dt);
    this.surface.uPoolR.value = this.lights.coverRadius;
    this.lib.pump(svc.gfx.renderer);
    // blackout: lamps die, baked light and fill go with them, the dread bed swells
    const dark = this.lights.dark;
    this.surface.uBakeDirect.value = this.darkDirect * (1 - dark);
    this.surface.uBakeBounce.value = this.darkBounce * (1 - 0.92 * dark);
    this.lib.lamp.color.copy(this.lampBase).multiplyScalar(1 - 0.96 * dark);
    this.dreadBed?.set(Math.max(this.stress, dark * 0.9));
    this.dust?.update(this.time, cam.position.x, cam.position.z);
    this.props?.update(this.time);
    // flashlight follows the camera with a little lag-free offset
    const flashOut = this.sim.inv.has('flashlight') && this.sim.flash.on ? this.sim.flash.output(this.time) : 0;
    this.flash.intensity = FLASH_CD * flashOut; // never toggle `visible` on lights: it recompiles every shader
    this.flash.shadow.autoUpdate = flashOut > 0.01;
    const hasFlash = this.sim.inv.has('flashlight');
    cam.updateMatrixWorld();
    this.viewmodel?.update(dt, hasFlash && !this.sim.hidden, flashOut, p.yaw, p.pitch, Math.min(1, p.speed / 3), this.time);
    this.ev.sync(this.sim.ew, this.time, dt);
    this.fx.update(dt, cam, flashOut > 0.4);
    this.hubObj?.update(this.time, p.x, p.z);
    // blizzard gusts (Arctic) thicken the fog; wrong portraits follow your position with their gaze
    if (this.plan.cold && this.scene.fog) { const gust = 0.5 + 0.5 * Math.sin(this.time * 0.25) * Math.sin(this.time * 0.11 + 1); (this.scene.fog as FogExp2).density = this.fogBase.density * (1 + gust * 1.6); }
    for (const pm of this.portraitMeshes) if (pm.wrong) pm.mesh.rotation.y = pm.yaw + Math.PI + Math.max(-0.5, Math.min(0.5, Math.atan2(p.x - pm.mesh.position.x, p.z - pm.mesh.position.z) - pm.yaw)) * 0.4 * Math.sin(this.time * 0.7);
    // underwater: murky blue fog while diving
    const fog = this.scene.fog as FogExp2 | null;
    if (fog && !this.plan.cold) { const dive = this.sim.player.swim === 'dive'; fog.density += ((dive ? this.fogBase.density * 5 + 0.05 : this.fogBase.density) - fog.density) * Math.min(1, dt * 6); fog.color.lerp(dive ? this.tmpC.setHex(0x0a2a3a) : this.fogBase.color, Math.min(1, dt * 6)); }
    for (const [id, w] of this.valveMeshes) w.rotation.z = (this.sim.x.valves.get(id) ?? 0) * (Math.PI / 2);
    const nv = this.sim.cam.nightVision;
    gfx.nightVision = nv; this.ambient.intensity = this.ambientBase * (nv ? 4 : 1) * (1 - 0.85 * this.lights.dark);
    // flare + glowstick light (fixed light count: no shader recompiles)
    const fl = this.sim.flares[this.sim.flares.length - 1], gl = this.sim.glows[this.sim.glows.length - 1];
    for (const [i, src] of [fl, gl].entries()) { const l = this.dyn[i]; if (src) { l.position.set(src.x, 0.4, src.z); l.intensity = (i === 0 ? 16 : 5) * Math.min(1, src.t / 4); } else l.intensity = 0; }
    if (this.viewmodel?.group.visible) this.viewmodel.lensWorld(this.flash.position).addScaledVector(this.fwd, 0.02);
    else this.flash.position.copy(cam.position).addScaledVector(this.fwd, 0.1);
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
    gfx.fear = this.fearBox.v;
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

  /** Breaker flipped: relight every lamp in these rooms (sections of the Garage). */
  restoreRooms(rooms: number[]): void {
    const set = new Set(rooms);
    let changed = false;
    for (const d of this.bakeLamps) if (set.has(d.room) && d.broken) { d.broken = false; changed = true; }
    if (changed) setBake(this.surface, bakeLighting(this.plan, this.bakeLamps));
    for (const v of this.chunks.values()) {
      let dirty = false;
      v.lampDefs.forEach((d, i) => { if (set.has(d.room) && d.broken) { d.broken = false; v.lamps?.setColorAt(i, this.tmpC.setScalar(1)); dirty = true; } });
      if (dirty && v.lamps?.instanceColor) v.lamps.instanceColor.needsUpdate = true;
    }
  }

  teleport(x: number, z: number): void { this.sim.player.place(x, z, this.sim.player.yaw); }

  dispose(): void {
    document.body.classList.remove('hiding');
    if (this.scare) { this.scare.onDone = null; this.svc.gfx.fovKick = 0; }
    this.ev.dispose(); this.hubObj?.dispose(); this.viewmodel?.dispose();
    this.warm.forEach((b) => b.dispose()); this.warm = [];
    this.clueVis?.dispose();
    for (const h of this.humHandles) h.stop(0.3);
    for (const k of [...this.chunks.keys()]) this.removeChunk(k);
    this.propMeshes.forEach((m) => { m.dispose(); m.removeFromParent(); });
    this.waterMeshes.forEach((m) => m.removeFromParent());
    this.props?.dispose();
    this.lights.dispose(); this.dust?.dispose(); this.lib.dispose();
    this.extras.forEach((e) => e.dispose());
    this.overlays.forEach((o) => o.removeFromParent());
    this.scene.clear();
  }
}
