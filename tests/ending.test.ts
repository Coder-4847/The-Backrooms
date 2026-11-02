import { describe, expect, it } from 'vitest';
import { BASE_STATE, resolveEnding, type EndingId, type EndingState } from '../src/story/endings';

const cases: [EndingId, Partial<EndingState>][] = [
  ['escape', {}],
  ['join', { acceptedArchitect: true }],
  ['join', { sanity: 0 }],
  ['sacrifice', { companionAlive: true, chosenStay: true }],
  ['loop', { refusedExit: true }],
  ['loop', { hasExitKey: false }],
  ['true', { anchorsFound: 5, trueDecision: true }],
  ['secret', { secretSequence: true }],
];

describe('ending resolver (skeleton)', () => {
  it.each(cases)('reaches %s', (id, patch) => { expect(resolveEnding({ ...BASE_STATE, ...patch })).toBe(id); });
  it('all six endings are reachable', () => {
    expect(new Set(cases.map(([, p]) => resolveEnding({ ...BASE_STATE, ...p })))).toEqual(new Set(['escape', 'join', 'sacrifice', 'loop', 'true', 'secret']));
  });
  it('true ending needs all anchors AND the decision', () => {
    expect(resolveEnding({ ...BASE_STATE, anchorsFound: 4, trueDecision: true })).toBe('escape');
    expect(resolveEnding({ ...BASE_STATE, anchorsFound: 5, trueDecision: false })).toBe('escape');
  });
  it('secret beats everything; low sanity escape falls back to the loop', () => {
    expect(resolveEnding({ ...BASE_STATE, secretSequence: true, acceptedArchitect: true, anchorsFound: 5, trueDecision: true })).toBe('secret');
    expect(resolveEnding({ ...BASE_STATE, sanity: 10 })).toBe('loop');
  });
});
