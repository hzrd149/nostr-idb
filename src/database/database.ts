import {
  DeleteDBCallbacks,
  deleteDB as idbDeleteDB,
  openDB as idbOpenDB,
  IDBPTransaction,
  OpenDBCallbacks,
} from "idb";
import { isAddressableKind, isReplaceableKind } from "nostr-tools/kinds";
import { getEventUID } from "./common.js";
import { NostrIDBDatabase, Schema } from "./schema.js";

export const NOSTR_IDB_NAME = "nostr-idb";
export const NOSTR_IDB_VERSION = 3;

/** Open a database with the given name and version */
export async function openDB(
  name = NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<Schema>,
): Promise<NostrIDBDatabase> {
  return await idbOpenDB<Schema>(name, NOSTR_IDB_VERSION, {
    ...callbacks,
    async upgrade(db, oldVersion, newVersion, transaction, event) {
      if (oldVersion === 0) {
        const events = db.createObjectStore("events");
        events.createIndex("id", "event.id", { unique: true });
        events.createIndex("pubkey", "event.pubkey");
        events.createIndex("kind", "event.kind");
        events.createIndex("created_at", "event.created_at");

        events.createIndex("tags", "tags", { multiEntry: true });

        const used = db.createObjectStore("used", { keyPath: "uid" });
        used.createIndex("date", "date");
      }

      // Migrate from v1 to v2
      if (oldVersion === 1) {
        db.deleteObjectStore("events");
        db.deleteObjectStore("used");
        // @ts-ignore
        db.deleteObjectStore("seen");
      }

      // Migrate replaceable event UIDs for v3
      if (oldVersion <= 2) await migrateReplaceableEventUIDs(transaction);

      if (callbacks?.upgrade)
        callbacks.upgrade(db, oldVersion, newVersion, transaction, event);
    },
  });
}

/** Delete a database with the given name and version */
export async function deleteDB(
  name = NOSTR_IDB_NAME,
  callbacks?: DeleteDBCallbacks,
) {
  return await idbDeleteDB(name, callbacks);
}

/** Clear all events and used from the database */
export async function clearDB(db: NostrIDBDatabase) {
  await db.clear("events");
  await db.clear("used");
}

/** Migrate replaceable event UIDs for v3 */
async function migrateReplaceableEventUIDs(
  transaction: IDBPTransaction<Schema, ("events" | "used")[], "versionchange">,
) {
  const objectStore = transaction.objectStore("events");
  let cursor = await objectStore.openCursor();

  const eventsToMigrate: Array<{ oldKey: string; newKey: string; value: any }> =
    [];

  // First pass: collect all events that need migration
  while (cursor) {
    const oldKey = cursor.primaryKey;
    const record = cursor.value;
    const event = record.event;

    // Check if this is a replaceable event that needs migration
    if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
      const newKey = getEventUID(event);

      // Only migrate if the key format has actually changed
      if (oldKey !== newKey) {
        eventsToMigrate.push({ oldKey, newKey, value: record });
      }
    }

    cursor = await cursor.continue();
  }

  // Second pass: perform the migration
  for (const { oldKey, newKey, value } of eventsToMigrate) {
    // Remove the old entry
    await objectStore.delete(oldKey);

    // Add it back with the new key
    await objectStore.put(value, newKey);
  }
}
