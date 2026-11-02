/** Menu/hub panels for Phase 5: ending gallery, bestiary, achievements, how to play, credits, camcorder station. */
import { h } from './dom';
import { ENDING_TEXT, type EndingId } from '../story/endings';
import { ACHIEVEMENTS } from '../story/achievements';
import { ENTITIES } from '../entities/defs';
import type { Game } from '../core/game';

const ORDER: EndingId[] = ['escape', 'join', 'sacrifice', 'loop', 'true', 'secret'];
const HINT: Record<EndingId, string> = { escape: 'Leave with the exit key and your mind intact.', join: 'Accept what the Architect offers.', sacrifice: 'Someone you saved needs you to stay.', loop: 'Refuse the door.', true: '???', secret: '???' };

export function endingGalleryPanel(game: Game, close: () => void): HTMLElement {
  const seen = new Set(game.profile.endings);
  const root = h('div', { class: 'screen panel' }, h('h2', {}, 'Ending Gallery'), h('p', { class: 'muted' }, `${seen.size} of 6 seen`));
  for (const id of ORDER) {
    const t = ENDING_TEXT[id];
    root.append(seen.has(id) ? h('div', { class: 'slot' }, h('div', { class: 'slot-info' }, h('strong', {}, t.title), h('div', { class: 'note-text' }, t.text))) : h('div', { class: 'slot empty' }, h('div', { class: 'slot-info' }, h('strong', {}, '???'), h('div', { class: 'muted' }, HINT[id]))));
  }
  root.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Back')));
  return root;
}

export function bestiaryPanel(game: Game, close: () => void): HTMLElement {
  const b = game.profile.bestiary;
  const root = h('div', { class: 'screen panel' }, h('h2', {}, 'Bestiary'), h('p', { class: 'muted' }, `${Object.keys(b).length} of ${Object.keys(ENTITIES).filter((e) => e !== 'companion' && e !== 'coworker' && e !== 'architect').length} catalogued`));
  for (const def of Object.values(ENTITIES)) {
    if (def.id === 'companion' || def.id === 'coworker' || def.id === 'architect') continue;
    const e = b[def.id];
    root.append(e ? h('div', { class: 'slot' }, h('div', { class: 'slot-info' }, h('strong', {}, def.name), h('div', { class: 'muted' }, `encountered ${e.discovered}×`), ...e.learned.map((l) => h('div', {}, `· ${l}`)))) : h('div', { class: 'slot empty' }, h('div', { class: 'slot-info' }, h('strong', {}, '???'), h('div', { class: 'muted' }, 'Not yet seen.'))));
  }
  if (game.profile.endings.includes('join')) root.append(h('div', { class: 'slot' }, h('div', { class: 'slot-info' }, h('strong', {}, 'You'), h('div', { class: 'muted' }, 'A new silhouette. Tall, patient, drawn carefully.'))));
  root.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Back')));
  return root;
}

export function achievementsPanel(game: Game, close: () => void): HTMLElement {
  const got = new Set(game.profile.achievements);
  const root = h('div', { class: 'screen panel' }, h('h2', {}, 'Achievements'), h('p', { class: 'muted' }, `${got.size} of ${ACHIEVEMENTS.length}${game.profile.titles.length ? ` · titles: ${game.profile.titles.join(', ')}` : ''}`));
  for (const a of ACHIEVEMENTS) root.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, got.has(a.id) ? `✓ ${a.name}` : a.name, h('small', {}, got.has(a.id) || !a.id.startsWith('end_') ? a.desc : 'See this ending.'))));
  root.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Back')));
  return root;
}

export function howToPlayPanel(close: () => void): HTMLElement {
  return h('div', { class: 'screen panel' }, h('h2', {}, 'How to play'),
    h('p', {}, 'You are filming. Everything you need is in the dark, in the walls, and in what people left behind.'),
    h('ul', { class: 'howto' },
      h('li', {}, h('b', {}, 'Move / look: '), 'WASD and mouse, sticks, or the touch joystick. Sprint costs stamina; crouch is quiet.'),
      h('li', {}, h('b', {}, 'Light: '), 'G toggles the flashlight, V the camcorder night vision. Both have batteries. Shake the mouse to squeeze a little charge out of a low flashlight.'),
      h('li', {}, h('b', {}, 'Noise: '), 'Walls dampen it; doors and pipes carry it. Crouch, hold your breath (B) and throw things (T) to misdirect.'),
      h('li', {}, h('b', {}, 'Hide: '), 'Lockers and desks (E). Some things can still smell you.'),
      h('li', {}, h('b', {}, 'Every threat warns you: '), 'a growl, a bell, a tick, a tearing screen. Learn the tell and you can always act.'),
      h('li', {}, h('b', {}, 'Checkpoints: '), 'a tripod camcorder blinking red. Entities cannot enter. Rest, craft and save there.'),
      h('li', {}, h('b', {}, 'Survive: '), 'Almond water calms the mind; food, water, warmth and air matter in some places.'),
      h('li', {}, h('b', {}, 'Read everything: '), 'notes explain the rules of each place, and some of them are lies.')),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Back')));
}

export function creditsPanel(close: () => void): HTMLElement {
  return h('div', { class: 'screen center panel' }, h('h2', {}, 'NOCLIP'),
    h('p', {}, 'Design, code, procedural art, entities and synthesized audio: generated in code.'),
    h('p', { class: 'muted' }, 'Rendering by three.js. Everything else, from the wallpaper to the hum, is made from noise and math.'),
    h('p', { class: 'muted' }, 'Backrooms concepts come from community lore; all designs, names and text here are original implementations.'),
    h('p', { class: 'muted' }, 'Handwriting on the notes: Reenie Beanie by James Grieshaber (SIL Open Font License 1.1).'),
    h('button', { class: 'btn', onclick: close }, 'Back'));
}

const LENSES: { id: string; label: string; key: string; tint: [number, number, number]; sat: number }[] = [
  { id: 'standard', label: 'Standard lens', key: '', tint: [1, 1, 1], sat: 1 },
  { id: 'amber', label: 'Amber lens', key: 'lens:amber', tint: [1.1, 1.0, 0.82], sat: 1.05 },
  { id: 'mono', label: 'Monochrome lens', key: 'lens:mono', tint: [1, 1, 1], sat: 0 },
  { id: 'gold', label: 'Gold lens', key: 'lens:gold', tint: [1.15, 1.05, 0.78], sat: 1.15 },
];
export const lensById = (id: string) => LENSES.find((l) => l.id === id) ?? LENSES[0];

export function camcorderPanel(game: Game, close: () => void): HTMLElement {
  const root = h('div', { class: 'screen panel' }, h('h2', {}, 'Camcorder station'), h('p', { class: 'muted' }, 'Lenses are unlocked by finishing the game; some need harder runs.'));
  const cur = game.settings.value.lens;
  for (const l of LENSES) {
    const owned = !l.key || game.profile.cosmetics.includes(l.key);
    root.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, l.label, h('small', {}, owned ? (cur === l.id ? 'equipped' : 'available') : 'locked')),
      h('button', { class: 'btn small' + (cur === l.id ? ' primary' : ''), disabled: !owned, onclick: () => { game.settings.set('lens', l.id as never); game.gfx.setLens(lensById(l.id).tint, lensById(l.id).sat); close(); } }, 'Equip')));
  }
  root.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}
