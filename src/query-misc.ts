import { NostrIDB } from "./schema.js";

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
