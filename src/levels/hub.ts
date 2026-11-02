/**
 * The Central Hub (spec 5.11): a long walkable tunnel with a door for each of the 25 levels, three
 * wings (Almond Outpost, The Waystation, The Gantry), and a calm, safe feel. The layout *function*
 * is fixed for clarity (tunnel, wings, door order); only dressing is seeded. The tunnel visibly
 * extends as the campaign frontier advances. Doors are alcoves on both sides of the tunnel.
 */
import { buildNav } from '../gen/graph';
import { Rng, deriveSeed } from '../gen/rng';
import { LEVEL_NOTES } from '../story/notes';
import type { Connection, HubData, LevelDef, LevelPlan, Room } from '../gen/types';

export const HUB_DOOR_SPACING = 4.5;
export const TOTAL_DOORS = 25;

/** How many doors are shown for a frontier (reached + a few sealed teasers). */
export const visibleDoors = (frontier: number): number => Math.min(TOTAL_DOORS, frontier + 4);

export function generateHub(seed: number, frontier = 0): LevelPlan {
  const rng = new Rng(deriveSeed(seed, 'hub'));
  const doorsShown = visibleDoors(frontier);
  const perSide = Math.ceil(doorsShown / 2);
  const tunnelLen = 12 + perSide * HUB_DOOR_SPACING;
  const H = 3.4;
  const rooms: Room[] = [];
  const add = (x: number, z: number, w: number, d: number, kind: Room['kind'], variant = 0, height = H): Room => {
    const r: Room = { id: rooms.length, x, z, w, d, kind, height, variant };
    rooms.push(r); return r;
  };
  const tunnel = add(0, 0, tunnelLen, 6, 'hall', 0, 3.8);
  const outpost = add(-26, -4, 26, 14, 'supply', 1);
  const stash = add(-26, 10, 14, 10, 'supply', 1);
  const board = add(-12, 10, 12, 10, 'supply', 1);
  const way = add(tunnelLen, -4, 18, 14, 'hall', 2);
  const gantry = add(tunnelLen + 18, -4, 18, 14, 'hall', 3);

  const conns: Connection[] = [];
  const link = (a: Room, b: Room, door: { x: number; z: number }, axis: 'x' | 'z', width = 2): void => {
    conns.push({ id: conns.length, a: a.id, b: b.id, door, axis, width, lock: null });
  };
  link(outpost, tunnel, { x: 0, z: 3 }, 'z', 3);
  link(stash, outpost, { x: -19, z: 10 }, 'x', 2.4);
  link(board, outpost, { x: -6, z: 10 }, 'x', 2.4);
  link(tunnel, way, { x: tunnelLen, z: 3 }, 'z', 3);
  link(way, gantry, { x: tunnelLen + 18, z: 3 }, 'z', 3);

  // level doors: alcoves 3.4 m wide alternate north/south of the tunnel
  const doors: HubData['doors'] = [];
  for (let i = 0; i < doorsShown; i++) {
    const side = i % 2 === 0 ? 'N' : 'S';
    const slot = Math.floor(i / 2);
    const cx = 8 + slot * HUB_DOOR_SPACING + 1.7;
    const alc = side === 'N' ? add(cx - 1.7, -4, 3.4, 4, 'dead', i % 4, 3.4) : add(cx - 1.7, 6, 3.4, 4, 'dead', i % 4, 3.4);
    link(alc, tunnel, { x: cx, z: side === 'N' ? 0 : 6 }, 'x', 2.2);
    doors.push({ index: i, room: alc.id, pos: { x: cx, z: side === 'N' ? -3.2 : 9.2 }, yaw: side === 'N' ? Math.PI : 0, side });
  }

  const stations: HubData['stations'] = [
    { kind: 'stash', room: stash.id, pos: { x: -24.4, z: 15 }, yaw: -Math.PI / 2 },
    { kind: 'crafting', room: stash.id, pos: { x: -19, z: 18.4 }, yaw: 0 },
    { kind: 'noteboard', room: board.id, pos: { x: -6, z: 18.6 }, yaw: 0 },
    { kind: 'bestiary', room: board.id, pos: { x: -10.6, z: 15 }, yaw: -Math.PI / 2 },
    { kind: 'gallery', room: board.id, pos: { x: -1.4, z: 15 }, yaw: Math.PI / 2 },
    { kind: 'kitchen', room: outpost.id, pos: { x: -24.2, z: 3 }, yaw: -Math.PI / 2 },
    { kind: 'camcorder', room: outpost.id, pos: { x: -13, z: -2.4 }, yaw: Math.PI },
  ];
  const npcs: HubData['npcs'] = [
    { id: 'marlow', pos: { x: -6, z: 2 }, yaw: Math.PI / 2 },
    { id: 'ines', pos: { x: -20, z: -1.5 }, yaw: 0 },
    { id: 'tobias', pos: { x: -14, z: 15 }, yaw: Math.PI / 2 },
  ];
  const gates: HubData['gates'] = [
    { act: 2, box: { x0: tunnelLen - 0.1, x1: tunnelLen + 0.1, z0: 1.5, z1: 4.5 } },
    { act: 3, box: { x0: tunnelLen + 17.9, x1: tunnelLen + 18.1, z0: 1.5, z1: 4.5 } },
  ];

  const items = LEVEL_NOTES('hub').map((n, i) => ({ id: `hubnote${i}`, item: n.id, kind: 'note' as const, room: board.id, pos: { x: -9 + i * 3 + rng.range(-0.3, 0.3), z: 12 } }));
  const spawnPos = { x: 6, z: 3 };
  const wayEnd = rooms[way.id];

  return {
    levelId: 'hub', seed, tier: 'chill', bounds: { x0: -26, z0: -4, x1: tunnelLen + 36, z1: 20 },
    rooms, connections: conns, spawn: { room: tunnel.id, pos: spawnPos }, exit: { room: wayEnd.id, pos: { x: wayEnd.x + 9, z: 3 } },
    criticalPath: [tunnel.id, way.id], waypoints: [], items, hides: [], entitySlots: [],
    nav: buildNav(rooms, conns), estSeconds: 60, size: 0.2,
    hub: { doors, stations, npcs, gates, tunnelRoom: tunnel.id },
  };
}

export const hubDef: LevelDef = {
  id: 'hub', name: 'The Central Hub', act: 0, tier: 'chill', dev: true,
  door: { color: '#9ccf9a', icon: 'H' }, targetSeconds: [1, 9999], intensity: 0,
  look: {
    walls: [['concrete', 0], ['wallpaper', 1], ['concrete', 0], ['wallpaper', 3]], floor: ['tile', 0], ceiling: ['ceiling', 0], trim: ['metal', 0],
    fogColor: 0x0e1210, fogDensity: 0.016, ambient: 0x7a8a6c, ambientIntensity: 0.62, lampColor: 0xffe9b0,
    grade: { tint: [1.0, 1.02, 0.94], saturation: 0.96, contrast: 1.04 }, dust: 0xcfd8b8,
  },
  generate(seed, params) { return generateHub(seed, Number(params?.frontier ?? 0)); },
};
