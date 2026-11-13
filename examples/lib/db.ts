import { useEffect, useState, useSyncExternalStore } from "react";
import {
  NostrIDB,
  addEvents,
  countEvents,
  deleteDB,
  openDB,
  type INostrIDB,
  type NostrDBOptions,
  type NostrIDBDatabase,
  type StoredEvent,
} from "../../src/index.ts";
import { NostrIDBClient } from "../../src/worker/index.ts";
import { track } from "./activity.ts";

export type ExplorerOptions = Required<
  Pick<
    NostrDBOptions,
    | "writeInterval"
    | "cacheIndexes"
    | "pruneInterval"
    | "maxEvents"
    | "maxMemoryEvents"
  >
>;

export const DEFAULT_OPTIONS: ExplorerOptions = {
  writeInterval: 100,
  cacheIndexes: 1000,
  pruneInterval: 60_000,
  maxEvents: 1_000_000,
  maxMemoryEvents: 10_000,
};

const STORAGE_KEY = "nostr-idb-explorer";
const DEFAULT_NAME = "nostr-idb-explorer";

export type DBSnapshot = {
  /** name of the active database, empty when no database is open */
  name: string;
  options: ExplorerOptions;
  /** whether the active database runs in a dedicated worker */
  worker: boolean;
  /**
   * The public database API: the NostrIDB instance itself on the main
   * thread, or a NostrIDBClient talking to a worker
   */
  store: INostrIDB | null;
  /** raw IndexedDB handle, only available on the main thread */
  db: NostrIDBDatabase | null;
  /** NostrIDB internals (caches, queues), only available on the main thread */
  nostr: NostrIDB | null;
  ready: boolean;
  /** increments whenever the active database is swapped */
  generation: number;
  /** names of the databases open as tabs, in tab order */
  tabs: string[];
  /** increments when databases are created or deleted */
  listVersion: number;
};

type Saved = {
  tabs: string[];
  active: string;
  options: Record<string, ExplorerOptions>;
  /** databases that run in a dedicated worker */
  workers?: Record<string, boolean>;
};

type Connection =
  | { kind: "main"; store: NostrIDB; db: NostrIDBDatabase; nostr: NostrIDB }
  | { kind: "worker"; store: NostrIDBClient; worker: Worker };

/** Starts a dedicated worker serving one database, see db-worker.ts */
async function startWorker(name: string, options: ExplorerOptions) {
  const worker = new Worker(new URL("./db-worker.ts", import.meta.url), {
    type: "module",
    name: `nostr-idb: ${name}`,
  });
  const failed = new Promise<never>((_, reject) =>
    worker.addEventListener("error", (e) =>
      reject(new Error(e.message || "Worker failed to start")),
    ),
  );
  worker.postMessage({ type: "open", name, options });
  const store = new NostrIDBClient(worker);
  try {
    await Promise.race([store.ready, failed]);
  } catch (error) {
    store.close();
    worker.terminate();
    throw error;
  }
  return { kind: "worker" as const, store, worker };
}

/** Flushes and closes the worker's database, then terminates it */
async function stopWorker({
  store,
  worker,
}: {
  store: NostrIDBClient;
  worker: Worker;
}) {
  store.close();
  const closed = new Promise<void>((resolve) => {
    worker.addEventListener("message", (e) => {
      if (e.data?.type === "closed") resolve();
    });
    setTimeout(resolve, 5000);
  });
  worker.postMessage({ type: "shutdown" });
  await closed;
  worker.terminate();
}

function loadSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    // migrate the old single database format
    if (typeof saved.name === "string" && !saved.tabs)
      return {
        tabs: [saved.name],
        active: saved.name,
        options: { [saved.name]: { ...DEFAULT_OPTIONS, ...saved.options } },
        workers: {},
      };
    const tabs: string[] = Array.isArray(saved.tabs) ? saved.tabs : [];
    return {
      tabs,
      active: tabs.includes(saved.active) ? saved.active : (tabs[0] ?? ""),
      options: saved.options ?? {},
      workers: saved.workers ?? {},
    };
  } catch {
    return { tabs: [], active: "", options: {}, workers: {} };
  }
}

/** Lists the IndexedDB databases in this origin */
export async function listDatabases(): Promise<string[]> {
  if (!indexedDB.databases) return [];
  const dbs = await indexedDB.databases();
  return dbs
    .map((d) => d.name)
    .filter((n): n is string => !!n)
    .sort();
}

class DBManager {
  private listeners = new Set<() => void>();
  private connections = new Map<string, Connection>();
  private pending = new Map<string, Promise<Connection>>();
  private saved: Saved;
  snapshot: DBSnapshot;

  constructor() {
    this.saved = loadSaved();
    // first run: start with a default database tab
    if (!localStorage.getItem(STORAGE_KEY))
      this.saved = { tabs: [DEFAULT_NAME], active: DEFAULT_NAME, options: {} };
    this.snapshot = {
      name: this.saved.active,
      options: this.optionsFor(this.saved.active),
      worker: this.isWorker(this.saved.active),
      store: null,
      db: null,
      nostr: null,
      ready: false,
      generation: 0,
      tabs: this.saved.tabs,
      listVersion: 0,
    };
  }

  private optionsFor(name: string): ExplorerOptions {
    return { ...DEFAULT_OPTIONS, ...this.saved.options[name] };
  }

  /** whether a database is set to run in a worker */
  isWorker(name: string) {
    return !!this.saved.workers?.[name];
  }

  private persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
  }

  private emit(listChanged = false) {
    const name = this.saved.active;
    const conn = this.connections.get(name);
    const swapped =
      name !== this.snapshot.name || conn?.store !== this.snapshot.store;
    this.snapshot = {
      name,
      options: this.optionsFor(name),
      worker: conn ? conn.kind === "worker" : this.isWorker(name),
      store: conn?.store ?? null,
      db: conn?.kind === "main" ? conn.db : null,
      nostr: conn?.kind === "main" ? conn.nostr : null,
      ready: !!conn,
      generation: this.snapshot.generation + (swapped ? 1 : 0),
      tabs: this.saved.tabs,
      listVersion: this.snapshot.listVersion + (listChanged ? 1 : 0),
    };
    this.persist();
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** the active database's public API, throws if not ready */
  get store() {
    if (!this.snapshot.store) throw new Error("Database not open");
    return this.snapshot.store;
  }
  /** the active raw IndexedDB handle, throws if not ready or in a worker */
  get db() {
    if (this.snapshot.worker) throw new Error("Database runs in a worker");
    if (!this.snapshot.db) throw new Error("Database not open");
    return this.snapshot.db;
  }
  /** the active NostrIDB instance, throws if not ready or in a worker */
  get nostr() {
    if (this.snapshot.worker) throw new Error("Database runs in a worker");
    if (!this.snapshot.nostr) throw new Error("Database not open");
    return this.snapshot.nostr;
  }

  private connect(name: string): Promise<Connection> {
    const existing = this.connections.get(name);
    if (existing) return Promise.resolve(existing);
    let pending = this.pending.get(name);
    if (!pending) {
      const options = this.optionsFor(name);
      const connecting: Promise<Connection> = this.isWorker(name)
        ? track("db", `new Worker() → openDB("${name}")`, () =>
            startWorker(name, options),
          )
        : track(
            "db",
            `openDB("${name}")`,
            () => openDB(name),
            (db) => `v${db.version}`,
          ).then((db) => {
            const nostr = new NostrIDB(db, options);
            return { kind: "main", store: nostr, db, nostr };
          });
      pending = connecting
        .then((conn) => {
          this.connections.set(name, conn);
          return conn;
        })
        .finally(() => this.pending.delete(name));
      this.pending.set(name, pending);
    }
    return pending;
  }

  private async disconnect(name: string) {
    await this.pending.get(name)?.catch(() => {});
    const conn = this.connections.get(name);
    if (!conn) return;
    this.connections.delete(name);
    if (conn.kind === "worker") return stopWorker(conn);
    await conn.nostr.stop();
    conn.db.close();
  }

  /** Open the active tab on startup */
  async init() {
    if (this.saved.active) await this.open(this.saved.active);
  }

  /**
   * Open a database as a tab (creating it if needed) and make it active.
   * `worker` picks the thread for a database that is not already open.
   */
  async open(name: string, worker?: boolean) {
    name = name.trim();
    if (!name) return;
    if (worker !== undefined && !this.connections.has(name))
      this.saved = {
        ...this.saved,
        workers: { ...this.saved.workers, [name]: worker },
      };
    if (!this.saved.tabs.includes(name))
      this.saved = { ...this.saved, tabs: [...this.saved.tabs, name] };
    this.saved = { ...this.saved, active: name };
    this.emit();
    try {
      await this.connect(name);
    } finally {
      this.emit(true);
    }
  }

  /** Close a database tab, keeping its data */
  async close(name = this.saved.active) {
    const { tabs, active } = this.saved;
    const i = tabs.indexOf(name);
    if (i === -1) return;
    const rest = tabs.filter((t) => t !== name);
    const next =
      active === name ? (rest[Math.min(i, rest.length - 1)] ?? "") : active;
    this.saved = { ...this.saved, tabs: rest, active: next };
    this.emit();
    if (this.connections.has(name) || this.pending.has(name))
      await track("db", `close("${name}")`, () => this.disconnect(name));
    if (next) await this.open(next);
  }

  /** Close a database tab and delete the database */
  async remove(name: string) {
    await this.close(name);
    const { [name]: _, ...options } = this.saved.options;
    const { [name]: __, ...workers } = this.saved.workers ?? {};
    this.saved = { ...this.saved, options, workers };
    this.persist();
    await track("db", `deleteDB("${name}")`, () => deleteDB(name));
    this.emit(true);
  }

  /** Change a database's options and reconnect it */
  async reopen(name: string, options: ExplorerOptions, worker: boolean) {
    this.saved = {
      ...this.saved,
      options: { ...this.saved.options, [name]: options },
      workers: { ...this.saved.workers, [name]: worker },
    };
    await this.disconnect(name);
    this.emit();
    await this.open(name);
  }

  /** Delete the active database and reopen it empty */
  async drop() {
    const name = this.saved.active;
    if (!name) return;
    await this.disconnect(name);
    this.emit();
    await track("db", `deleteDB("${name}")`, () => deleteDB(name));
    await this.open(name);
  }
}

export const manager = new DBManager();

export function useDB() {
  return useSyncExternalStore(manager.subscribe, () => manager.snapshot);
}

export type LiveStats = {
  events: number;
  /** main-thread only stats read from NostrIDB internals */
  pendingWrites?: number;
  cachedIndexes?: number;
  memoryEvents?: number;
  subscriptions?: number;
  usage?: number;
  quota?: number;
};

/** Reads the number of events waiting in the write queue */
export function pendingWrites(nostr: NostrIDB) {
  // the queue internals are private, peek at them for display purposes
  const q = nostr.writeQueue as unknown as {
    eventQueue: unknown[];
    eventQueueHead: number;
  } | null;
  return q ? q.eventQueue.length - q.eventQueueHead : 0;
}

/** Polls cheap stats from the database */
export function useLiveStats(interval = 1000): LiveStats | null {
  const { store, db, nostr } = useDB();
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    setStats(null);
    if (!store) return;
    let stop = false;
    let tick = 0;
    let storage: { usage?: number; quota?: number } = {};

    async function poll() {
      if (stop || !store) return;
      try {
        if (tick++ % 5 === 0 && navigator.storage?.estimate)
          storage = await navigator.storage.estimate();
        // a worker only exposes the public API, so count through it
        const events = db ? await countEvents(db) : await store.count({});
        if (stop) return;
        setStats({
          events,
          pendingWrites: nostr ? pendingWrites(nostr) : undefined,
          cachedIndexes: nostr?.indexCache.count,
          memoryEvents: nostr?.eventMap.size,
          subscriptions: nostr?.subscriptions.size,
          usage: storage.usage,
          quota: storage.quota,
        });
      } catch {
        // database closed while polling
      }
      if (!stop) setTimeout(poll, interval);
    }
    poll();
    return () => {
      stop = true;
    };
  }, [store, db, nostr, interval]);

  return stats;
}

/**
 * Keep the NostrIDB index cache in step with events written by the raw
 * `addEvents()` function, which does not know about the cache
 */
export function indexEvents(events: StoredEvent[]) {
  const cache = manager.snapshot.nostr?.indexCache;
  if (cache) for (const e of events) cache.addEventToIndexes(e);
}

/**
 * Batch write events with `addEvents()` and update the index cache. A
 * database in a worker has no raw handle, so its events go through `add()`
 * (messages are pipelined, and the worker batches them in its write queue).
 */
export async function writeEvents(events: StoredEvent[]) {
  if (manager.snapshot.worker) {
    const store = manager.store;
    await Promise.all(events.map((e) => store.add(e)));
    return;
  }
  await addEvents(manager.db, events);
  indexEvents(events);
}
