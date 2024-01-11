import type { Event } from "nostr-tools";
import { NostrIDB } from "./schema.js";
import { ReplaceableEventAddress } from "./ingest";

export async function getEventsFromAddressPointers(
  db: NostrIDB,
  pointers: ReplaceableEventAddress[],
) {
  const trans = db.transaction("events", "readonly");
  const index = trans.objectStore("events").index("addressPointer");

  const events: Record<string, Event> = {};
  const promises = pointers.map(async (pointer) => {
    const key = [pointer.kind, pointer.pubkey, pointer.identifier] as [
      number,
      string,
      string | undefined,
    ];
    const row = await index.get(key);

    if (row) {
      const keyStr = key.join(":");
      const existing = events[keyStr];
      if (!existing || row.event.created_at > existing.created_at)
        events[keyStr] = row.event;
    }
  });

  const sorted = await Promise.all(promises).then(() =>
    Object.values(events).sort((a, b) => b.created_at - a.created_at),
  );
  trans.commit();

  return sorted;
}

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

export function countEvents(db: NostrIDB) {
  return db.transaction("events", "readonly").store.count();
}
