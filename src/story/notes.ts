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
  N({ id: 'l1_camp', level: 'level1', title: "Camp sign", kind: 'poster', text: "HABITABLE ZONE\nSURVIVORS' CAMP: 3 steps past the forklift. Knock twice. If you hear a third knock, do not open.\nBring batteries. Bring anything that rattles." }),
  N({ id: 'l1_hounds', level: 'level1', title: "Pim's diary", kind: 'note', text: "Day 19. The dogs stay out of the light. They hate flares. I traded my last two for a radio that only plays static. I think the static is a language." }),
  N({ id: 'l1_supply', level: 'level1', title: 'Supply run checklist', kind: 'note', text: '1. Batteries  2. Cans (and an opener!)  3. Rope  4. Something that makes noise far away.\nTHE DOGS FOLLOW NOISE. USE THAT.' }),
  N({ id: 'l1_forklift', level: 'level1', title: 'Scratched into a rack', kind: 'graffiti', text: 'IF YOU CAN HEAR THEM BREATHING, YOU ARE ALREADY IN THEIR ROOM.' }),
  N({ id: 'l2_pipes', level: 'level2', title: 'Pipe log', kind: 'note', text: 'Every pipe here carries sound. A dropped wrench in the east tunnel is a gunshot in the west. The thing that listens at the end of the line does not see. Do not breathe loudly.' }),
  N({ id: 'l2_howler', level: 'level2', title: 'Field note: the Howler', kind: 'note', text: 'It screams when it hears you, and the scream tells everything else where you are. Stand still. Crouch. Hold your breath. Throw something far to make it walk the other way.' }),
  N({ id: 'l2_valves', level: 'level2', title: "Foreman's scrawl", kind: 'poster', text: "THE VALVES ARE SET BY THE TAG. ALL THREE OR NOTHING OPENS. I TRIED GUESSING. IT TOOK THREE HOURS AND ONE FINGER." }),
  N({ id: 'l2_steam', level: 'level2', title: 'Maintenance memo', kind: 'note', text: 'Steam is only steam. If it screams, it is not steam.' }),
  N({ id: 'l3_power', level: 'level3', title: 'Station manual, page 4', kind: 'note', text: 'Three transformer bays, three fuses (red, blue, white). Restore them in any order, but restore them. The big room behind the last bay was the stockroom. It still has everything.' }),
  N({ id: 'l3_quiet', level: 'level3', title: 'A sticky note', kind: 'note', text: 'Nothing lives here. I checked. Twice. That is the scary part.' }),
  N({ id: 'l3_arc', level: 'level3', title: 'Warning placard', kind: 'poster', text: 'ARC FLASH HAZARD. THE LIGHTS WILL FLICKER WHEN THE LINE REROUTES. THIS IS NORMAL. DO NOT STARE.' }),
  N({ id: 'l4_cork', level: 'level4', title: 'Corkboard flyer', kind: 'poster', text: 'EMPLOYEE VERIFICATION: Ask any coworker who looks unfamiliar for the badge number printed on the corkboard in the break room. Real staff know it.' }),
  N({ id: 'l4_memo', level: 'level4', title: 'Memo from HR', kind: 'note', text: 'Reminder: we do not have a Frank. If a Frank introduces himself, leave the floor.' }),
  N({ id: 'l4_shadow', level: 'level4', title: "Handwritten warning", kind: 'note', text: "Look at its shadow. A real person's shadow keeps up. The thing wearing Dave drags his half a second late. Shine a light on it and keep it there." }),
  N({ id: 'l4_elevator', level: 'level4', title: 'Elevator panel', kind: 'graffiti', text: 'THIS ELEVATOR LIES. TAKE THE STAIRS.' }),
  N({ id: 'l5_welcome', level: 'level5', title: 'Front desk, laminated', kind: 'poster', text: 'WELCOME TO THE HOTEL. Please read the posted rules. Some may no longer apply. Management is not responsible for the others.' }),
  N({ id: 'l5_guest1', level: 'level5', title: 'Guest register, scrap 1', kind: 'note', text: 'The man in 214 ran down the hall to catch the ice machine. We found his shoes.' }),
  N({ id: 'l5_guest2', level: 'level5', title: 'Guest register, scrap 2', kind: 'note', text: 'The woman in 307 walked the whole night with a flashlight and was perfectly fine. The desk bell was silent.' }),
  N({ id: 'l5_guest3', level: 'level5', title: 'Guest register, scrap 3', kind: 'note', text: 'The couple in 119 were loud all night. Nothing happened. We should have expected that.' }),
  N({ id: 'l5_bell', level: 'level5', title: 'Front desk memo', kind: 'note', text: 'If you hear the bell, he has already decided. Keep walking. He is slower than you. He is not slower than a mistake.' }),
  N({ id: 'sc_hall', level: 'schoolhouse', title: 'Hallway banner', kind: 'poster', text: 'HALL PASSES MUST BE CARRIED AT ALL TIMES. NO PASS, NO CORRIDOR.' }),
  N({ id: 'sc_monitor', level: 'schoolhouse', title: 'Student handbook, torn page', kind: 'note', text: 'The monitor does not chase if you have a pass. It looks at it for a long time. It does not like to be looked at while it looks.' }),
  N({ id: 'sc_forge', level: 'schoolhouse', title: "Chalkboard", kind: 'poster', text: "PAPER + MARKER = PASS. (ASK ME HOW I KNOW. DON'T.)" }),
  N({ id: 'sc_gym', level: 'schoolhouse', title: 'Gym whiteboard', kind: 'note', text: 'The exit is where the bell is loudest.' }),
  N({ id: 'hub_board1', level: 'hub', title: 'Notice board: supply policy', kind: 'poster', text: 'ALMOND OUTPOST SUPPLY POLICY\nTake what you need. Leave what you do not. If you find a battery, you did not find it; the Outpost did.\n— M.V.' }),
  N({ id: 'hub_board2', level: 'hub', title: 'Notice board: Ines', kind: 'poster', text: 'The radio picks up a rhythm every eleven minutes. If anyone hears it in person, tell me before you tell anyone else.' }),
  N({ id: 'hub_tape', level: 'hub', title: 'Tape 00, unlabeled', kind: 'tape', text: '[static] ...whoever carries this camera, we left the seventh chair empty on purpose. Please sit down when you are ready. [static]' }),
]);

export const LEVEL_NOTES = (level: string): NoteDef[] => Object.values(NOTES).filter((n) => n.level === level);
