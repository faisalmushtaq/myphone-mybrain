/**
 * The issue log's offline queue (4 November 2026). An entry that cannot be
 * sent (no signal in a school hall, a call that fails) is kept on the device,
 * with the time it was logged, and sent when the connection comes back or the
 * portal is next opened. Each entry carries its own id, made here, so a retry
 * that reaches the server twice is still one entry there.
 *
 * Kept in IndexedDB; a plain in-memory store stands in where there is none
 * (and in the tests).
 */

export interface QueuedEntry {
  id: string;
  deviceAt: string;
  [k: string]: unknown;
}

export interface QueueStore {
  all(): Promise<QueuedEntry[]>;
  put(e: QueuedEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export function memoryStore(): QueueStore {
  const m = new Map<string, QueuedEntry>();
  return {
    all: async () => [...m.values()].sort((a, b) => a.deviceAt.localeCompare(b.deviceAt)),
    put: async (e) => void m.set(e.id, e),
    remove: async (id) => void m.delete(id),
  };
}

const DB = 'mpmb-portal-issues';
const STORE = 'queue';
function idbStore(): QueueStore | null {
  if (typeof indexedDB === 'undefined') return null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = f(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    all: async () => ((await run('readonly', (s) => s.getAll())) as QueuedEntry[]).sort((a, b) => a.deviceAt.localeCompare(b.deviceAt)),
    put: async (e) => void (await run('readwrite', (s) => s.put(e))),
    remove: async (id) => void (await run('readwrite', (s) => s.delete(id))),
  };
}

/** What a send attempt came to: sent (or already there), refused for good (shown, then dropped), or not reached (kept). */
export type SendResult = 'sent' | 'refused' | 'offline';

export class IssueQueue {
  private listeners = new Set<(n: number) => void>();
  private flushing: Promise<{ sent: number; refused: { entry: QueuedEntry; message: string }[] }> | null = null;
  constructor(private readonly store: QueueStore) {}

  async count(): Promise<number> {
    return (await this.store.all()).length;
  }
  onChange(f: (n: number) => void): () => void {
    this.listeners.add(f);
    void this.count().then(f).catch(() => undefined);
    return () => this.listeners.delete(f);
  }
  private async changed() {
    const n = await this.count();
    for (const f of this.listeners) f(n);
  }
  async add(e: QueuedEntry): Promise<void> {
    await this.store.put(e);
    await this.changed();
  }
  async entries(): Promise<QueuedEntry[]> {
    return this.store.all();
  }

  /** Sends what is waiting, oldest first; stops at the first that cannot reach the server. One flush at a time. */
  flush(send: (e: QueuedEntry) => Promise<{ result: SendResult; message?: string }>) {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let sent = 0;
      const refused: { entry: QueuedEntry; message: string }[] = [];
      try {
        for (const e of await this.store.all()) {
          const r = await send(e).catch(() => ({ result: 'offline' as const, message: '' }));
          if (r.result === 'offline') break;
          await this.store.remove(e.id);
          if (r.result === 'sent') sent += 1;
          else refused.push({ entry: e, message: r.message ?? '' });
        }
      } finally {
        this.flushing = null;
        await this.changed();
      }
      return { sent, refused };
    })();
    return this.flushing;
  }
}

let shared: IssueQueue | null = null;
export function issueQueue(): IssueQueue {
  if (!shared) shared = new IssueQueue(idbStore() ?? memoryStore());
  return shared;
}

/** A fresh id for an entry. */
export function newIssueId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
