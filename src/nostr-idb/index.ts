import { openDB, deleteDB, OpenDBCallbacks, DeleteDBCallbacks } from "idb";
import { Schema } from "./schema";

export const NOSTR_IDB_NAME = "nostr-idb";
export const NOSTR_IDB_VERSION = 1;

export async function openDatabase(
  name = NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<Schema>,
) {
  return await openDB<Schema>(name, NOSTR_IDB_VERSION, {
    ...callbacks,
    upgrade(db, oldVersion, newVersion, transaction, event) {
      const events = db.createObjectStore("events", { keyPath: "event.id" });
      events.createIndex("id", "event.id", { unique: true });
      events.createIndex("pubkey", "event.pubkey");
      events.createIndex("kind", "event.kind");
      events.createIndex("create_at", "event.created_at");
      events.createIndex("tags", "tags", { multiEntry: true });
      events.createIndex("firstSeen", "firstSeen");
      events.createIndex("lastUsed", "lastUsed");

      if (callbacks?.upgrade)
        callbacks.upgrade(db, oldVersion, newVersion, transaction, event);
    },
  });
}

export async function deleteDatabase(
  name = NOSTR_IDB_NAME,
  callbacks?: DeleteDBCallbacks,
) {
  return await deleteDB(name, callbacks);
}

export * from "./query-filter";
export * from "./query-misc";
