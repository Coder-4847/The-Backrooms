import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_ORDER, SCARE_MULTIPLIER, canChangeDifficulty, effectiveIntensity, waypointCountFor } from '../src/core/difficulty';

describe('difficulty table', () => {
  it('defines all five tiers with the spec ordering', () => {
    expect(DIFFICULTY_ORDER).toEqual(['easy', 'normal', 'hard', 'nightmare', 'hardcore']);
    for (const id of DIFFICULTY_ORDER) expect(DIFFICULTIES[id].id).toBe(id);
  });
  it('pressure never decreases as difficulty rises', () => {
    for (let i = 1; i < DIFFICULTY_ORDER.length; i++) {
      const a = DIFFICULTIES[DIFFICULTY_ORDER[i - 1]], b = DIFFICULTIES[DIFFICULTY_ORDER[i]];
      for (const k of ['hungerRate', 'entitySpeed', 'entityPerception', 'sanityDrain', 'batteryDrain', 'damageTaken', 'ambush'] as const) expect(b[k], k).toBeGreaterThanOrEqual(a[k]);
      for (const k of ['supply', 'tellTime', 'breather'] as const) expect(b[k], k).toBeLessThanOrEqual(a[k]);
    }
  });
  it('matches the spec on hunger, penalties and saves', () => {
    expect(DIFFICULTIES.easy.hungerRate).toBe(0);
    expect(DIFFICULTIES.easy.deathPenalty).toBe('keepAll');
    expect(DIFFICULTIES.normal.deathPenalty).toBe('loseUnsecured');
    expect(DIFFICULTIES.hard.deathPenalty).toBe('loseMost');
    expect(DIFFICULTIES.nightmare.deathPenalty).toBe('loseAllCarried');
    expect(DIFFICULTIES.hardcore.deathPenalty).toBe('permadeath');
    expect(DIFFICULTIES.hardcore.permadeath).toBe(true);
    expect(DIFFICULTIES.nightmare.manualSave).toBe('limitedPerLevel');
    expect(DIFFICULTIES.hardcore.manualSave).toBe('none');
    expect(DIFFICULTIES.hardcore.waypoints).toEqual([0, 0]);
  });
  it('waypoint counts follow the table (3 / 2-3 / 2 / 1-2 / 0)', () => {
    expect([waypointCountFor('easy', 0), waypointCountFor('easy', 1)]).toEqual([3, 3]);
    expect([waypointCountFor('normal', 0.2), waypointCountFor('normal', 0.9)]).toEqual([2, 3]);
    expect([waypointCountFor('hard', 0.2), waypointCountFor('hard', 0.9)]).toEqual([2, 2]);
    expect([waypointCountFor('nightmare', 0.2), waypointCountFor('nightmare', 0.9)]).toEqual([1, 2]);
    expect([waypointCountFor('hardcore', 0.2), waypointCountFor('hardcore', 0.9)]).toEqual([0, 0]);
  });
  it('difficulty can be lowered but never raised mid-run; hardcore is locked', () => {
    expect(canChangeDifficulty('hard', 'easy')).toBe(true);
    expect(canChangeDifficulty('easy', 'hard')).toBe(false);
    expect(canChangeDifficulty('hardcore', 'easy')).toBe(false);
    expect(canChangeDifficulty('nightmare', 'hardcore')).toBe(false);
    expect(canChangeDifficulty('hardcore', 'hardcore')).toBe(true);
  });
  it('scare intensity scales the level dial', () => {
    expect(effectiveIntensity(0.5, 'relaxed')).toBeLessThan(effectiveIntensity(0.5, 'standard'));
    expect(effectiveIntensity(0.5, 'brutal')).toBeGreaterThan(effectiveIntensity(0.5, 'standard'));
    expect(SCARE_MULTIPLIER.standard).toBe(1);
  });
});
