/** Shared validator config: default seed count and per-level overrides. */
import type { ValidateOptions } from '../src/gen/validate';

export const DEFAULT_SEEDS = 150;

export function optionsFor(levelId: string): ValidateOptions {
  // The compact test room is a dev sandbox, so it only needs a minimum of one waypoint candidate.
  if (levelId === 'testroom') return { minWaypoints: 0 };
  return {};
}
