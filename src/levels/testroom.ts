/**
 * The seeded test room: a compact complex whose spawn room is large enough to host a props
 * gallery (see levels/props.ts) that exercises lighting, materials, fog and input.
 */
import { generateGraphLevel } from '../gen/graph';
import type { LevelDef } from '../gen/types';

export const testroom: LevelDef = {
  id: 'testroom',
  name: 'Test Room',
  act: 0,
  tier: 'chill',
  dev: true,
  door: { color: '#6aa0ff', icon: 'T' },
  targetSeconds: [8, 600],
  intensity: 0,
  look: {
    walls: [['wallpaper', 0], ['concrete', 0], ['wallpaper', 3], ['tile', 0]], floor: ['carpet', 0], ceiling: ['ceiling', 0], trim: ['metal', 0],
    fogColor: 0x14110a, fogDensity: 0.022, ambient: 0x5a5030, ambientIntensity: 0.45, lampColor: 0xfff2c0,
    grade: { tint: [1.04, 1.0, 0.86], saturation: 1.05, contrast: 1.05 }, dust: 0xe0d0a0,
  },
  generate(seed) {
    return generateGraphLevel(seed, {
      levelId: 'testroom', tier: 'chill', width: 44, depth: 34, rooms: 6, minRoom: 9, maxRoom: 24,
      wallHeight: 3.2, locks: 0, loops: 0.3, variants: 4, nests: 0, loot: 6,
    });
  },
};
