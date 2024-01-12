import {
  DeleteDBCallbacks,
  OpenDBCallbacks,
  deleteDB as idbDeleteDB,
  openDB as idbOpenDB,
} from "idb";
import { NostrIDB, Schema } from "./schema.js";

export const NOSTR_IDB_NAME = "nostr-idb";
export const NOSTR_IDB_VERSION = 1;

export async function openDB(
  name = NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<Schema>,
) {
  return await idbOpenDB<Schema>(name, NOSTR_IDB_VERSION, {
    ...callbacks,
    upgrade(db, oldVersion, newVersion, transaction, event) {
      const events = db.createObjectStore("events", { keyPath: "event.id" });
      events.createIndex("id", "event.id", { unique: true });
      events.createIndex("pubkey", "event.pubkey");
      events.createIndex("kind", "event.kind");
      events.createIndex("created_at", "event.created_at");

      events.createIndex("tags", "tags", { multiEntry: true });

      events.createIndex("addressPointer", ["kind", "pubkey", "identifier"]);

      const seen = db.createObjectStore("seen", { keyPath: "id" });
      seen.createIndex("date", "date");
      seen.createIndex("relay", "relays", { multiEntry: true });

      const used = db.createObjectStore("used", { keyPath: "id" });
      used.createIndex("date", "date");

      if (callbacks?.upgrade)
        callbacks.upgrade(db, oldVersion, newVersion, transaction, event);
    },
  });
}

export async function deleteDB(
  name = NOSTR_IDB_NAME,
  callbacks?: DeleteDBCallbacks,
) {
  return await idbDeleteDB(name, callbacks);
}

export async function clearDB(db: NostrIDB) {
  await db.clear("events");
  await db.clear("used");
  await db.clear("seen");
}
