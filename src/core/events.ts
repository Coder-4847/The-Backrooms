/** Tiny typed event bus used for loose coupling (UI <-> game <-> audio). */

export interface GameEvents {
  'settings:changed': { key: string };
  'device:changed': { device: 'kbm' | 'gamepad' | 'touch' };
  'caption': { text: string; ms: number };
  'toast': { text: string; kind?: 'info' | 'warn' };
  'quality:changed': { tier: string; scale: number; reason: string };
  'quality:offerUp': { tier: string };
  'level:loaded': { id: string; seed: number };
  'save:written': { slot: number };
  'debug:overlay': { name: string; on: boolean };
  /** A jump scare (or a mild `jolt`) is playing: the DOM overlay flashes and shakes the screen. */
  'scare': { kind: 'light' | 'heavy' | 'lethal' | 'jolt' | 'soft'; ms: number };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends Record<string, unknown>> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.handlers.get(type)?.forEach((fn) => (fn as Handler<E[K]>)(payload));
  }
}

export const bus = new EventBus<GameEvents & Record<string, unknown>>();
