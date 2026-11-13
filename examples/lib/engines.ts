import {
  getEventsForFilters,
  getIdsForFilters,
  type Filter,
  type StoredEvent,
} from "../../src/index.ts";
import { manager } from "./db.ts";

export type Engine = "query" | "raw" | "nocache" | "count" | "ids";

export const ENGINES: {
  value: Engine;
  label: string;
  title: string;
  /** needs the raw IndexedDB handle, so only works on the main thread */
  raw?: boolean;
}[] = [
  { value: "query", label: "NostrIDB.query", title: "nostr.query(filters)" },
  {
    value: "raw",
    label: "getEventsForFilters",
    title: "getEventsForFilters(db, filters, indexCache)",
    raw: true,
  },
  {
    value: "nocache",
    label: "no cache",
    title: "getEventsForFilters(db, filters) — no index cache",
    raw: true,
  },
  { value: "count", label: "count", title: "nostr.count(filters)" },
  {
    value: "ids",
    label: "ids",
    title: "getIdsForFilters(db, filters, indexCache)",
    raw: true,
  },
];

export function isRawEngine(engine: Engine) {
  return !!ENGINES.find((e) => e.value === engine)?.raw;
}

/** Runs filters against an engine, returning events or a number */
export async function runEngine(
  engine: Engine,
  filters: Filter[],
): Promise<StoredEvent[] | number> {
  // the public API works on either thread
  if (engine === "query") return manager.store.query(filters);
  if (engine === "count") return manager.store.count(filters);

  const { db, nostr } = manager;
  switch (engine) {
    case "raw":
      return getEventsForFilters(db, filters, nostr.indexCache);
    case "nocache":
      return getEventsForFilters(db, filters);
    case "ids":
      return (await getIdsForFilters(db, filters, nostr.indexCache)).size;
  }
}
