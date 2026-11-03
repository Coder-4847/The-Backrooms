/**
 * In-game panels: inventory (grid, drag and drop, hotbar assignment), journal, replay-a-level, note reader,
 * crafting. Real buttons everywhere so keyboard, gamepad focus and touch all work.
 */
import { h, clear } from './dom';
import { GRID_H, GRID_W, type Stack } from '../systems/inventory';
import { itemDef } from '../systems/items';
import { NOTES } from '../story/notes';
import { CAMPAIGN } from '../levels/campaign';
import { reachedLevelIndexes } from '../levels/registry';
import type { SlotData } from '../core/save';
import { DIFFICULTIES, DIFFICULTY_ORDER, type DifficultyId } from '../core/difficulty';
import { fmtTime } from './dom';
import { RECIPES, canCraft, craft, discover } from '../systems/crafting';
import { randomSeedString } from '../gen/rng';
import type { Game } from '../core/game';

const CELL = 58;

export function inventoryPanel(game: Game, close: () => void): HTMLElement {
  const sim = game.level!.sim;
  const inv = sim.inv;
  let sel: Stack | null = null;
  const root = h('div', { class: 'screen panel inv' });
  const detail = h('div', { class: 'inv-detail' });
  const grid = h('div', { class: 'inv-grid', style: `width:${GRID_W * CELL}px;height:${GRID_H * CELL}px` });
  const hot = h('div', { class: 'inv-hot' });
  const stats = h('div', { class: 'muted' });

  const paint = () => {
    clear(grid);
    for (let i = 0; i < GRID_W * GRID_H; i++) grid.append(h('i', { class: 'cell' }));
    for (const s of inv.stacks) {
      const d = itemDef(s.id);
      const b = h('button', { class: 'stack' + (sel === s ? ' sel' : ''), style: `left:${s.x * CELL}px;top:${s.y * CELL}px;width:${d.w * CELL - 4}px;height:${d.h * CELL - 4}px` }, d.name, s.n > 1 ? h('b', {}, `×${s.n}`) : null);
      b.addEventListener('click', () => { sel = s; paint(); });
      b.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const r = grid.getBoundingClientRect(); const ox = e.clientX - r.left - s.x * CELL, oy = e.clientY - r.top - s.y * CELL;
        let moved = false;
        const move = (ev: PointerEvent) => { moved = true; b.style.left = `${ev.clientX - r.left - ox}px`; b.style.top = `${ev.clientY - r.top - oy}px`; b.classList.add('drag'); };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          if (moved) { const cx = Math.round((ev.clientX - r.left - ox) / CELL), cy = Math.round((ev.clientY - r.top - oy) / CELL); inv.move(s, cx, cy); }
          paint();
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      });
      grid.append(b);
    }
    clear(hot);
    inv.hotbar.forEach((id, i) => hot.append(h('button', { class: 'hslot' + (inv.selected === i ? ' on' : ''), onclick: () => { if (sel && id !== sel.id) { inv.hotbar[i] = sel.id; } inv.selected = i; paint(); } }, h('small', {}, String(i + 1)), id ? itemDef(id).name : '—', id && inv.count(id) > 1 ? ` ×${inv.count(id)}` : '')));
    clear(detail);
    if (sel && inv.stacks.includes(sel)) {
      const d = itemDef(sel.id);
      detail.append(h('h3', {}, d.name), h('p', {}, d.desc), h('p', { class: 'muted' }, `${d.w}×${d.h} cells · ${d.weight.toFixed(1)} kg each`),
        h('div', { class: 'btn-row' },
          d.use ? h('button', { class: 'btn small primary', onclick: () => { const i = inv.hotbar.indexOf(sel!.id); inv.selected = i >= 0 ? i : inv.selected; if (i < 0) inv.hotbar[inv.selected] = sel!.id; sim.useHeld(); if (!inv.has(sel!.id)) sel = null; paint(); } }, 'Use') : null,
          h('button', { class: 'btn small danger', onclick: () => { inv.remove(sel!.id, 1); if (!inv.has(sel!.id)) sel = null; paint(); } }, 'Drop one')));
    } else detail.append(h('p', { class: 'muted' }, 'Select an item. Drag to rearrange. Click a hotbar slot to assign the selected item.'));
    stats.textContent = `Weight ${inv.weight.toFixed(1)} kg${inv.weightFactor < 1 ? ` · stamina recovery ×${inv.weightFactor.toFixed(2)}` : ''} · Flashlight ${sim.flash.battery.toFixed(0)}% · Camcorder ${sim.cam.battery.toFixed(0)}%`;
  };
  paint();
  root.append(h('h2', {}, 'Backpack'), h('div', { class: 'inv-wrap' }, grid, detail), h('h3', {}, 'Hotbar'), hot, stats, h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { game.ui.openPanel(craftPanel(game, sim.safeRoom, () => game.ui.closePanel())); } }, 'Craft'), h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}

export function journalPanel(game: Game, close: () => void): HTMLElement {
  const ids = game.knownNotes();
  const root = h('div', { class: 'screen panel' });
  const search = h('input', { type: 'text', placeholder: 'Search notes', 'aria-label': 'Search notes' });
  const list = h('div', { class: 'jlist' }), view = h('div', { class: 'jview' });
  const show = (id: string) => { const n = NOTES[id]; view.replaceChildren(h('h3', {}, n.title), h('p', { class: 'muted' }, `${n.kind} · ${n.level}`), h('p', { class: 'note-text' }, n.text)); };
  const paint = () => {
    const q = search.value.toLowerCase();
    clear(list);
    const byLevel = new Map<string, string[]>();
    for (const id of ids) { const n = NOTES[id]; if (q && !(`${n.title} ${n.text}`.toLowerCase().includes(q))) continue; (byLevel.get(n.level) ?? byLevel.set(n.level, []).get(n.level)!).push(id); }
    if (!byLevel.size) list.append(h('p', { class: 'muted' }, ids.length ? 'No matches.' : 'Nothing found yet. Notes you read are kept here.'));
    for (const [lvl, items] of byLevel) { list.append(h('h4', {}, CAMPAIGN.find((c) => c.id === lvl)?.name ?? lvl)); for (const id of items) list.append(h('button', { class: 'btn small', onclick: () => show(id) }, NOTES[id].title)); }
  };
  search.addEventListener('input', paint); paint();
  root.append(h('h2', {}, 'Journal'), search, h('div', { class: 'inv-wrap' }, list, view), h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}

export function notePanel(id: string, close: () => void, override?: { title: string; text: string }): HTMLElement {
  const n = override ?? NOTES[id];
  return h('div', { class: 'screen center panel' }, h('h3', {}, n.title), h('p', { class: 'note-text paper' }, n.text), h('button', { class: 'btn primary', onclick: close }, 'Keep reading later (journal)'));
}

/**
 * Replay a level: every campaign level up to the furthest one reached in this save. Pick one, then a difficulty
 * and (optionally) a seed. Story progress is untouched, loot you bring back is capped and death never ends a replay.
 */
export function replayPanel(game: Game, slot: SlotData, close: () => void): HTMLElement {
  const root = h('div', { class: 'screen panel replay' });
  const reached = reachedLevelIndexes(slot.frontier).map((i) => ({ e: CAMPAIGN[i], i }));
  const list = () => {
    clear(root);
    root.append(h('h2', {}, 'Replay a level'), h('p', { class: 'muted' }, `${reached.length} of ${CAMPAIGN.length} levels reached in this save. Reach further to unlock more.`));
    const rows = h('div', { class: 'jlist' });
    for (const { e, i } of [...reached].reverse()) {
      const done = slot.completed[e.id];
      rows.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, `${i + 1}. ${e.name}`, h('small', {}, `Act ${e.act} · ${e.tier}${done ? ` · best ${fmtTime(done.bestTime)} on ${DIFFICULTIES[done.difficulty]?.label ?? done.difficulty}` : i === slot.frontier ? ' · current' : ''}`)),
        h('button', { class: 'btn small primary', onclick: () => config(i) }, 'Replay')));
    }
    root.append(rows, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Back')));
  };
  const config = (index: number) => {
    const e = CAMPAIGN[index];
    let diff: DifficultyId = slot.difficulty;
    const allowed = DIFFICULTY_ORDER.filter((d) => d !== 'hardcore' || slot.difficulty === 'hardcore');
    const seed = h('input', { type: 'text', placeholder: 'Random seed (optional)', maxlength: 24, autocapitalize: 'characters', 'aria-label': 'Replay seed' });
    const chips = allowed.map((d) => h('button', { class: 'chip', onclick: () => { diff = d; paint(); } }, DIFFICULTIES[d].label));
    const paint = () => chips.forEach((b, k) => b.classList.toggle('on', allowed[k] === diff));
    paint();
    clear(root);
    root.append(h('h2', {}, `${index + 1}. ${e.name}`), h('p', { class: 'muted' }, `Act ${e.act} · ${e.tier}`),
      h('p', {}, 'A fresh run of this level. Loot you bring back is capped, story progress is unchanged, and death just restarts it.'),
      h('div', { class: 'chips' }, ...chips), h('label', { class: 'field' }, 'Seed', seed),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: list }, 'Back'),
        h('button', { class: 'btn primary', onclick: () => { void game.startReplay(index, { difficulty: diff, seed: seed.value.trim() || randomSeedString() }); } }, 'Start')));
  };
  list();
  return root;
}

export function infoPanel(title: string, text: string, close: () => void): HTMLElement {
  return h('div', { class: 'screen center panel' }, h('h2', {}, title), h('p', {}, text), h('button', { class: 'btn', onclick: close }, 'Close'));
}

/** Crafting: recipes appear once you have held all their ingredients (discovery); cooking recipes need a checkpoint camp (`kitchen`). */
export function craftPanel(game: Game, kitchen: boolean, close: () => void): HTMLElement {
  const sim = game.level!.sim, inv = sim.inv;
  const flags = game.currentSlot?.flags ?? {};
  const known = new Set(Object.keys(flags).filter((k) => k.startsWith('recipe:')).map((k) => k.slice(7)));
  for (const id of discover(inv, known)) { flags[`recipe:${id}`] = true; game.ui.toast(`Recipe discovered: ${RECIPES.find((r) => r.id === id)!.name}`); }
  const root = h('div', { class: 'screen panel' }, h('h2', {}, kitchen ? 'Kitchen' : 'Crafting'));
  const list = h('div', { class: 'jlist' });
  const paint = () => {
    clear(list);
    const shown = RECIPES.filter((r) => known.has(r.id) || canCraft(inv, r, kitchen));
    if (!shown.length) list.append(h('p', { class: 'muted' }, 'Nothing to make yet. Pick up odds and ends (rags, bottles, rope, cans, paper) and recipes show up here.'));
    for (const r of shown) {
      const ok = canCraft(inv, r, kitchen);
      const needs = Object.entries(r.in).map(([id, n]) => `${itemDef(id).name} ×${n}${inv.count(id) >= n ? '' : ' (missing)'}`).join(', ');
      list.append(h('div', { class: 'row' }, h('div', { class: 'row-label' }, r.name, h('small', {}, `${needs}${r.station ? ' · kitchen' : ''}`), h('small', {}, r.hint)),
        h('button', { class: 'btn small' + (ok ? ' primary' : ''), disabled: !ok, onclick: () => { if (craft(inv, r, kitchen)) { flags[`recipe:${r.id}`] = true; const cn = (game.profile.counters ??= {}); cn.crafted = (cn.crafted ?? 0) + 1; game.flow.award(); game.level!.sim.emit({ type: 'use', item: r.id }); game.ui.toast(`Made: ${r.name}`); } else game.ui.toast('Not enough room', 'warn'); paint(); } }, 'Make')));
    }
  };
  paint();
  root.append(list, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}

/** Talking to a coworker: ask the badge question to tell the real one from the Skin-stealer. */
export function talkPanel(game: Game, entityId: number, close: () => void): HTMLElement {
  const sim = game.level!.sim;
  const v = sim.plan.verify;
  const root = h('div', { class: 'screen center panel dialogue' }, h('h3', {}, 'Coworker', h('small', {}, 'someone from the floor')));
  const say = h('p', { class: 'say' }, 'Oh, hey. Another person! Thank God. Stay close, will you? It is not safe to wander alone.');
  const menu = h('div', { class: 'menu' });
  const done = (text: string, danger = false) => { say.textContent = text; menu.replaceChildren(h('button', { class: 'btn' + (danger ? ' danger' : ''), onclick: close }, danger ? 'Back away' : 'Okay')); };
  if (v) menu.append(h('button', { class: 'btn', onclick: () => {
    const r = sim.x.ask(entityId);
    if (!r) return done('...');
    game.soundBank?.blip(r.fake ? 150 : 175);
    done(`"${r.answer}." ${r.fake ? 'Their smile stays exactly where it was. They are not blinking.' : 'They answer without a pause and blink, relieved.'}`, r.fake);
  } }, v.question));
  menu.append(h('button', { class: 'btn', onclick: close }, 'Walk away'));
  root.append(say, menu);
  game.soundBank?.blip(160);
  return root;
}

/** The Architect's decision (spec 8.6): the choices set the flags the ending resolver reads. */
export function finalePanel(game: Game, close: () => void): HTMLElement {
  const sim = game.level!.sim;
  const flags = game.currentSlot?.flags ?? {};
  const companion = !!game.currentSlot?.npcs.companion && (game.currentSlot.npcs.companion as { present?: boolean }).present === true;
  const root = h('div', { class: 'screen center panel dialogue' }, h('h3', {}, 'The Architect', h('small', {}, 'seated at a drawing table')));
  root.append(h('p', { class: 'say' }, 'You came all this way. I built a door for you, one more than I needed. You may leave. You may stay and draw. You may refuse and begin again. I will not stop you. I only ask that you decide.'));
  const menu = h('div', { class: 'menu' });
  const pick = (patch: Partial<import('../story/endings').EndingState>) => { close(); void game.flow.finishGame(patch); };
  menu.append(h('button', { class: 'btn primary', onclick: () => pick({}) }, 'Take the exit key and leave'));
  menu.append(h('button', { class: 'btn', onclick: () => pick({ acceptedArchitect: true }) }, 'Accept the pencil: stay and draw'));
  menu.append(h('button', { class: 'btn', onclick: () => pick({ refusedExit: true }) }, 'Refuse the door'));
  if (companion) menu.append(h('button', { class: 'btn', onclick: () => pick({ companionAlive: true, chosenStay: true }) }, 'Stay behind so Pim can leave'));
  if ((Number(flags.anchors) || 0) >= 5) menu.append(h('button', { class: 'btn', onclick: () => pick({ trueDecision: true, anchorsFound: Number(flags.anchors) || 0 }) }, 'Lay the five anchors on the table'));
  menu.append(h('button', { class: 'btn ghost', onclick: close }, 'Not yet'));
  root.append(menu);
  void sim;
  return root;
}
