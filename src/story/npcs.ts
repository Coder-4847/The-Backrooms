/** Hub survivors (spec 8.4): short arcs, hints, small gifts. Dialogue is data; flags feed the save. */
export interface DialogueChoice { text: string; next?: string; /** set story flag(s) */ set?: Record<string, boolean | number>; give?: { item: string; n: number }; requireFlag?: string; once?: string }
export interface DialogueNode { text: string; choices: DialogueChoice[] }
export interface NpcDef { id: string; name: string; role: string; color: number; blip: number; start: string; nodes: Record<string, DialogueNode> }

const bye: DialogueChoice = { text: '(leave)' };

export const NPCS: Record<string, NpcDef> = {
  marlow: {
    id: 'marlow', name: 'Marlow Vance', role: 'Quartermaster', color: 0x8a7a4a, blip: 140, start: 'hello',
    nodes: {
      hello: { text: 'Another one. Good. Sit if you like; the chairs are real. Take a battery on your way out. I count what leaves, so do not take two.', choices: [
        { text: 'Who are you?', next: 'who' }, { text: 'Any advice for the Lobby?', next: 'advice' },
        { text: 'I will take that battery.', give: { item: 'battery', n: 1 }, once: 'marlow_battery', next: 'thanks' }, bye] },
      who: { text: 'Marlow. Quartermaster of what is left of Group 7. We were seven chairs once, you know. I only ever count six.', choices: [{ text: 'Seven?', next: 'seven' }, { text: 'Back.', next: 'hello' }] },
      seven: { text: 'The seventh chair was there when we started. Nobody sat in it. Nobody moved it, either. ...Forget I said that. Camcorder looks good on you.', choices: [{ text: 'Back.', next: 'hello' }] },
      advice: { text: 'Light is a friend. Quiet is a better one. If something tall stops moving, keep looking at it. If something with too many legs growls, you have a second. And lockers are for hiding. Somebody has to say it.', choices: [{ text: 'Thanks.', next: 'hello' }] },
      thanks: { text: 'Fine. I did not see that. Take care of it.', choices: [{ text: 'Back.', next: 'hello' }, bye] },
    },
  },
  ines: {
    id: 'ines', name: 'Ines Okoro', role: 'Radio operator', color: 0x5a7a8a, blip: 190, start: 'hello',
    nodes: {
      hello: { text: 'Shh. ...Okay, it passed. There is a rhythm under the static, every eleven minutes. Same shape as the fluorescent buzz. It is not noise. It is breathing.', choices: [
        { text: 'What does it want?', next: 'want' }, { text: 'Can the radio help me?', next: 'radio' },
        { text: 'Anything I can take?', give: { item: 'almond_water', n: 1 }, once: 'ines_water', next: 'water' }, bye] },
      want: { text: 'I do not know. I know it gets quieter when I stand near the red-light cameras. Whatever the Architect is, it does not like being watched.', choices: [{ text: 'Back.', next: 'hello' }] },
      radio: { text: 'Soon. When I fix the second dial you will be able to lure things with it. For now, it only tells me where not to go.', choices: [{ text: 'Back.', next: 'hello' }] },
      water: { text: 'Almond water. Do not ask who makes it. Drink it when your head gets loud.', choices: [{ text: 'Back.', next: 'hello' }, bye] },
    },
  },
  tobias: {
    id: 'tobias', name: 'Tobias Reed', role: 'Surveyor', color: 0x7a5a4a, blip: 110, start: 'hello',
    nodes: {
      hello: { text: 'I drew the maps. They are wrong by Tuesday. Level Zero does not hold still, so I stopped pretending it does. It still has a way out though. A wall that hums flat.', choices: [
        { text: 'The wall that hums?', next: 'wall' }, { text: 'Why did you leave the group once?', next: 'left' },
        { text: 'Got any spare crackers?', give: { item: 'cracker', n: 2 }, once: 'tobias_crackers', next: 'crackers' }, bye] },
      wall: { text: 'Follow the hum. Walk until the buzz splits in two. The flat one is the real one. Press it. Do not look back, the carpet will try.', choices: [{ text: 'Back.', next: 'hello' }] },
      left: { text: 'I wanted a way out that was not a wall. There is not one. Came back anyway. It is the only place I know where I am useful.', choices: [{ text: 'Back.', next: 'hello' }] },
      crackers: { text: 'Do not tell Marlow. He counts these.', choices: [{ text: 'Back.', next: 'hello' }, bye] },
    },
  },
  june: {
    id: 'june', name: 'June Ashdown', role: 'Cartographer', color: 0x6a8a7a, blip: 210, start: 'hello',
    nodes: {
      hello: { text: 'You found the Waystation. Good. Most people stop at the Lobby. I map what is left. The levels are not built, you know. They are drawn. Same hand, every time.', choices: [
        { text: 'Drawn by whom?', next: 'who' }, { text: 'Any tips for the Deep?', next: 'deep' },
        { text: 'Could you spare a flare?', give: { item: 'flare', n: 1 }, once: 'june_flare', next: 'flare' }, { text: '(leave)' }] },
      who: { text: 'The Architect. It builds the exits too, one per level, and then it waits at the last one. I think it is lonely. That should make it less frightening. It does not.', choices: [{ text: 'Back.', next: 'hello' }] },
      deep: { text: 'Level six is dark on purpose: walk toward the tone, crouch when the floor trembles. The flooded places want you to splash; do not. Garage smiles want you to stare; do not. Caves want a light; keep it on them.', choices: [{ text: 'Back.', next: 'hello' }] },
      flare: { text: 'Hounds scatter from those. The things below do not care.', choices: [{ text: 'Back.', next: 'hello' }, { text: '(leave)' }] },
    },
  },
};
