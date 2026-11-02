/** Placeholder level used to prove the generation + validation + bot pipeline end to end. */
import { generateGraphLevel } from '../gen/graph';
import type { LevelDef } from '../gen/types';

export const placeholder: LevelDef = {
  id: 'placeholder',
  name: 'Placeholder Complex',
  act: 0,
  tier: 'uneasy',
  dev: true,
  door: { color: '#c9b458', icon: '0' },
  targetSeconds: [90, 900],
  intensity: 0.3,
  look: {
    walls: [['wallpaper', 0], ['wallpaper', 1], ['wallpaper', 2], ['concrete', 0]], floor: ['carpet', 0], ceiling: ['ceiling', 0], trim: ['concrete', 1],
    fogColor: 0x1a1608, fogDensity: 0.028, ambient: 0x403818, ambientIntensity: 0.42, lampColor: 0xfff2c0,
    grade: { tint: [1.05, 1.0, 0.82], saturation: 1.05, contrast: 1.05 }, dust: 0xd8c890,
  },
  generate(seed) {
    return generateGraphLevel(seed, {
      levelId: 'placeholder', tier: 'uneasy', width: 64, depth: 52, rooms: 18, minRoom: 6, maxRoom: 16,
      wallHeight: 3, locks: 2, loops: 0.35, variants: 3, nests: 1, loot: 14,
    });
  },
};
