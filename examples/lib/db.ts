import { useEffect, useState, useSyncExternalStore } from "react";
import {
  NostrIDB,
  countEvents,
  deleteDB,
  openDB,
  type NostrDBOptions,
  type NostrIDBDatabase,
} from "../../src/index.ts";
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

export type DBSnapshot = {
  name: string;
  options: ExplorerOptions;
  db: NostrIDBDatabase | null;
  nostr: NostrIDB | null;
  ready: boolean;
  /** increments whenever the database is swapped */
  generation: number;
};

function loadSaved(): { name: string; options: ExplorerOptions } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      name: saved.name || "nostr-idb-explorer",
      options: { ...DEFAULT_OPTIONS, ...saved.options },
    };
  } catch {
    return { name: "nostr-idb-explorer", options: DEFAULT_OPTIONS };
  }
}

class DBManager {
  private listeners = new Set<() => void>();
  snapshot: DBSnapshot;

  constructor() {
    const saved = loadSaved();
    this.snapshot = {
      ...saved,
      db: null,
      nostr: null,
      ready: false,
      generation: 0,
    };
  }

  private set(patch: Partial<DBSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** the open db, throws if not ready */
  get db() {
    if (!this.snapshot.db) throw new Error("Database not open");
    return this.snapshot.db;
  }
  get nostr() {
    if (!this.snapshot.nostr) throw new Error("Database not open");
    return this.snapshot.nostr;
  }

  async open(name = this.snapshot.name, options = this.snapshot.options) {
    await this.close();
    const db = await track(
      "db",
      `openDB("${name}")`,
      () => openDB(name),
      (db) => `v${db.version}`,
    );
    const nostr = new NostrIDB(db, options);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, options }));
    this.set({
      name,
      options,
      db,
      nostr,
      ready: true,
      generation: this.snapshot.generation + 1,
    });
  }

  async close() {
    const { db, nostr } = this.snapshot;
    if (!db) return;
    await nostr?.stop();
    db.close();
    this.set({ db: null, nostr: null, ready: false });
  }

  async drop() {
    const name = this.snapshot.name;
    await this.close();
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
  pendingWrites: number;
  cachedIndexes: number;
  memoryEvents: number;
  subscriptions: number;
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
  const { db, nostr } = useDB();
  const [stats, setStats] = useState<LiveStats | null>(null);

  useEffect(() => {
    if (!db || !nostr) return;
    let stop = false;
    let tick = 0;
    let storage: { usage?: number; quota?: number } = {};

    async function poll() {
      if (stop || !db || !nostr) return;
      try {
        if (tick++ % 5 === 0 && navigator.storage?.estimate)
          storage = await navigator.storage.estimate();
        const events = await countEvents(db);
        if (stop) return;
        setStats({
          events,
          pendingWrites: pendingWrites(nostr),
          cachedIndexes: nostr.indexCache.count,
          memoryEvents: nostr.eventMap.size,
          subscriptions: nostr.subscriptions.size,
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
  }, [db, nostr, interval]);

  return stats;
}
