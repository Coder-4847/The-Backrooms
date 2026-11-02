/**
 * In-game panels: inventory (grid, drag and drop, hotbar assignment), journal, dialogue, hub door
 * panel, stash, note reader. Real buttons everywhere so keyboard, gamepad focus and touch all work.
 */
import { h, clear } from './dom';
import { GRID_H, GRID_W, type Stack } from '../systems/inventory';
import { itemDef } from '../systems/items';
import { NOTES } from '../story/notes';
import { NPCS } from '../story/npcs';
import { CAMPAIGN } from '../levels/campaign';
import { doorState, type HubState } from '../levels/hubObjects';
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
  root.append(h('h2', {}, 'Backpack'), h('div', { class: 'inv-wrap' }, grid, detail), h('h3', {}, 'Hotbar'), hot, stats, h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { game.ui.openPanel(craftPanel(game, false, () => game.ui.closePanel())); } }, 'Craft'), h('button', { class: 'btn', onclick: close }, 'Close')));
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
    for (const [lvl, items] of byLevel) { list.append(h('h4', {}, CAMPAIGN.find((c) => c.id === lvl)?.name ?? (lvl === 'hub' ? 'Almond Outpost' : lvl))); for (const id of items) list.append(h('button', { class: 'btn small', onclick: () => show(id) }, NOTES[id].title)); }
  };
  search.addEventListener('input', paint); paint();
  root.append(h('h2', {}, 'Journal'), search, h('div', { class: 'inv-wrap' }, list, view), h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}

export function notePanel(id: string, close: () => void, override?: { title: string; text: string }): HTMLElement {
  const n = override ?? NOTES[id];
  return h('div', { class: 'screen center panel' }, h('h3', {}, n.title), h('p', { class: 'note-text paper' }, n.text), h('button', { class: 'btn primary', onclick: close }, 'Keep reading later (journal)'));
}

export function dialoguePanel(game: Game, npcId: string, close: () => void): HTMLElement {
  const npc = NPCS[npcId];
  const root = h('div', { class: 'screen center panel dialogue' });
  const sim = game.level!.sim;
  const flags = game.currentSlot?.flags ?? {};
  let timer: ReturnType<typeof setInterval> | undefined;
  const go = (key: string) => {
    const node = npc.nodes[key];
    clear(root);
    const text = h('p', { class: 'say' });
    root.append(h('h3', {}, npc.name, h('small', {}, npc.role)), text);
    let i = 0; clearInterval(timer);
    const choices = h('div', { class: 'menu' });
    timer = setInterval(() => { i += 2; text.textContent = node.text.slice(0, i); if (i % 4 === 0) game.soundBank?.blip(npc.blip); if (i >= node.text.length) { clearInterval(timer); text.textContent = node.text; } }, 28);
    for (const c of node.choices) {
      if (c.once && flags[c.once]) continue;
      root.append(h('button', { class: 'btn', onclick: () => {
        clearInterval(timer);
        if (c.give) { if (sim.inv.add(c.give.item, c.give.n) === 0) game.ui.toast(`Received ${itemDef(c.give.item).name}`); else { game.ui.toast('Backpack full', 'warn'); return; } }
        if (c.once) flags[c.once] = true;
        if (c.set) Object.assign(flags, c.set);
        if (c.next) go(c.next); else close();
      } }, c.text));
    }
    root.append(choices);
  };
  go(npc.start);
  return root;
}

export function doorPanel(game: Game, index: number, hub: HubState, close: () => void): HTMLElement {
  const e = CAMPAIGN[index];
  const st = doorState(index, hub);
  const slot = game.currentSlot;
  const done = hub.completed[e.id];
  const root = h('div', { class: 'screen center panel' }, h('h2', {}, `${index + 1}. ${e.name}`), h('p', { class: 'muted' }, `Act ${e.act} · ${e.tier}${done ? ` · best ${fmtTime(done.bestTime)} on ${done.difficulty}` : ''}`));
  if (st === 'sealed') root.append(h('p', {}, 'The door is welded shut. Something further back has to open first.'));
  else if (st === 'unbuilt') root.append(h('p', {}, 'This door is real, but the level behind it has not been built yet. It arrives in a later phase.'));
  else {
    let diff: DifficultyId = slot?.difficulty ?? 'normal';
    const seed = h('input', { type: 'text', placeholder: 'Random seed (optional)', maxlength: 24, 'aria-label': 'Replay seed' });
    const chips = DIFFICULTY_ORDER.filter((d) => d !== 'hardcore' || slot?.difficulty === 'hardcore').map((d) => h('button', { class: 'chip', onclick: () => { diff = d; paint(); } }, DIFFICULTIES[d].label));
    const paint = () => chips.forEach((b, i) => b.classList.toggle('on', DIFFICULTY_ORDER.filter((d) => d !== 'hardcore' || slot?.difficulty === 'hardcore')[i] === diff));
    paint();
    if (st === 'replay') root.append(h('p', {}, 'Replay: choose a difficulty and a seed. Loot you bring back is capped; story progress is unchanged and death never ends the run.'), h('div', { class: 'chips' }, ...chips), seed);
    else root.append(h('p', {}, `Continue the campaign on ${DIFFICULTIES[diff].label}.`));
    root.append(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { close(); void game.startFromHub(index, st === 'replay' ? { mode: 'replay', difficulty: diff, seed: seed.value.trim() || randomSeedString() } : { mode: 'campaign', difficulty: diff }); } }, st === 'replay' ? 'Replay' : 'Step through')));
  }
  root.append(h('button', { class: 'btn', onclick: close }, 'Not yet'));
  return root;
}

export function stashPanel(game: Game, close: () => void): HTMLElement {
  const inv = game.level!.sim.inv;
  const root = h('div', { class: 'screen panel' });
  const body = h('div', { class: 'inv-wrap' });
  const paint = () => {
    const mine = h('div', {}, h('h3', {}, 'Carrying'));
    for (const s of inv.stacks) if (!mine.querySelector(`[data-id="${s.id}"]`)) mine.append(h('button', { class: 'btn small', 'data-id': s.id, onclick: () => { inv.stashIn(s.id, 1); paint(); } }, `${itemDef(s.id).name} ×${inv.count(s.id)} →`));
    const stash = h('div', {}, h('h3', {}, 'Stash (kept between runs)'));
    for (const s of inv.stash) stash.append(h('button', { class: 'btn small', onclick: () => { if (!inv.stashOut(s.id, 1)) game.ui.toast('Backpack full', 'warn'); paint(); } }, `← ${itemDef(s.id).name} ×${s.n}`));
    if (!inv.stash.length) stash.append(h('p', { class: 'muted' }, 'Empty. Move spare supplies here to keep them safe.'));
    body.replaceChildren(mine, stash);
  };
  paint();
  root.append(h('h2', {}, 'Stash lockers'), body, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: close }, 'Close')));
  return root;
}

export function infoPanel(title: string, text: string, close: () => void): HTMLElement {
  return h('div', { class: 'screen center panel' }, h('h2', {}, title), h('p', {}, text), h('button', { class: 'btn', onclick: close }, 'Close'));
}

/** Crafting: recipes appear once you have held all their ingredients (discovery); kitchen recipes need the hub kitchen. */
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
        h('button', { class: 'btn small' + (ok ? ' primary' : ''), disabled: !ok, onclick: () => { if (craft(inv, r, kitchen)) { flags[`recipe:${r.id}`] = true; game.level!.sim.emit({ type: 'use', item: r.id }); game.ui.toast(`Made: ${r.name}`); } else game.ui.toast('Not enough room', 'warn'); paint(); } }, 'Make')));
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
