/**
 * Ending resolver skeleton (spec 8.6). Pure function of flags/state so every ending is testable.
 * Phase 5 finalizes the content and conditions; the six outcomes and their precedence live here.
 */
export type EndingId = 'escape' | 'join' | 'sacrifice' | 'loop' | 'true' | 'secret';

export interface EndingState {
  reachedFinale: boolean;
  hasExitKey: boolean;
  sanity: number;
  acceptedArchitect: boolean;
  refusedExit: boolean;
  companionAlive: boolean;
  chosenStay: boolean;
  anchorsFound: number;
  trueDecision: boolean;
  secretSequence: boolean;
}

export const ANCHORS_NEEDED = 5;
export const ESCAPE_MIN_SANITY = 25;

/** Precedence: secret > true > join > sacrifice > loop > escape. */
export function resolveEnding(s: EndingState): EndingId {
  if (s.secretSequence) return 'secret';
  if (s.anchorsFound >= ANCHORS_NEEDED && s.trueDecision) return 'true';
  if (s.acceptedArchitect || s.sanity <= 0) return 'join';
  if (s.companionAlive && s.chosenStay) return 'sacrifice';
  if (s.refusedExit || !s.hasExitKey || s.sanity < ESCAPE_MIN_SANITY) return 'loop';
  return 'escape';
}

export const BASE_STATE: EndingState = {
  reachedFinale: true, hasExitKey: true, sanity: 80, acceptedArchitect: false, refusedExit: false,
  companionAlive: false, chosenStay: false, anchorsFound: 0, trueDecision: false, secretSequence: false,
};
