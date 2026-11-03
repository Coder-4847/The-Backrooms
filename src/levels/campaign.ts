/** The 25-level campaign table (spec 8.2). Levels play in this order; the replay menu lists the ones a save has reached. */
export interface CampaignEntry { id: string; name: string; act: 1 | 2 | 3; tier: 'chill' | 'uneasy' | 'tense' | 'horror'; color: string }

const E = (id: string, name: string, act: 1 | 2 | 3, tier: CampaignEntry['tier'], color: string): CampaignEntry => ({ id, name, act, tier, color });

export const CAMPAIGN: CampaignEntry[] = [
  E('level0', 'Level 0: The Lobby', 1, 'uneasy', '#d8c43c'), E('level1', 'Level 1: Habitable Zone', 1, 'uneasy', '#9a9a90'), E('level2', 'Level 2: Pipe Dreams', 1, 'tense', '#c97a3a'),
  E('level3', 'Level 3: Electrical Station', 1, 'chill', '#5aa0e0'), E('level4', 'Level 4: Abandoned Offices', 1, 'tense', '#a8b0a0'), E('level5', 'Level 5: Terror Hotel', 1, 'tense', '#8a2a3a'),
  E('schoolhouse', 'Schoolhouse', 1, 'uneasy', '#7a9a6a'),
  E('level6', 'Level 6: Lights Out', 2, 'horror', '#202020'), E('level7', 'Level 7: Thalassophobia', 2, 'tense', '#2a5a7a'), E('level8', 'Level 8: Cave System', 2, 'tense', '#4a6a5a'),
  E('garage', 'The Garage', 2, 'horror', '#d88a2a'), E('level37', 'Level 37: Poolrooms', 2, 'chill', '#6ad8d0'), E('sewers', 'Sewers', 2, 'tense', '#5a6a3a'),
  E('hospital', 'Hospital', 2, 'horror', '#a8d0c8'), E('serverfarm', 'Server Farm', 2, 'tense', '#3a8aa8'),
  E('metro', 'Metro', 3, 'uneasy', '#8a8aa8'), E('carnival', 'Carnival', 3, 'tense', '#d85a8a'), E('suburbs', 'Suburbs', 3, 'tense', '#a8c06a'),
  E('wheatfield', 'Wheat Field', 3, 'uneasy', '#d8c060'), E('arctic', 'Arctic Station', 3, 'horror', '#c8e0f0'), E('city', 'Endless City', 3, 'uneasy', '#7a8aa0'),
  E('level94', 'Level 94: Motion', 3, 'tense', '#b0b0c0'), E('gallery', 'Level 188: The Gallery', 3, 'horror', '#8a6a3a'), E('chase', 'Run for Your Life', 3, 'horror', '#c0301a'),
  E('finale', 'The Finale', 3, 'tense', '#f0f0f0'),
];

export const campaignIndex = (id: string): number => CAMPAIGN.findIndex((c) => c.id === id);
