/** Entity definition table (spec 7). Behavior modules read these numbers; difficulty multiplies them. */
export interface EntityDef {
  id: string; name: string;
  behavior: 'stick' | 'hound';
  /** metres/second */
  walk: number; run: number;
  radius: number; height: number;
  sightRange: number; sightFov: number; // fov in radians (full cone)
  hearing: number;
  /** seconds of warning (tell) before an attack, scaled by difficulty tellTime */
  tell: number;
  damage: number;
  /** minimum seconds between hits */
  cooldown: number;
  packSize: [number, number];
}

export const ENTITIES: Record<string, EntityDef> = {
  stick: { id: 'stick', name: 'Stick', behavior: 'stick', walk: 1.0, run: 2.1, radius: 0.35, height: 2.8, sightRange: 22, sightFov: 2.2, hearing: 0.4, tell: 1.6, damage: 16, cooldown: 6, packSize: [1, 1] },
  hound: { id: 'hound', name: 'Hound', behavior: 'hound', walk: 1.7, run: 3.5, radius: 0.35, height: 0.9, sightRange: 13, sightFov: 2.0, hearing: 1.0, tell: 1.3, damage: 11, cooldown: 1.4, packSize: [2, 3] },
};
