/**
 * Short GPU/CPU benchmark used by Auto quality (spec 6.3). Renders a fixed scene many times in one
 * task and forces completion with a 1-pixel readback, so the result is *not* capped by vsync.
 */
import { BoxGeometry, FogExp2, Mesh, MeshStandardMaterial, PerspectiveCamera, PointLight, Scene, WebGLRenderTarget, HalfFloatType, type WebGLRenderer } from 'three';
import { Rng } from '../gen/rng';
import type { BenchResult } from './quality';

export function runBenchmark(renderer: WebGLRenderer): BenchResult {
  const scene = new Scene();
  scene.fog = new FogExp2(0x1a1608, 0.03);
  const rng = new Rng(2024);
  const geo = new BoxGeometry(1, 1, 1);
  const mat = new MeshStandardMaterial({ color: 0xbba870, roughness: 0.7, metalness: 0.1 });
  for (let i = 0; i < 220; i++) {
    const m = new Mesh(geo, mat);
    m.position.set(rng.range(-14, 14), rng.range(0, 3), rng.range(-30, 0));
    m.scale.set(rng.range(0.5, 2), rng.range(0.5, 3), rng.range(0.5, 2));
    scene.add(m);
  }
  for (let i = 0; i < 6; i++) { const l = new PointLight(0xfff0c0, 20, 14, 2); l.position.set(rng.range(-8, 8), 2.8, -i * 5); scene.add(l); }
  const cam = new PerspectiveCamera(75, 16 / 9, 0.1, 80);
  cam.position.set(0, 1.6, 2);
  const rt = new WebGLRenderTarget(1280, 720, { type: HalfFloatType });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  const draw = () => renderer.render(scene, cam);
  const sync = () => { try { renderer.readRenderTargetPixels(rt, 0, 0, 1, 1, new Uint16Array(4)); } catch { /* ignore */ } };
  for (let i = 0; i < 6; i++) draw();
  sync();
  const samples: number[] = [];
  const t0 = performance.now();
  for (let s = 0; s < 4 && performance.now() - t0 < 2500; s++) {
    const a = performance.now();
    const n = 6;
    for (let i = 0; i < n; i++) draw();
    sync();
    samples.push((performance.now() - a) / n);
  }
  renderer.setRenderTarget(prev);
  rt.dispose(); geo.dispose(); mat.dispose();
  scene.traverse((o) => { (o as PointLight).dispose?.(); });
  samples.sort((a, b) => a - b);
  return { avgFrameMs: samples[Math.floor(samples.length / 2)] ?? 99, frames: samples.length * 6 };
}
