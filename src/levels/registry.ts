/**
 * The single `LEVELS` table (spec 5.11). The hub, validators, bot, debug console and saves all
 * read this. Adding a level = add one module and one line here.
 */
import type { LevelDef } from '../gen/types';
import { placeholder } from './placeholder';
import { testroom } from './testroom';

export const LEVELS: LevelDef[] = [testroom, placeholder];

export const levelById = (id: string): LevelDef | undefined => LEVELS.find((l) => l.id === id);

/** Campaign order = non-dev levels in registration order. */
export const campaignLevels = (): LevelDef[] => LEVELS.filter((l) => !l.dev);
