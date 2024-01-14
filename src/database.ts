import {
  DeleteDBCallbacks,
  OpenDBCallbacks,
  deleteDB as idbDeleteDB,
  openDB as idbOpenDB,
} from "idb";
import { NostrIDB, Schema } from "./schema.js";

export const NOSTR_IDB_NAME = "nostr-idb";
export const NOSTR_IDB_VERSION = 2;

export async function openDB(
  name = NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<Schema>,
) {
  return await idbOpenDB<Schema>(name, NOSTR_IDB_VERSION, {
    ...callbacks,
    upgrade(db, oldVersion, newVersion, transaction, event) {
      if (oldVersion < 2) {
        debugger;
        console.log("resetting DB");
        db.deleteObjectStore("events");
        db.deleteObjectStore("used");
        // @ts-ignore
        db.deleteObjectStore("seen");
      }

      const events = db.createObjectStore("events");
      events.createIndex("id", "event.id", { unique: true });
      events.createIndex("pubkey", "event.pubkey");
      events.createIndex("kind", "event.kind");
      events.createIndex("created_at", "event.created_at");

      events.createIndex("tags", "tags", { multiEntry: true });

      const used = db.createObjectStore("used", { keyPath: "uid" });
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
}
