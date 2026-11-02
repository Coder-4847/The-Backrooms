/**
 * Eye adaptation (auto exposure), fully on the GPU: a 1x1 pass measures centre-weighted log-average
 * luminance of the HDR frame (64 taps) and eases toward it over time (ping-pong 1x1 targets);
 * the apply pass scales the frame by key / adapted luminance, clamped so darkness stays dark.
 * No readbacks, two tiny draws per frame.
 */
import { HalfFloatType, ShaderMaterial, WebGLRenderTarget, type WebGLRenderer, type Texture } from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }';

export class ExposurePass extends Pass {
  private rts: [WebGLRenderTarget, WebGLRenderTarget];
  private cur = 0;
  private measure: ShaderMaterial;
  private apply: ShaderMaterial;
  private quad: FullScreenQuad;
  private first = true;
  /** Middle-grey target, clamps and adaptation speed (1/s). */
  key = 0.16;
  minExposure = 0.55;
  maxExposure = 1.9;
  speedUp = 1.4;    // dark -> bright (pupils constrict fast)
  speedDown = 0.45; // bright -> dark (slow, like real eyes)
  dt = 1 / 60;

  constructor() {
    super();
    const mk = () => new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.rts = [mk(), mk()];
    this.measure = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tPrev: { value: null }, uRate: { value: [1, 1] }, uFirst: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform sampler2D tPrev; uniform vec2 uRate; uniform float uFirst;
        varying vec2 vUv;
        void main() {
          float sum = 0.0, wsum = 0.0;
          for ( int j = 0; j < 8; j++ ) for ( int i = 0; i < 8; i++ ) {
            vec2 p = ( vec2( float( i ), float( j ) ) + 0.5 ) / 8.0;
            vec2 q = p * 2.0 - 1.0;
            float w = 1.0 - 0.6 * dot( q, q ) * 0.5; // centre-weighted metering
            vec3 c = texture2D( tDiffuse, mix( vec2( 0.08 ), vec2( 0.92 ), p ) ).rgb;
            float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
            sum += log( max( l, 1e-4 ) ) * w; wsum += w;
          }
          float now = sum / wsum;
          float prev = texture2D( tPrev, vec2( 0.5 ) ).r;
          float rate = now > prev ? uRate.x : uRate.y;
          gl_FragColor = vec4( uFirst > 0.5 ? now : mix( prev, now, rate ), 0.0, 0.0, 1.0 );
        }`,
      depthTest: false, depthWrite: false,
    });
    this.apply = new ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tLum: { value: null }, uKey: { value: this.key }, uMin: { value: this.minExposure }, uMax: { value: this.maxExposure } },
      vertexShader: VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform sampler2D tLum; uniform float uKey, uMin, uMax;
        varying vec2 vUv;
        void main() {
          float avg = exp( texture2D( tLum, vec2( 0.5 ) ).r );
          float e = clamp( uKey / max( avg, 1e-4 ), uMin, uMax );
          vec4 c = texture2D( tDiffuse, vUv );
          gl_FragColor = vec4( c.rgb * e, c.a );
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.measure);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const prev = this.rts[this.cur], next = this.rts[1 - this.cur];
    const m = this.measure.uniforms;
    m.tDiffuse.value = readBuffer.texture as Texture; m.tPrev.value = prev.texture;
    m.uRate.value = [1 - Math.exp(-this.dt * this.speedUp), 1 - Math.exp(-this.dt * this.speedDown)];
    m.uFirst.value = this.first ? 1 : 0; this.first = false;
    this.quad.material = this.measure;
    renderer.setRenderTarget(next); this.quad.render(renderer);
    this.cur = 1 - this.cur;
    const a = this.apply.uniforms;
    a.tDiffuse.value = readBuffer.texture; a.tLum.value = next.texture;
    a.uKey.value = this.key; a.uMin.value = this.minExposure; a.uMax.value = this.maxExposure;
    this.quad.material = this.apply;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  /** Snap instantly next frame (level load, teleport). */
  reset(): void { this.first = true; }

  dispose(): void { this.rts.forEach((r) => r.dispose()); this.measure.dispose(); this.apply.dispose(); this.quad.dispose(); }
}
