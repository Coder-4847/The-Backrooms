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

export const ENDING_TEXT: Record<EndingId, { title: string; text: string }> = {
  escape: { title: 'Escape', text: 'The door opens onto daylight, ordinary and slightly too bright. Your camcorder keeps recording. In the corner of the frame, a seventh chair is empty. You do not mention it.' },
  join: { title: 'Join the Backrooms', text: 'You accept the pencil. The hum steadies. Somewhere a new corridor is drawn, and it is very good. The Bestiary adds a silhouette. It is yours.' },
  sacrifice: { title: 'Sacrifice', text: 'You hold the door while Pim runs. The Architect watches, interested. Pim does not look back. That is the kindest thing anyone does in this place.' },
  loop: { title: 'Loop', text: 'You decline. The lights flicker. You wake on damp carpet under a buzzing fluorescent, certain you have forgotten something important. A note taped to the pillar says: go toward the sound.' },
  true: { title: 'The True Ending', text: 'You lay five anchors on the table. The drawing wavers, and for a moment the Backrooms are only a sketch. The Architect puts down the pencil. Nothing here was ever built; it was only remembered.' },
  secret: { title: 'Secret', text: 'You knock three times on the wall that hums flat. It knocks back, once, as if surprised.' },
};
