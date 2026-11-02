/** Entity definition table (spec 7). Behavior modules read these numbers; difficulty multiplies them. */
export interface EntityDef {
  id: string; name: string;
  behavior: 'stick' | 'hound' | 'howler' | 'coworker' | 'skinstealer' | 'concierge' | 'monitor' | 'companion' | 'lurker' | 'leviathan' | 'crawler' | 'smiler' | 'drowned' | 'leech' | 'static' | 'wraith' | 'partygoer' | 'stalker' | 'windowman' | 'echo' | 'curator' | 'pursuer' | 'architect';
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
  lurker: { id: 'lurker', name: 'The Lurker', behavior: 'lurker', walk: 1.1, run: 3.0, radius: 0.4, height: 2.0, sightRange: 0, sightFov: 0, hearing: 1.6, tell: 1.5, damage: 26, cooldown: 3, packSize: [1, 1] },
  leviathan: { id: 'leviathan', name: 'Leviathan', behavior: 'leviathan', walk: 1.6, run: 4.6, radius: 0.9, height: 3.5, sightRange: 0, sightFov: 0, hearing: 1.4, tell: 1.8, damage: 38, cooldown: 6, packSize: [1, 1] },
  crawler: { id: 'crawler', name: 'Cave Crawler', behavior: 'crawler', walk: 1.8, run: 4.2, radius: 0.3, height: 0.7, sightRange: 12, sightFov: 3.4, hearing: 1.1, tell: 0.9, damage: 7, cooldown: 0.9, packSize: [3, 5] },
  smiler: { id: 'smiler', name: 'Smiler', behavior: 'smiler', walk: 1.4, run: 3.4, radius: 0.35, height: 1.8, sightRange: 18, sightFov: 6.3, hearing: 0.3, tell: 1.4, damage: 20, cooldown: 4, packSize: [1, 2] },
  drowned: { id: 'drowned', name: 'The Drowned', behavior: 'drowned', walk: 1.2, run: 1.9, radius: 0.4, height: 1.8, sightRange: 12, sightFov: 3, hearing: 1.0, tell: 1.2, damage: 14, cooldown: 3, packSize: [1, 1] },
  leech: { id: 'leech', name: 'Sludge Leech', behavior: 'leech', walk: 0.9, run: 1.4, radius: 0.45, height: 0.5, sightRange: 8, sightFov: 6.3, hearing: 0.8, tell: 1.0, damage: 3, cooldown: 1, packSize: [1, 1] },
  static: { id: 'static', name: 'Static', behavior: 'static', walk: 1.4, run: 2.4, radius: 0.35, height: 1.9, sightRange: 16, sightFov: 6.3, hearing: 0.5, tell: 1.3, damage: 9, cooldown: 2.5, packSize: [1, 1] },
  faceling: { id: 'faceling', name: 'Faceling', behavior: 'skinstealer', walk: 1.1, run: 2.8, radius: 0.35, height: 1.7, sightRange: 16, sightFov: 3, hearing: 0.6, tell: 1.6, damage: 26, cooldown: 5, packSize: [1, 1] },
  wraith: { id: 'wraith', name: 'Platform Wraith', behavior: 'wraith', walk: 1.6, run: 3.3, radius: 0.35, height: 2.0, sightRange: 18, sightFov: 3.2, hearing: 1.2, tell: 1.0, damage: 18, cooldown: 3, packSize: [1, 1] },
  partygoer: { id: 'partygoer', name: 'Partygoer', behavior: 'partygoer', walk: 1.1, run: 2.5, radius: 0.35, height: 1.75, sightRange: 14, sightFov: 3, hearing: 0.6, tell: 0.9, damage: 9, cooldown: 1.6, packSize: [1, 1] },
  watcher: { id: 'watcher', name: 'Watcher', behavior: 'stick', walk: 0.9, run: 1.9, radius: 0.35, height: 1.8, sightRange: 20, sightFov: 3, hearing: 0.3, tell: 1.4, damage: 15, cooldown: 6, packSize: [1, 1] },
  stalker: { id: 'stalker', name: 'Whiteout Stalker', behavior: 'stalker', walk: 1.4, run: 2.7, radius: 0.4, height: 2.1, sightRange: 8, sightFov: 6.3, hearing: 0.8, tell: 1.4, damage: 22, cooldown: 5, packSize: [1, 1] },
  windowman: { id: 'windowman', name: 'Window-Man', behavior: 'windowman', walk: 1.0, run: 2.2, radius: 0.35, height: 1.9, sightRange: 22, sightFov: 3.4, hearing: 0.2, tell: 1.4, damage: 18, cooldown: 5, packSize: [1, 1] },
  echo: { id: 'echo', name: 'Motion Echo', behavior: 'echo', walk: 2.3, run: 4.0, radius: 0.3, height: 1.75, sightRange: 0, sightFov: 0, hearing: 0, tell: 1.0, damage: 40, cooldown: 6, packSize: [1, 1] },
  curator: { id: 'curator', name: 'The Curator', behavior: 'curator', walk: 1.2, run: 2.6, radius: 0.4, height: 2.3, sightRange: 40, sightFov: 6.3, hearing: 1, tell: 1.6, damage: 24, cooldown: 5, packSize: [1, 1] },
  pursuer: { id: 'pursuer', name: 'The Pursuer', behavior: 'pursuer', walk: 2.4, run: 2.7, radius: 0.9, height: 4.2, sightRange: 60, sightFov: 6.3, hearing: 1, tell: 1.2, damage: 100, cooldown: 6, packSize: [1, 1] },
  architect: { id: 'architect', name: 'The Architect', behavior: 'architect', walk: 0, run: 0, radius: 0.4, height: 2.4, sightRange: 30, sightFov: 6.3, hearing: 0, tell: 0, damage: 0, cooldown: 0, packSize: [1, 1] },
};
