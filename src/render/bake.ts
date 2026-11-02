/**
 * Light baking (the "static lighting" pass of a real engine, done in a few ms at load):
 * a top-down irradiance map of the whole level from EVERY ceiling light, plus a geometry map used
 * for analytic corner AO. Sampled in the surface shaders (see materials.ts `patchSurface`), so far
 * rooms are lit by their own lamps and get bounce light even though only a handful of real-time
 * lights exist near the player. Pure (no THREE): runs in Node tests too.
 *
 * light map (RGBA float): R = floor irradiance from lamps, G = wall irradiance, B = bounce (indirect), A = 1
 * geo map (RGBA float):   R = distance to nearest x-facing wall (m), G = to nearest z-facing wall,
 *                         B = ceiling height (m), A = 1 inside an enclosed room (0 outdoors / void)
 */
import type { LevelPlan } from '../gen/types';
import type { LightDef } from '../gen/mesher';

export interface BakeResult {
  originX: number; originZ: number; texel: number; nx: number; nz: number;
  light: Float32Array; geo: Float32Array;
}

/** Point-light intensity of a ceiling lamp (matches LightPool's base intensity). */
export const LAMP_CANDELA = 9;

export function bakeLighting(plan: LevelPlan, lamps: LightDef[], texel = 0.25): BakeResult {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of plan.rooms) { x0 = Math.min(x0, r.x); z0 = Math.min(z0, r.z); x1 = Math.max(x1, r.x + r.w); z1 = Math.max(z1, r.z + r.d); }
  if (!Number.isFinite(x0)) { x0 = z0 = 0; x1 = z1 = 1; }
  // keep the map <= 1024 texels per side
  texel = Math.max(texel, (x1 - x0 + 2) / 1024, (z1 - z0 + 2) / 1024);
  const originX = x0 - 1, originZ = z0 - 1;
  const nx = Math.ceil((x1 - x0 + 2) / texel), nz = Math.ceil((z1 - z0 + 2) / texel);
  const light = new Float32Array(nx * nz * 4), geo = new Float32Array(nx * nz * 4);

  // lamps per room
  const byRoom = new Map<number, LightDef[]>();
  for (const l of lamps) if (!l.broken) (byRoom.get(l.room) ?? byRoom.set(l.room, []).get(l.room)!).push(l);

  // first-bounce estimate per room: rho * flux / (area * (1 - rho)), then a share leaks to neighbours through doors
  const RHO = 0.42;
  const own = new Float32Array(plan.rooms.length);
  for (const r of plan.rooms) {
    const L = byRoom.get(r.id) ?? [];
    const flux = L.reduce((n, l) => n + 4 * Math.PI * LAMP_CANDELA * l.intensity * 0.5, 0); // half the flux goes up into the fixture
    const area = r.open ? r.w * r.d : 2 * r.w * r.d + 2 * (r.w + r.d) * r.height;
    own[r.id] = (RHO * flux) / (Math.max(1, area) * (1 - RHO));
  }
  const bounce = Float32Array.from(own);
  for (const c of plan.connections) {
    const ra = plan.rooms[c.a], rb = plan.rooms[c.b];
    const share = Math.min(1, (c.width * 2.2) / Math.max(1, Math.min(ra.w * ra.height, rb.w * rb.height))) * 0.6;
    bounce[c.a] += own[c.b] * share; bounce[c.b] += own[c.a] * share;
  }

  for (const r of plan.rooms) {
    const L = byRoom.get(r.id) ?? [];
    const H = r.height;
    // texels whose centre lies inside the room (each centre belongs to exactly one room)
    const ia = Math.max(0, Math.ceil((r.x - originX) / texel - 0.5)), ib = Math.min(nx - 1, Math.floor((r.x + r.w - originX) / texel - 0.5));
    const ja = Math.max(0, Math.ceil((r.z - originZ) / texel - 0.5)), jb = Math.min(nz - 1, Math.floor((r.z + r.d - originZ) / texel - 0.5));
    for (let j = ja; j <= jb; j++) {
      const pz = originZ + (j + 0.5) * texel;
      const cz = Math.min(r.z + r.d - 0.11, Math.max(r.z + 0.11, pz)); // clamp border texels inside: no light leaking under walls
      for (let i = ia; i <= ib; i++) {
        const px = originX + (i + 0.5) * texel;
        const cx = Math.min(r.x + r.w - 0.11, Math.max(r.x + 0.11, px));
        let floorE = 0, wallE = 0, near = 0;
        for (const l of L) {
          const dx = cx - l.x, dz = cz - l.z, h = l.y - 0.05, h2 = h * h;
          const r2 = dx * dx + dz * dz;
          const I = LAMP_CANDELA * l.intensity;
          floorE += (I * h) / Math.pow(r2 + h2, 1.5);                       // E = I cos(theta) / d^2 on the floor
          const hm = h * 0.5;                                               // wall: mid-height, light arriving sideways
          wallE += (I * Math.sqrt(r2 + 0.05)) / Math.pow(r2 + hm * hm + 0.05, 1.5) * 0.9;
          near += Math.exp(-r2 / 30);
        }
        const k = (j * nx + i) * 4;
        const b = bounce[r.id] * (0.75 + 0.25 * Math.min(1, near));
        if (!r.open) { light[k] = floorE; light[k + 1] = wallE; }
        light[k + 2] = b; light[k + 3] = 1;
        geo[k] = r.open ? 8 : Math.max(0, Math.min(px - r.x, r.x + r.w - px) - 0.1);
        geo[k + 1] = r.open ? 8 : Math.max(0, Math.min(pz - r.z, r.z + r.d - pz) - 0.1);
        geo[k + 2] = H; geo[k + 3] = r.open ? 0 : 1;
      }
    }
  }
  return { originX, originZ, texel, nx, nz, light, geo };
}
