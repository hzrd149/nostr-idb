import { useEffect, useRef, useState } from "react";
import type { NostrEvent } from "../../src/lib/nostr.js";
import { IndexCache, NostrIDB, openDB } from "../../src/index.ts";
import type { NostrIDBDatabase } from "../../src/database/schema.ts";

export type DBState = {
  db: NostrIDBDatabase | null;
  nostrIDB: NostrIDB | null;
  indexCache: IndexCache;
  ready: boolean;
  eventCount: number;
  refreshCount: () => Promise<void>;
};

const indexCache = new IndexCache();

export function useNostrIDB(): DBState {
  const [ready, setReady] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const dbRef = useRef<NostrIDBDatabase | null>(null);
  const nostrIDBRef = useRef<NostrIDB | null>(null);

  useEffect(() => {
    openDB("nostr-idb-explorer").then((db) => {
      dbRef.current = db;
      nostrIDBRef.current = new NostrIDB(db);
      setReady(true);
      refreshCount();
    });

    return () => {
      nostrIDBRef.current?.stop();
    };
  }, []);

  async function refreshCount() {
    if (!dbRef.current) return;
    const { countEvents } = await import("../../src/index.ts");
    const n = await countEvents(dbRef.current);
    setEventCount(n);
  }

  return {
    db: dbRef.current,
    nostrIDB: nostrIDBRef.current,
    indexCache,
    ready,
    eventCount,
    refreshCount,
  };
}

export type { NostrEvent };
