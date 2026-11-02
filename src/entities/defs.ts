/** Entity definition table (spec 7). Behavior modules read these numbers; difficulty multiplies them. */
export interface EntityDef {
  id: string; name: string;
  behavior: 'stick' | 'hound' | 'howler' | 'coworker' | 'skinstealer' | 'concierge' | 'monitor' | 'companion';
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
  howler: { id: 'howler', name: 'Howler', behavior: 'howler', walk: 1.2, run: 3.2, radius: 0.4, height: 1.9, sightRange: 0, sightFov: 0, hearing: 2.2, tell: 1.4, damage: 20, cooldown: 3, packSize: [1, 1] },
  coworker: { id: 'coworker', name: 'Coworker', behavior: 'coworker', walk: 1.0, run: 1.6, radius: 0.35, height: 1.75, sightRange: 12, sightFov: 3, hearing: 0.5, tell: 0, damage: 0, cooldown: 0, packSize: [1, 1] },
  skinstealer: { id: 'skinstealer', name: 'Skin-stealer', behavior: 'skinstealer', walk: 1.1, run: 2.7, radius: 0.35, height: 1.78, sightRange: 16, sightFov: 3, hearing: 0.6, tell: 1.6, damage: 24, cooldown: 5, packSize: [1, 1] },
  concierge: { id: 'concierge', name: 'The Concierge', behavior: 'concierge', walk: 1.4, run: 2.5, radius: 0.35, height: 2.1, sightRange: 40, sightFov: 6.3, hearing: 1, tell: 1.8, damage: 22, cooldown: 5, packSize: [1, 1] },
  monitor: { id: 'monitor', name: 'Hall Monitor', behavior: 'monitor', walk: 1.4, run: 3.0, radius: 0.35, height: 1.9, sightRange: 15, sightFov: 1.7, hearing: 0.8, tell: 1.2, damage: 14, cooldown: 2.5, packSize: [1, 1] },
  companion: { id: 'companion', name: 'Companion', behavior: 'companion', walk: 2.2, run: 3.8, radius: 0.35, height: 1.7, sightRange: 12, sightFov: 3, hearing: 0.5, tell: 0, damage: 0, cooldown: 0, packSize: [1, 1] },
};
