import type { NostrEvent } from "nostr-tools/pure";
import { NostrIDBDatabase } from "./schema.js";

/** Returns the events from the given address pointers */
export async function getReplaceableEvents(
  db: NostrIDBDatabase,
  pointers: { kind: number; pubkey: string; identifier?: string }[],
): Promise<NostrEvent[]> {
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");

  const events: Record<string, NostrEvent> = {};
  const promises = pointers.map(async (pointer) => {
    const key = [pointer.kind, pointer.pubkey, pointer.identifier ?? ""].join(
      ":",
    );
    const row = await objectStore.get(key);

    if (row) {
      const existing = events[key];
      if (!existing || row.event.created_at > existing.created_at)
        events[key] = row.event;
    }
  });

  trans.commit();
  const sorted = await Promise.all(promises).then(() =>
    Object.values(events).sort((a, b) => b.created_at - a.created_at),
  );

  return sorted;
}

/** Counts the number of events by each pubkey */
export async function countEventsByPubkeys(
  db: NostrIDBDatabase,
): Promise<Record<string, number>> {
  let cursor = await db
    .transaction("events", "readonly")
    .objectStore("events")
    .index("pubkey")
    .openKeyCursor();
  if (!cursor) return {};

  const counts: Record<string, number> = {};
  while (cursor) {
    const pubkey = cursor.key;
    counts[pubkey] = (counts[pubkey] || 0) + 1;
    cursor = await cursor.continue();
  }

  return counts;
}

/** Counts the number of events by each kind */
export async function countEventsByKind(
  db: NostrIDBDatabase,
): Promise<Record<string, number>> {
  let cursor = await db
    .transaction("events", "readonly")
    .objectStore("events")
    .index("kind")
    .openKeyCursor();
  if (!cursor) return {};

  const counts: Record<string, number> = {};
  while (cursor) {
    const kind = cursor.key;
    counts[kind] = (counts[kind] || 0) + 1;
    cursor = await cursor.continue();
  }

  return counts;
}

/** Returns the total number of events in the database */
export function countEvents(db: NostrIDBDatabase): Promise<number> {
  return db.transaction("events", "readonly").store.count();
}
