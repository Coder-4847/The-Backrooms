/** Shared services handed to scenes so they never import the Game class (avoids cycles). */
import type { Gfx } from '../render/gfx';
import type { TierDef } from '../render/quality';
import type { WorkerPool } from '../gen/pool';
import type { SettingsStore } from './settings';
import type { InputManager } from './input/manager';
import type { AudioEngine } from '../audio/engine';
import type { Sounds } from '../audio/sounds';

export interface Services {
  gfx: Gfx;
  pool: WorkerPool;
  settings: SettingsStore;
  input: InputManager;
  audio: () => AudioEngine | null;
  sounds: () => Sounds | null;
  tier: () => TierDef;
  basePath: string;
}
