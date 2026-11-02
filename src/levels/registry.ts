/**
 * The single `LEVELS` table (spec 5.11). The hub, validators, bot, debug console and saves all
 * read this. Adding a level = add one module and one line here.
 */
import type { LevelDef } from '../gen/types';
import { placeholder } from './placeholder';
import { testroom } from './testroom';
import { level0 } from './level0';
import { act1Levels } from './act1';
import { act2Levels } from './act2';
import { act3Levels } from './act3';

export const LEVELS: LevelDef[] = [level0, ...act1Levels, ...act2Levels, ...act3Levels, testroom, placeholder];

export const levelById = (id: string): LevelDef | undefined => LEVELS.find((l) => l.id === id);

/** Campaign order = non-dev levels in registration order. */
export const campaignLevels = (): LevelDef[] => LEVELS.filter((l) => !l.dev);

export { CAMPAIGN, campaignIndex } from './campaign';
/** A campaign level is playable once its generator is registered. */
export const isImplemented = (id: string): boolean => LEVELS.some((l) => l.id === id && !l.dev);
