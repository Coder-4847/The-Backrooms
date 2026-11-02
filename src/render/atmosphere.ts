/** Atmosphere: floating dust particles that wrap around the camera (GPU-animated, zero per-frame allocation). */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, type Scene } from 'three';

export class Dust {
  readonly points: Points;
  private mat: ShaderMaterial;

  constructor(count: number, color: number, extent = 22) {
    const g = new BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // deterministic-looking spread without needing a seed: dust is purely cosmetic
      const a = (i * 2654435761) >>> 0;
      pos[i * 3] = ((a & 1023) / 1023) * extent;
      pos[i * 3 + 1] = (((a >>> 10) & 1023) / 1023) * 3.2;
      pos[i * 3 + 2] = (((a >>> 20) & 1023) / 1023) * extent;
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    this.mat = new ShaderMaterial({
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: [0, 0, 0] }, uExtent: { value: extent }, uColor: { value: new Color(color) } },
      vertexShader: `
        uniform float uTime, uExtent; uniform vec3 uCam; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.13 + position.z) * 0.6; p.y += sin(uTime * 0.11 + position.x * 1.7) * 0.25 + uTime * 0.02; p.z += cos(uTime * 0.1 + position.x) * 0.6;
          p.y = mod(p.y, 3.2);
          vec3 w = vec3(mod(p.x - uCam.x + uExtent * 0.5, uExtent) - uExtent * 0.5 + uCam.x, p.y, mod(p.z - uCam.z + uExtent * 0.5, uExtent) - uExtent * 0.5 + uCam.z);
          vec4 mv = modelViewMatrix * vec4(w, 1.0);
          float d = -mv.z;
          vA = smoothstep(uExtent * 0.5, 1.0, d) * smoothstep(0.2, 1.2, d);
          gl_PointSize = clamp(60.0 / max(d, 0.5), 1.0, 5.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.2, r) * 0.28 * vA; gl_FragColor = vec4(uColor, a); }`,
    });
    this.points = new Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  update(t: number, x: number, z: number): void {
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uCam.value as number[])[0] = x;
    (this.mat.uniforms.uCam.value as number[])[2] = z;
  }
  addTo(scene: Scene): void { scene.add(this.points); }
  dispose(): void { this.points.geometry.dispose(); this.mat.dispose(); this.points.removeFromParent(); }
}
