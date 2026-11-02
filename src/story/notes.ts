/** Notes, tapes and posters (spec 8.5). Data only; the journal groups them by level. Text is original. */
export interface NoteDef { id: string; level: string; title: string; kind: 'note' | 'tape' | 'poster' | 'graffiti'; text: string }

const N = (n: NoteDef): [string, NoteDef] => [n.id, n];

export const NOTES: Record<string, NoteDef> = Object.fromEntries([
  N({ id: 'l0_welcome', level: 'level0', title: 'Taped to a pillar', kind: 'note', text: 'If you are reading this you fell out of somewhere. Do not run. The carpet is always damp: that is normal. If the hum stops, that is not.\n\nGo toward the sound, not away from it.\n— M.V.' }),
  N({ id: 'l0_rules', level: 'level0', title: 'Rules, in marker', kind: 'poster', text: '1. LIGHT IS A FRIEND.\n2. IF IT STOPS WHEN YOU LOOK, KEEP LOOKING.\n3. WALK, DON\'T RUN, UNLESS YOU ARE RUNNING.\n4. LOCKERS ARE FOR HIDING. SOMEONE HAS TO SAY IT.' }),
  N({ id: 'l0_tape1', level: 'level0', title: 'Tape 01, Marlow', kind: 'tape', text: '[static] ...Day four. Counted forty-one rooms before the counting stopped meaning anything. Ines says the lights flicker in a pattern. Tobias says Ines needs sleep. Both are probably right.\n[static]' }),
  N({ id: 'l0_stick', level: 'level0', title: 'Field note: the tall one', kind: 'note', text: 'It only moves when you are not watching the corridor. Do not turn your back on a long hallway. Do not stare so long you forget to blink, either: that is how it learns your rhythm. A bright light makes it step back, once.' }),
  N({ id: 'l0_hounds', level: 'level0', title: 'Field note: dogs?', kind: 'note', text: 'Not dogs. They count your footsteps. Crouch, hold your breath, break the line of sight. If they growl, you have about a second. A flare scatters them. Do not test this twice.' }),
  N({ id: 'l0_wall', level: 'level0', title: 'Tobias, on the wall', kind: 'note', text: 'There is a wall that hums a half-step flat. It is the only honest one. Put your palm on it and push like you mean it. Then you are not here anymore. Do not ask me where "not here" is. I only draw the maps.' }),
  N({ id: 'l0_pim', level: 'level0', title: 'A drawing', kind: 'graffiti', text: '(a child\'s drawing of seven stick figures. One of them is crossed out. The seventh has no face, only a small red dot.)' }),
  N({ id: 'hub_board1', level: 'hub', title: 'Notice board: supply policy', kind: 'poster', text: 'ALMOND OUTPOST SUPPLY POLICY\nTake what you need. Leave what you do not. If you find a battery, you did not find it; the Outpost did.\n— M.V.' }),
  N({ id: 'hub_board2', level: 'hub', title: 'Notice board: Ines', kind: 'poster', text: 'The radio picks up a rhythm every eleven minutes. If anyone hears it in person, tell me before you tell anyone else.' }),
  N({ id: 'hub_tape', level: 'hub', title: 'Tape 00, unlabeled', kind: 'tape', text: '[static] ...whoever carries this camera, we left the seventh chair empty on purpose. Please sit down when you are ready. [static]' }),
]);

export const LEVEL_NOTES = (level: string): NoteDef[] => Object.values(NOTES).filter((n) => n.level === level);
