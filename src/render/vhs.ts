/**
 * The unified VHS / camcorder layer (spec 6.2): grain, scanlines, chromatic aberration, tracking
 * glitches/tearing, vignette, lens wobble, plus per-level colour grading. One cheap full-screen
 * pass; every part is individually toggleable and scaled by the intensity slider.
 */
import { ShaderMaterial, Vector2, Vector3 } from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const shader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 }, uRes: { value: new Vector2(1280, 720) },
    uIntensity: { value: 0.7 }, uGrain: { value: 1 }, uScan: { value: 1 }, uChroma: { value: 1 }, uVig: { value: 1 },
    uGlitch: { value: 0 }, uFear: { value: 0 }, uWobble: { value: 1 },
    uTint: { value: new Vector3(1, 1, 1) }, uSat: { value: 1 }, uContrast: { value: 1 },
    uCbMode: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uIntensity, uGrain, uScan, uChroma, uVig, uGlitch, uFear, uWobble, uSat, uContrast, uCbMode;
    uniform vec2 uRes; uniform vec3 uTint; varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    vec3 colorblind(vec3 c){
      // simulate-and-compensate matrices (Machado-like, light touch): shift lost hue info into luminance/other channels
      if (uCbMode < 0.5) return c;
      mat3 m = uCbMode < 1.5 ? mat3(0.567,0.558,0.0, 0.433,0.442,0.242, 0.0,0.0,0.758)
             : uCbMode < 2.5 ? mat3(0.625,0.7,0.0, 0.375,0.3,0.3, 0.0,0.0,0.7)
             : mat3(0.95,0.0,0.0, 0.05,0.433,0.475, 0.0,0.567,0.525);
      vec3 sim = m * c;
      vec3 err = c - sim;
      return c + vec3(0.0, err.r * 0.5 + err.b * 0.2, err.r * 0.5 + err.g * 0.5);
    }
    void main(){
      vec2 uv = vUv;
      float I = uIntensity;
      float t = uTime;
      // tracking glitch band + tearing (driven by events and fear)
      float g = clamp(uGlitch + uFear * 0.15, 0.0, 1.0);
      float row = floor(uv.y * 48.0);
      float tearOn = step(0.985 - g * 0.12, hash(vec2(row, floor(t * 7.0))));
      uv.x += tearOn * (hash(vec2(row, t)) - 0.5) * 0.06 * g;
      float band = smoothstep(0.0, 0.01, abs(fract(uv.y * 0.35 + t * 0.07) - 0.5) - 0.495) * 0.0;
      uv.x += band;
      // gentle lens wobble (always subtle)
      uv.x += sin(uv.y * 520.0 + t * 40.0) * 0.00025 * I * uWobble;
      // chromatic aberration grows toward the edges and with fear
      vec2 d = uv - 0.5;
      float ca = uChroma * I * (0.0016 + dot(d, d) * 0.008 + g * 0.004);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ca).b;
      // colour grading
      col *= uTint;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col = colorblind(col);
      // scanlines
      col *= 1.0 - uScan * I * 0.10 * (0.5 + 0.5 * sin(uv.y * uRes.y * 3.14159));
      // luma-weighted grain
      float n = hash(uv * uRes + fract(t) * 91.7) - 0.5;
      col += n * uGrain * I * 0.16 * (1.0 - l * 0.5);
      // vignette (stronger with fear)
      float vig = smoothstep(0.85, 0.25, length(d) * (1.15 + uFear * 0.5));
      col *= mix(1.0, vig, uVig * (0.55 + 0.35 * I));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class VhsPass extends ShaderPass {
  constructor() {
    super(new ShaderMaterial({ uniforms: structuredCloneUniforms(), vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader }));
  }
  get u() { return (this.material as ShaderMaterial).uniforms; }
}

function structuredCloneUniforms() {
  const u: Record<string, { value: unknown }> = {};
  for (const [k, v] of Object.entries(shader.uniforms)) {
    const val = v.value as unknown;
    u[k] = { value: val && typeof (val as { clone?: () => unknown }).clone === 'function' ? (val as { clone: () => unknown }).clone() : val };
  }
  return u;
}
