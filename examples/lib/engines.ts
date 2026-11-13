import {
  getEventsForFilters,
  getIdsForFilters,
  type Filter,
  type StoredEvent,
} from "../../src/index.ts";
import { manager } from "./db.ts";

export type Engine = "query" | "raw" | "nocache" | "count" | "ids";

export const ENGINES: { value: Engine; label: string; title: string }[] = [
  { value: "query", label: "NostrIDB.query", title: "nostr.query(filters)" },
  {
    value: "raw",
    label: "getEventsForFilters",
    title: "getEventsForFilters(db, filters, indexCache)",
  },
  {
    value: "nocache",
    label: "no cache",
    title: "getEventsForFilters(db, filters) — no index cache",
  },
  { value: "count", label: "count", title: "nostr.count(filters)" },
  {
    value: "ids",
    label: "ids",
    title: "getIdsForFilters(db, filters, indexCache)",
  },
];

/** Runs filters against an engine, returning events or a number */
export async function runEngine(
  engine: Engine,
  filters: Filter[],
): Promise<StoredEvent[] | number> {
  const { db, nostr } = manager;
  switch (engine) {
    case "query":
      return nostr.query(filters);
    case "raw":
      return getEventsForFilters(db, filters, nostr.indexCache);
    case "nocache":
      return getEventsForFilters(db, filters);
    case "count":
      return nostr.count(filters);
    case "ids":
      return (await getIdsForFilters(db, filters, nostr.indexCache)).size;
  }
}
