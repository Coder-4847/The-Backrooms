/**
 * Async key/value storage. IndexedDB is primary, localStorage the fallback, and an in-memory
 * adapter exists for tests/private windows. Values are JSON strings so every adapter behaves the same.
 */

export interface KV {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryKV implements KV {
  readonly kind = 'memory' as const;
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.get(k) ?? null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async delete(k: string) { this.map.delete(k); }
  async keys(prefix = '') { return [...this.map.keys()].filter((k) => k.startsWith(prefix)); }
}

const LS_PREFIX = 'noclip:';

export class LocalStorageKV implements KV {
  readonly kind = 'localstorage' as const;
  async get(k: string) { return localStorage.getItem(LS_PREFIX + k); }
  async set(k: string, v: string) { localStorage.setItem(LS_PREFIX + k, v); }
  async delete(k: string) { localStorage.removeItem(LS_PREFIX + k); }
  async keys(prefix = '') {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX + prefix)) out.push(k.slice(LS_PREFIX.length));
    }
    return out;
  }
}

const DB_NAME = 'noclip';
const STORE = 'kv';

export class IndexedDbKV implements KV {
  readonly kind = 'indexeddb' as const;
  private constructor(private db: IDBDatabase) {}

  static open(): Promise<IndexedDbKV> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(new IndexedDbKV(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('indexedDB blocked'));
    });
  }

  private tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = fn(this.db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(k: string) { return ((await this.tx('readonly', (s) => s.get(k))) as string | undefined) ?? null; }
  async set(k: string, v: string) { await this.tx('readwrite', (s) => s.put(v, k)); }
  async delete(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async keys(prefix = '') {
    const all = (await this.tx('readonly', (s) => s.getAllKeys())) as string[];
    return all.filter((k) => k.startsWith(prefix));
  }
}

/** Pick the best available adapter. Never throws. */
export async function openBestStorage(): Promise<KV> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const kv = await IndexedDbKV.open();
      await kv.set('__probe', '1');
      await kv.delete('__probe');
      return kv;
    }
  } catch { /* fall through */ }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LS_PREFIX + '__probe', '1');
      localStorage.removeItem(LS_PREFIX + '__probe');
      return new LocalStorageKV();
    }
  } catch { /* fall through */ }
  return new MemoryKV();
}

/** Ask the browser not to evict our data. Returns whether storage is persistent. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
