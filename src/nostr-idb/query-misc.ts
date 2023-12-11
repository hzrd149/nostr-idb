import { IDBPDatabase } from "idb";
import { Schema } from "./schema";

export async function countEventsByPubkey(db: IDBPDatabase<Schema>) {
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

export function countEvents(db: IDBPDatabase<Schema>) {
  return db.transaction("events", "readonly").store.count();
}
