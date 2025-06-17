import type { Event } from "nostr-tools";
import { NostrIDB } from "./schema.js";

/** Get events for address pointers */
export async function getEventsFromAddressPointers(
  db: NostrIDB,
  pointers: { kind: number; pubkey: string; identifier?: string }[],
) {
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");

  const events: Record<string, Event> = {};
  const promises = pointers.map(async (pointer) => {
    const key = `${pointer.kind}:${pointer.pubkey}:${pointer.identifier ?? ""}`;
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

/** Count events by pubkey */
export async function countEventsByPubkeys(db: NostrIDB) {
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

/** Count events by kind */
export async function countEventsByKind(db: NostrIDB) {
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

/** Count all events in the database */
export function countEvents(db: NostrIDB) {
  return db.transaction("events", "readonly").store.count();
}
