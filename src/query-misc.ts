import { NostrIDB } from "./schema.js";

export async function countEventsByAllPubkeys(db: NostrIDB) {
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

export async function countEventsByPubkey(db: NostrIDB, pubkey: string) {
  return await db
    .transaction("events", "readonly")
    .objectStore("events")
    .index("pubkey")
    .count(pubkey);
}

export function countEvents(db: NostrIDB) {
  return db.transaction("events", "readonly").store.count();
}
