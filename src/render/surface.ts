/**
 * Surface shader patch for level materials (Standard and Lambert alike, every tier):
 *  - baked lighting: irradiance from every ceiling lamp + first bounce (bake.ts), faded in beyond the
 *    radius the real-time light pool covers, so distant rooms are lit like a lightmapped engine;
 *  - analytic corner AO from the room box (walls meet floor/ceiling/other walls);
 *  - world-scale macro variation (grime, big water stains, wet glossy patches) so tiled textures never
 *    visibly repeat.
 */
import {
  Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, ClampToEdgeWrapping, RGBAFormat, Vector2, Vector4, NoColorSpace,
  type Material, type Texture,
} from 'three';
import type { BakeResult } from './bake';

export interface SurfaceShared {
  uBakeLight: { value: Texture | null };
  uBakeGeo: { value: Texture | null };
  uBakeOrigin: { value: Vector2 };
  uBakeInv: { value: Vector2 };
  uBakeTint: { value: Color };
  uBakeDirect: { value: number };
  uBakeBounce: { value: number };
  uBakeAo: { value: number };
  uPoolR: { value: number };
  uMacro: { value: Texture | null };
}

export function createSurfaceShared(): SurfaceShared {
  return {
    uBakeLight: { value: null }, uBakeGeo: { value: null }, uBakeOrigin: { value: new Vector2() }, uBakeInv: { value: new Vector2(1, 1) },
    uBakeTint: { value: new Color(1, 1, 1) }, uBakeDirect: { value: 1 }, uBakeBounce: { value: 0.6 }, uBakeAo: { value: 1 }, uPoolR: { value: 8 },
    uMacro: { value: null },
  };
}

function halfTex(src: Float32Array, w: number, h: number): DataTexture {
  const d = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) d[i] = DataUtils.toHalfFloat(src[i]);
  const t = new DataTexture(d, w, h, RGBAFormat, HalfFloatType);
  t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.colorSpace = NoColorSpace; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

/** Upload (or replace) the baked maps. */
export function setBake(shared: SurfaceShared, b: BakeResult): void {
  shared.uBakeLight.value?.dispose(); shared.uBakeGeo.value?.dispose();
  shared.uBakeLight.value = halfTex(b.light, b.nx, b.nz);
  shared.uBakeGeo.value = halfTex(b.geo, b.nx, b.nz);
  shared.uBakeOrigin.value.set(b.originX, b.originZ);
  shared.uBakeInv.value.set(1 / (b.nx * b.texel), 1 / (b.nz * b.texel));
}

export function macroTexture(data: Uint8ClampedArray, size: number): DataTexture {
  const t = new DataTexture(data as unknown as Uint8Array, size, size);
  t.wrapS = t.wrapT = RepeatWrapping; t.colorSpace = NoColorSpace;
  t.magFilter = LinearFilter; t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

/** Per-material macro amounts: grime, stains, wet gloss, world scale (1/m). */
export interface SurfaceOpts { grime: number; stain: number; wet: number; scale: number; bake: boolean }

const VERT_PARS = 'varying vec3 vBakeW;\nvarying vec3 vBakeN;\n';
const VERT_MAIN = `
  vec4 bakeWp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    bakeWp = instanceMatrix * bakeWp;
  #endif
  bakeWp = modelMatrix * bakeWp;
  vBakeW = bakeWp.xyz;
  vBakeN = normalize( mat3( modelMatrix ) * objectNormal );
`;
const FRAG_PARS = `
varying vec3 vBakeW;
varying vec3 vBakeN;
uniform sampler2D uBakeLight;
uniform sampler2D uBakeGeo;
uniform vec2 uBakeOrigin;
uniform vec2 uBakeInv;
uniform vec3 uBakeTint;
uniform float uBakeDirect;
uniform float uBakeBounce;
uniform float uBakeAo;
uniform float uPoolR;
uniform sampler2D uMacro;
uniform vec4 uMacroAmt;
`;
const FRAG_MACRO = `
  vec3 bakeMac = vec3( 0.5, 0.0, 0.0 );
  #ifdef USE_MACRO
  {
    vec3 mn = normalize( vBakeN );
    vec2 macUv = ( abs( mn.y ) > 0.5 ? vBakeW.xz : vec2( vBakeW.x + vBakeW.z, vBakeW.y * 1.7 ) ) * uMacroAmt.w;
    bakeMac = texture2D( uMacro, macUv ).rgb;
    // two scales so the macro map itself never reads as a repeat
    float g2 = texture2D( uMacro, macUv * 0.37 + 0.21 ).r;
    diffuseColor.rgb *= mix( 1.0, ( 0.7 + 0.6 * bakeMac.r ) * ( 0.85 + 0.3 * g2 ), uMacroAmt.x );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.74, 0.62, 0.42 ), clamp( bakeMac.g, 0.0, 1.0 ) * uMacroAmt.y );
  }
  #endif
`;
const FRAG_ROUGH = `
  #ifdef USE_MACRO
    roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.3, bakeMac.b * uMacroAmt.z );
  #endif
`;
const FRAG_LIGHT = `
  float bakeAo = 1.0;
  #if defined( RE_IndirectDiffuse ) && defined( USE_BAKE )
  {
    vec3 bn = normalize( vBakeN );
    vec4 bl = texture2D( uBakeLight, ( vBakeW.xz + bn.xz * 0.45 - uBakeOrigin ) * uBakeInv );
    vec4 bg = texture2D( uBakeGeo, ( vBakeW.xz + bn.xz * 0.12 - uBakeOrigin ) * uBakeInv );
    float H = max( bg.b, 0.5 ), y = vBakeW.y;
    float direct = bn.y > 0.5 ? bl.r : ( bn.y < -0.5 ? 0.0 : bl.g * ( 0.8 + 0.3 * clamp( y / H, 0.0, 1.0 ) ) );
    float far = smoothstep( uPoolR * 0.7, uPoolR * 1.1, distance( vBakeW.xz, cameraPosition.xz ) );
    float ao = 1.0;
    if ( bg.a > 0.5 ) {
      if ( abs( bn.y ) > 0.5 ) {
        float m = min( bg.r, bg.g );
        ao = smoothstep( 0.0, 0.8, m ) * 0.5 + 0.5;
        ao *= smoothstep( 0.0, 0.8, max( bg.r, bg.g ) ) * 0.25 + 0.75; // corners darker still
      } else {
        float side = abs( bn.x ) > 0.5 ? bg.g : bg.r;
        ao = ( smoothstep( 0.0, 0.7, side ) * 0.45 + 0.55 ) * ( smoothstep( 0.0, 0.6, y ) * 0.45 + 0.55 ) * ( smoothstep( 0.0, 0.5, H - y ) * 0.35 + 0.65 );
      }
    }
    ao = mix( 1.0, ao, uBakeAo );
    bakeAo = ao;
    irradiance += uBakeTint * ( direct * far * uBakeDirect + bl.b * uBakeBounce ) * ao;
  }
  #endif
`;
const FRAG_AFTER = `
  #ifdef USE_BAKE
    reflectedLight.directDiffuse *= mix( 1.0, bakeAo, 0.55 );
  #endif
`;

/** Patch a level material in place. Safe to call once per material; shares uniforms with every other surface. */
export function patchSurface(mat: Material, shared: SurfaceShared, o: SurfaceOpts): void {
  const macroAmt = { value: new Vector4(o.grime, o.stain, o.wet, o.scale) };
  const useMacro = !!shared.uMacro.value && (o.grime > 0 || o.stain > 0 || o.wet > 0);
  mat.defines = { ...(mat.defines ?? {}), ...(useMacro ? { USE_MACRO: '' } : {}), ...(o.bake ? { USE_BAKE: '' } : {}) };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { uMacroAmt: macroAmt });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${VERT_PARS}`).replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAG_MACRO}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <lights_fragment_end>', `${FRAG_LIGHT}\n#include <lights_fragment_end>\n${FRAG_AFTER}`);
  };
  mat.customProgramCacheKey = () => `surface:${useMacro ? 1 : 0}:${o.bake ? 1 : 0}`;
  mat.needsUpdate = true;
}
