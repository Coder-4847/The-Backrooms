import { describe, expect, it, vi } from 'vitest';
import { SettingsStore, defaultSettings, sanitizeSettings, SCHEMA, fpsCapOf } from '../src/core/settings';
import { ACTIONS, DEFAULT_BINDINGS, glyphFor, padLayoutFromId, rebind, sanitizeBindings } from '../src/core/input/actions';
import { DeviceTracker, applyCurve, applyDeadzone, digitalMove, diffActions, emptyActionMap, padIsActive, resolveActions } from '../src/core/input/logic';

describe('settings', () => {
  it('has a default for every schema entry and covers all categories', () => {
    const d = defaultSettings() as unknown as Record<string, unknown>;
    for (const s of SCHEMA) expect(d[s.key], s.key).toBe(s.def);
    expect(new Set(SCHEMA.map((s) => s.category))).toEqual(new Set(['Graphics', 'Audio', 'Controls', 'Gameplay', 'Accessibility']));
  });
  it('sanitizes junk: clamps ranges, rejects bad enums, drops unknown keys', () => {
    const s = sanitizeSettings({ master: 7, fov: -5, tier: 'ludicrous', bloom: 'yes', evil: 1, scare: 'brutal' }) as unknown as Record<string, unknown>;
    expect(s.master).toBe(1); expect(s.fov).toBe(60); expect(s.tier).toBe('auto'); expect(s.bloom).toBe(true); expect(s.evil).toBeUndefined(); expect(s.scare).toBe('brutal');
  });
  it('persists changes (debounced) and notifies listeners', () => {
    vi.useFakeTimers();
    const persist = vi.fn(); const listener = vi.fn();
    const st = new SettingsStore({}, persist);
    st.subscribe(listener);
    st.set('master', 0.3); st.set('master', 0.4);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(persist).toHaveBeenCalledTimes(1);
    expect((persist.mock.calls[0][0] as { master: number }).master).toBe(0.4);
    // a fresh store loading the persisted blob restores the value
    expect(new SettingsStore(persist.mock.calls[0][0]).value.master).toBe(0.4);
    vi.useRealTimers();
  });
  it('battery saver caps fps at 30', () => {
    const s = defaultSettings(); expect(fpsCapOf(s)).toBe(60);
    expect(fpsCapOf({ ...s, batterySaver: true })).toBe(30);
    expect(fpsCapOf({ ...s, fpsCap: '0' })).toBe(0);
  });
});

describe('input logic', () => {
  it('dead zone removes drift and rescales', () => {
    const o = { x: 0, y: 0 };
    applyDeadzone(0.1, 0.05, 0.2, o); expect(o).toEqual({ x: 0, y: 0 });
    applyDeadzone(1, 0, 0.2, o); expect(o.x).toBeCloseTo(1); expect(o.y).toBeCloseTo(0);
    applyDeadzone(0.6, 0, 0.2, o); expect(o.x).toBeCloseTo(0.5);
  });
  it('response curve keeps sign and is finer near the centre', () => {
    expect(applyCurve(-0.5, 2)).toBeCloseTo(-0.25); expect(applyCurve(1, 2)).toBe(1); expect(applyCurve(0.5, 1)).toBe(0.5);
  });
  it('digital movement is normalised on diagonals', () => {
    const o = { x: 0, y: 0 };
    digitalMove(false, true, true, false, o); expect(Math.hypot(o.x, o.y)).toBeCloseTo(1);
    digitalMove(true, true, false, false, o); expect(o).toEqual({ x: 0, y: 0 });
  });
  it('resolves actions from keys, pad buttons and touch, and detects edges', () => {
    const held = emptyActionMap(), prev = emptyActionMap(), pressed = emptyActionMap(), released = emptyActionMap();
    resolveActions(DEFAULT_BINDINGS, new Set(['KeyE']), [], new Set(), held);
    expect(held.Interact).toBe(true); expect(held.Flashlight).toBe(false);
    diffActions(prev, held, pressed, released); expect(pressed.Interact).toBe(true);
    Object.assign(prev, held);
    resolveActions(DEFAULT_BINDINGS, new Set(), (() => { const p = new Array(17).fill(false); p[3] = true; return p; })(), new Set(['Sprint']), held);
    expect(held.Flashlight).toBe(true); expect(held.Sprint).toBe(true); expect(held.Interact).toBe(false);
    diffActions(prev, held, pressed, released); expect(released.Interact).toBe(true); expect(pressed.Flashlight).toBe(true);
  });
  it('device tracker switches to the most recently used device', () => {
    const t = new DeviceTracker('kbm');
    expect(t.note('kbm')).toBe(false); expect(t.note('gamepad')).toBe(true); expect(t.device).toBe('gamepad'); expect(t.note('touch')).toBe(true);
    expect(padIsActive([0.05, 0.1, 0, 0], false)).toBe(false); expect(padIsActive([0.6, 0, 0, 0], false)).toBe(true); expect(padIsActive([0, 0, 0, 0], true)).toBe(true);
  });
  it('rebinding moves a key and never leaves a double binding', () => {
    const b = rebind(DEFAULT_BINDINGS, 'Flashlight', 'kb', 'KeyE');
    expect(b.Flashlight.kb[0]).toBe('KeyE'); expect(b.Interact.kb).not.toContain('KeyE');
    const all = ACTIONS.flatMap((a) => b[a].kb);
    expect(new Set(all).size).toBe(all.length);
    const p = rebind(DEFAULT_BINDINGS, 'Interact', 'pad', 3); expect(p.Flashlight.pad).not.toContain(3);
  });
  it('sanitizes malformed bindings back to defaults', () => {
    expect(sanitizeBindings({ Interact: { kb: [1, 2], pad: 'x' }, Nope: {} }).Interact).toEqual(DEFAULT_BINDINGS.Interact);
    expect(sanitizeBindings(null)).toEqual(DEFAULT_BINDINGS);
  });
  it('glyphs follow the active device and gamepad family', () => {
    expect(glyphFor('Interact', 'kbm', DEFAULT_BINDINGS)).toBe('E');
    expect(glyphFor('Interact', 'gamepad', DEFAULT_BINDINGS, 'xbox')).toBe('A');
    expect(glyphFor('Interact', 'gamepad', DEFAULT_BINDINGS, 'playstation')).toBe('✕');
    expect(glyphFor('Interact', 'gamepad', DEFAULT_BINDINGS, 'switch')).toBe('B');
    expect(glyphFor('Interact', 'touch', DEFAULT_BINDINGS)).toBe('Tap');
    expect(padLayoutFromId('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padLayoutFromId('Pro Controller (Vendor: 057e)')).toBe('switch');
    expect(padLayoutFromId('Xbox 360 Controller')).toBe('xbox');
  });
});

describe('item keys', () => {
  it('NextItem / PrevItem have keyboard keys, and old saves with an empty NextItem pick them up', () => {
    expect(DEFAULT_BINDINGS.NextItem.kb).toContain('BracketRight');
    expect(DEFAULT_BINDINGS.PrevItem.kb).toContain('BracketLeft');
    const old = JSON.parse(JSON.stringify(DEFAULT_BINDINGS)); old.NextItem.kb = []; delete old.PrevItem;
    const b = sanitizeBindings(old);
    expect(b.NextItem.kb).toEqual(DEFAULT_BINDINGS.NextItem.kb);
    expect(b.PrevItem.kb).toEqual(DEFAULT_BINDINGS.PrevItem.kb);
  });
  it('arrow keys are not bound to any action (they are movement / look, handled by the manager)', () => {
    const all = ACTIONS.flatMap((a) => DEFAULT_BINDINGS[a].kb);
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) expect(all).not.toContain(k);
  });
});
