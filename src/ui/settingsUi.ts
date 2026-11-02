/** Schema-driven settings screen with rebinding for keyboard and gamepad. */
import { h } from './dom';
import { SCHEMA, type Category, type SettingDef } from '../core/settings';
import { ACTIONS, rebind, keyName, DEFAULT_BINDINGS, cloneBindings, type Action, type PadLayout } from '../core/input/actions';
import type { Game } from '../core/game';

const CATEGORIES: Category[] = ['Graphics', 'Audio', 'Controls', 'Gameplay', 'Accessibility'];
const PAD_LABEL: Record<PadLayout, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'],
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '↑', '↓', '←', '→'],
};

export function buildSettings(game: Game, onClose: () => void): HTMLElement {
  const root = h('div', { class: 'screen settings' });
  let tab: Category = (sessionStorage.getItem('settingsTab') as Category) || 'Graphics';
  const body = h('div', { class: 'settings-body' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });

  const row = (d: SettingDef): HTMLElement => {
    const s = game.settings;
    const label = h('label', { class: 'row-label' }, d.label, d.hint && h('small', {}, d.hint));
    let control: HTMLElement;
    const val = s.value[d.key] as unknown;
    if (d.type === 'toggle') {
      const cb = h('input', { type: 'checkbox', id: `s-${d.key}`, ...(val ? { checked: true } : {}) });
      cb.checked = !!val;
      cb.addEventListener('change', () => s.setFromUi(d.key, cb.checked));
      control = h('span', { class: 'switch' }, cb, h('i'));
    } else if (d.type === 'range') {
      const out = h('output', {}, fmt(val as number, d));
      const r = h('input', { type: 'range', id: `s-${d.key}`, min: d.min, max: d.max, step: d.step, value: val as number });
      r.addEventListener('input', () => { s.setFromUi(d.key, Number(r.value)); out.textContent = fmt(Number(r.value), d); });
      control = h('span', { class: 'range' }, r, out);
    } else {
      const sel = h('select', { id: `s-${d.key}` }, ...d.options.map((o) => h('option', { value: o.value, ...(o.value === val ? { selected: true } : {}) }, o.label)));
      sel.value = String(val);
      sel.addEventListener('change', () => s.setFromUi(d.key, sel.value));
      control = sel;
    }
    label.setAttribute('for', `s-${d.key}`);
    return h('div', { class: 'row' }, label, control);
  };

  const bindingsUi = (): HTMLElement => {
    const wrap = h('div', { class: 'bindings' }, h('h3', {}, 'Key and button bindings'), h('p', { class: 'muted' }, 'Click a binding, then press the key or gamepad button. Esc cancels.'));
    const layout = game.input.padLayout;
    const render = () => {
      table.replaceChildren(h('div', { class: 'brow head' }, h('span', {}, 'Action'), h('span', {}, 'Keyboard'), h('span', {}, 'Gamepad')));
      const b = game.settings.value.bindings;
      for (const a of ACTIONS) {
        if (a === 'Console') continue;
        const mk = (device: 'kb' | 'pad') => {
          const text = device === 'kb' ? (b[a].kb[0] ? keyName(b[a].kb[0]) : '—') : (b[a].pad.length ? PAD_LABEL[layout][b[a].pad[0]] ?? `#${b[a].pad[0]}` : '—');
          const btn = h('button', { class: 'bind' }, text);
          btn.addEventListener('click', () => {
            btn.textContent = 'press…'; btn.classList.add('capturing');
            const esc = (e: KeyboardEvent) => { if (e.code === 'Escape') { game.input.cancelCapture(); render(); } };
            window.addEventListener('keydown', esc, { once: true, capture: true });
            game.input.captureNext((kind, code) => {
              window.removeEventListener('keydown', esc, true);
              if (kind === device && code !== 'Escape') game.settings.set('bindings', rebind(game.settings.value.bindings, a as Action, device, code));
              render();
            });
          });
          return btn;
        };
        table.append(h('div', { class: 'brow' }, h('span', {}, a.replace(/([A-Z])/g, ' $1').trim()), mk('kb'), mk('pad')));
      }
    };
    const table = h('div', { class: 'btable' });
    render();
    wrap.append(table, h('button', { class: 'btn small', onclick: () => { game.settings.set('bindings', cloneBindings(DEFAULT_BINDINGS)); render(); } }, 'Reset to defaults'));
    return wrap;
  };

  const storage = (): HTMLElement => {
    const persisted = h('p', { class: 'muted' }, `Storage: ${game.saves.storageKind}`);
    navigator.storage?.persisted?.().then((p) => { persisted.textContent = `Storage: ${game.saves.storageKind}. ${p ? 'Persistent: your browser will not clear saves automatically.' : 'Warning: your browser may clear saves if disk space runs low. Export a backup occasionally.'}`; });
    return h('div', { class: 'bindings' }, h('h3', {}, 'Data'), persisted,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn small', onclick: async () => download('noclip-backup.json', await game.saves.exportData(null)) }, 'Export all data'),
        h('button', { class: 'btn small', onclick: () => pickFile(async (t) => { await game.saves.importData(t); location.reload(); }) }, 'Import data'),
        h('button', { class: 'btn small danger', onclick: async () => { if (confirm('Delete ALL saves and settings on this device? This cannot be undone.')) { await game.saves.wipeAll(); location.reload(); } } }, 'Delete data')));
  };

  const render = () => {
    sessionStorage.setItem('settingsTab', tab);
    tabs.replaceChildren(...CATEGORIES.map((c) => h('button', { class: 'tab' + (c === tab ? ' on' : ''), role: 'tab', onclick: () => { tab = c; render(); } }, c)));
    body.replaceChildren(...SCHEMA.filter((d) => d.category === tab).map(row));
    if (tab === 'Controls') body.append(bindingsUi());
    if (tab === 'Gameplay') body.append(storage());
  };
  render();

  root.append(h('h2', {}, 'Settings'), tabs, body, h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: onClose }, 'Back')));
  return root;
}

function fmt(v: number, d: Extract<SettingDef, { type: 'range' }>): string {
  const dec = d.step < 0.1 ? 2 : d.step < 1 ? 1 : 0;
  return `${v.toFixed(dec)}${d.unit ?? ''}`;
}

export function download(name: string, text: string): void {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function pickFile(cb: (text: string) => void): void {
  const i = h('input', { type: 'file', accept: 'application/json,.json' });
  i.addEventListener('change', async () => { const f = i.files?.[0]; if (f) cb(await f.text()); });
  i.click();
}
