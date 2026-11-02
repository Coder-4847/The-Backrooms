/** Unified action map (spec 9.1). Every device feeds these same actions into the simulation. */

export const ACTIONS = [
  'Sprint', 'Crouch', 'Interact', 'UseItem', 'Flashlight', 'Camcorder', 'Inventory', 'Journal',
  'HoldBreath', 'PeekLeft', 'PeekRight', 'Throw', 'Pause', 'Jump', 'Console',
] as const;
export type Action = (typeof ACTIONS)[number];
export type DeviceKind = 'kbm' | 'gamepad' | 'touch';
export type PadLayout = 'xbox' | 'playstation' | 'switch';

export interface Binding { kb: string[]; pad: number[] }
export type Bindings = Record<Action, Binding>;

/** Standard-mapping gamepad button indexes. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, Back: 8, Start: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15 } as const;

export const DEFAULT_BINDINGS: Bindings = {
  Sprint: { kb: ['ShiftLeft'], pad: [PAD.LS] },
  Crouch: { kb: ['ControlLeft', 'KeyC'], pad: [PAD.RS] },
  Interact: { kb: ['KeyE'], pad: [PAD.A] },
  UseItem: { kb: ['KeyF'], pad: [PAD.X] },
  Flashlight: { kb: ['KeyG'], pad: [PAD.Y] },
  Camcorder: { kb: ['KeyV'], pad: [PAD.Up] },
  Inventory: { kb: ['Tab', 'KeyI'], pad: [PAD.Back] },
  Journal: { kb: ['KeyJ'], pad: [PAD.Left] },
  HoldBreath: { kb: ['KeyB'], pad: [PAD.LB] },
  PeekLeft: { kb: ['KeyQ'], pad: [PAD.Down] },
  PeekRight: { kb: ['KeyR'], pad: [PAD.Right] },
  Throw: { kb: ['KeyT'], pad: [PAD.RB] },
  Pause: { kb: ['Escape', 'KeyP'], pad: [PAD.Start] },
  Jump: { kb: ['Space'], pad: [PAD.B] },
  Console: { kb: ['Backquote'], pad: [] },
};

export function cloneBindings(b: Bindings): Bindings {
  return Object.fromEntries(ACTIONS.map((a) => [a, { kb: [...b[a].kb], pad: [...b[a].pad] }])) as Bindings;
}

/** Fill gaps / drop junk so a stale or hand-edited settings blob never breaks input. */
export function sanitizeBindings(raw: unknown): Bindings {
  const out = cloneBindings(DEFAULT_BINDINGS);
  if (!raw || typeof raw !== 'object') return out;
  for (const a of ACTIONS) {
    const r = (raw as Record<string, Partial<Binding>>)[a];
    if (!r) continue;
    if (Array.isArray(r.kb) && r.kb.every((k) => typeof k === 'string')) out[a].kb = r.kb.slice(0, 3);
    if (Array.isArray(r.pad) && r.pad.every((n) => Number.isInteger(n))) out[a].pad = r.pad.slice(0, 3);
  }
  return out;
}

/** Move a key/button onto `action`, removing it from any other action (no double bindings). */
export function rebind(b: Bindings, action: Action, device: 'kb' | 'pad', code: string | number): Bindings {
  const next = cloneBindings(b);
  for (const a of ACTIONS) {
    if (device === 'kb') next[a].kb = next[a].kb.filter((k) => k !== code);
    else next[a].pad = next[a].pad.filter((k) => k !== code);
  }
  if (device === 'kb') next[action].kb = [code as string, ...next[action].kb].slice(0, 2);
  else next[action].pad = [code as number, ...next[action].pad].slice(0, 2);
  return next;
}

// ---- Prompt glyphs: update instantly when the device changes ----

const KB_NAMES: Record<string, string> = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', Space: 'Space', Escape: 'Esc',
  Backquote: '`', Tab: 'Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'Enter',
};
export function keyName(code: string): string {
  if (KB_NAMES[code]) return KB_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

const PAD_NAMES: Record<PadLayout, string[]> = {
  xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→'],
  playstation: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', '↑', '↓', '←', '→'],
  switch: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L3', 'R3', '↑', '↓', '←', '→'],
};

export function padLayoutFromId(id: string): PadLayout {
  const s = id.toLowerCase();
  if (/(054c|dualshock|dualsense|playstation|ps4|ps5|wireless controller)/.test(s)) return 'playstation';
  if (/(057e|nintendo|switch|joy-con|pro controller)/.test(s)) return 'switch';
  return 'xbox';
}

const TOUCH_NAMES: Partial<Record<Action, string>> = { Interact: 'Tap', Flashlight: 'Light' };

/** Label to display for an action on the current device. */
export function glyphFor(action: Action, device: DeviceKind, bindings: Bindings, layout: PadLayout = 'xbox'): string {
  const b = bindings[action];
  if (device === 'kbm') return b.kb.length ? keyName(b.kb[0]) : '—';
  if (device === 'gamepad') return b.pad.length ? PAD_NAMES[layout][b.pad[0]] ?? `#${b.pad[0]}` : '—';
  return TOUCH_NAMES[action] ?? action;
}
