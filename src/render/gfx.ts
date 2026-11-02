/**
 * Gfx: owns the WebGLRenderer, post-processing chain and dynamic resolution.
 * Chain (full): scene -> GTAO -> bloom -> tone-map/sRGB (OutputPass) -> VHS pass -> screen.
 * Potato skips the chain entirely (direct render + a cheap DOM grain overlay).
 */
import {
  AgXToneMapping, HalfFloatType, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace,
  Vector2, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { VhsPass } from './vhs';
import { ExposurePass } from './exposure';
import { renderScale, TIERS, type HardwareInfo, type TierDef } from './quality';
import type { Settings } from '../core/settings';
import type { LevelLook } from '../gen/types';

const CB_MODE = { off: 0, protanopia: 1, deuteranopia: 2, tritanopia: 3 } as const;

export class Gfx {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 120);
  scene = new Scene();
  tier: TierDef = TIERS.high;
  dynamic = 1;
  /** Fear 0..1 and one-shot glitch 0..1, set by gameplay; consumed by the VHS pass. */
  fear = 0;
  glitch = 0;
  nightVision = false;

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private exposure: ExposurePass | null = null;
  private vhs: VhsPass | null = null;
  private grainEl: HTMLElement;
  private size = new Vector2();
  private settings!: Settings;
  private time = 0;
  readonly hasWebGL2: boolean;

  constructor(readonly canvas: HTMLCanvasElement, settings: Settings) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.hasWebGL2 = this.renderer.capabilities.isWebGL2;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = false; // post passes render several times per frame: reset once per frame ourselves
    this.camera.position.set(0, 1.6, 0);
    this.grainEl = document.createElement('div');
    this.grainEl.className = 'potato-grain';
    this.grainEl.style.display = 'none';
    document.body.appendChild(this.grainEl);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    this.settings = settings;
  }

  hardwareInfo(): HardwareInfo {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const nav = navigator as Navigator & { deviceMemory?: number };
    return {
      gpu, cores: navigator.hardwareConcurrency ?? 0, memoryGb: nav.deviceMemory ?? 0,
      mobile: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches),
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
    };
  }

  get maxAnisotropy(): number { return this.renderer.capabilities.getMaxAnisotropy(); }

  /** (Re)build the pipeline for a tier + settings. Cheap enough to call on any graphics setting change. */
  configure(tier: TierDef, s: Settings): void {
    this.tier = tier;
    this.settings = s;
    const r = this.renderer;
    const shadowsOn = s.shadowQuality !== 'off' && tier.shadowLights > 0;
    r.shadowMap.enabled = shadowsOn;
    this.camera.fov = s.fov;
    this.camera.far = Math.max(40, tier.drawDistance * s.drawDistance * 1.6);
    this.camera.updateProjectionMatrix();
    this.grainEl.style.display = tier.post === 'none' && s.vhs && s.grain ? 'block' : 'none';

    this.disposePost();
    if (tier.post === 'none') {
      r.toneMapping = AgXToneMapping;
      r.toneMappingExposure = 1.05; // no eye adaptation on Potato: a fixed exposure
    } else {
      // OutputPass reads renderer.toneMapping (scene passes render to HDR targets, untonemapped)
      r.toneMapping = AgXToneMapping;
      r.toneMappingExposure = 1.0;
      this.buildComposer(tier, s);
    }
    this.resize();
  }

  private buildComposer(tier: TierDef, s: Settings): void {
    const w = Math.max(2, this.canvas.clientWidth || 1280), h = Math.max(2, this.canvas.clientHeight || 720);
    const samples = s.antialias && this.hasWebGL2 && tier.level >= 3 ? 4 : 0;
    const rt = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples });
    const c = (this.composer = new EffectComposer(this.renderer, rt));
    this.renderPass = new RenderPass(this.scene, this.camera);
    c.addPass(this.renderPass);

    if (tier.ssao && s.ssao) {
      this.gtao = new GTAOPass(this.scene, this.camera, w, h);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 1;
      this.gtao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: tier.level >= 4 ? 16 : 8, distanceFallOff: 1, screenSpaceRadius: false });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: tier.level >= 4 ? 16 : 8 });
      c.addPass(this.gtao);
    }
    this.exposure = new ExposurePass();
    c.addPass(this.exposure);
    if (tier.bloom && s.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(w, h), tier.level >= 3 ? 0.24 : 0.2, 0.3, 1.6);
      c.addPass(this.bloom);
    }
    c.addPass(new OutputPass());
    // no MSAA below High: post-process anti-aliasing keeps thin geometry (ceiling grid, trims) from crawling
    if (s.antialias && samples === 0) c.addPass(new SMAAPass());
    this.vhs = new VhsPass();
    c.addPass(this.vhs);
    if (this.lookGrade) this.applyGrade(this.lookGrade);
  }

  private disposePost(): void {
    this.composer?.dispose();
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.exposure?.dispose();
    this.composer = this.renderPass = this.gtao = this.bloom = this.vhs = this.exposure = null;
  }

  /** Use the scene's look (fog, tint) for post uniforms. */
  private lens = { tint: [1, 1, 1] as [number, number, number], sat: 1 };
  private lookGrade: LevelLook['grade'] | null = null;
  /** Cosmetic camcorder lens (unlocked by endings): multiplies the level's colour grade. */
  setLens(tint: [number, number, number], sat: number): void { this.lens = { tint, sat }; if (this.lookGrade) this.applyGrade(this.lookGrade); }
  private applyGrade(g: LevelLook['grade']): void {
    const u = this.vhs?.u;
    if (!u) return;
    u.uTint.value.set(g.tint[0] * this.lens.tint[0], g.tint[1] * this.lens.tint[1], g.tint[2] * this.lens.tint[2]);
    u.uSat.value = g.saturation * this.lens.sat;
    u.uContrast.value = g.contrast;
  }

  applyLook(look: LevelLook): void {
    this.lookGrade = look.grade;
    const u = this.vhs?.u;
    if (!u) return;
    u.uTint.value.set(...look.grade.tint);
    u.uSat.value = look.grade.saturation;
    u.uContrast.value = look.grade.contrast;
    this.applyGrade(look.grade);
  }

  /** Snap eye adaptation (new level, teleport). */
  resetExposure(): void { this.exposure?.reset(); }

  setScene(scene: Scene): void {
    this.scene = scene;
    if (this.renderPass) this.renderPass.scene = scene;
    if (this.gtao) (this.gtao as unknown as { scene: Scene }).scene = scene;
  }

  setDynamicScale(s: number): void { this.dynamic = s; this.resize(); }

  /** Effective resolution multiplier used for reporting. */
  get scale(): number { return renderScale(this.tier, this.settings, this.dynamic); }

  resize(): void {
    const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.maxPixelRatio);
    const ratio = dpr * this.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cw, ch, false);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(cw, ch);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    this.renderer.getDrawingBufferSize(this.size);
    if (this.vhs) this.vhs.u.uRes.value.copy(this.size);
  }

  /** Draw the scene (through post when enabled). */
  render(dt: number): void {
    this.time += dt;
    const s = this.settings;
    if (this.vhs) {
      const u = this.vhs.u;
      const on = s.vhs;
      const k = on ? s.vhsIntensity : 0;
      const light = this.tier.post === 'light';
      u.uTime.value = this.time;
      u.uIntensity.value = on ? Math.max(0.0001, k) : 0;
      u.uGrain.value = s.grain ? 1 : 0;
      u.uScan.value = s.scanlines && !light ? 1 : 0;
      u.uChroma.value = s.chromatic && !light ? 1 : 0;
      u.uVig.value = s.vignette ? 1 : 0;
      u.uWobble.value = s.reduceShake ? 0 : 1;
      u.uGlitch.value = s.reduceFlicker ? this.glitch * 0.3 : this.glitch;
      u.uFear.value = s.reduceShake ? this.fear * 0.5 : this.fear;
      u.uCbMode.value = CB_MODE[s.colorblind];
      u.uNv.value = this.nightVision ? 1 : 0;
    }
    this.glitch *= Math.pow(0.02, dt); // decays in ~1s
    if (this.exposure) this.exposure.dt = Math.min(0.1, dt);
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  stats(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }

  dispose(): void { this.disposePost(); this.renderer.dispose(); this.grainEl.remove(); }
}
