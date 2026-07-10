import {
  DeleteDBCallbacks,
  deleteDB as idbDeleteDB,
  openDB as idbOpenDB,
  IDBPTransaction,
  OpenDBCallbacks,
} from "idb";
import { isAddressableKind, isReplaceableKind } from "../lib/nostr.js";
import { getEventUID } from "./common.js";
import {
  EncryptedNostrIDBDatabase,
  EncryptedSchema,
  NostrIDBDatabase,
  PrivateNostrIDBDatabase,
  PrivateSchema,
  Schema,
} from "./schema.js";

export const NOSTR_IDB_NAME = "nostr-idb";
export const NOSTR_IDB_VERSION = 3;
export const ENCRYPTED_NOSTR_IDB_NAME = "nostr-idb-encrypted";
export const ENCRYPTED_NOSTR_IDB_VERSION = 1;
export const PRIVATE_NOSTR_IDB_NAME = "nostr-idb-private";
export const PRIVATE_NOSTR_IDB_VERSION = 1;

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

/** Open an encrypted database that keeps query metadata in cleartext */
export async function openEncryptedDB(
  name = ENCRYPTED_NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<EncryptedSchema>,
): Promise<EncryptedNostrIDBDatabase> {
  return await idbOpenDB<EncryptedSchema>(name, ENCRYPTED_NOSTR_IDB_VERSION, {
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

      if (callbacks?.upgrade)
        callbacks.upgrade(db, oldVersion, newVersion, transaction, event);
    },
  });
}

/** Open an encrypted database that stores HMAC-tokenized query indexes */
export async function openPrivateDB(
  name = PRIVATE_NOSTR_IDB_NAME,
  callbacks?: OpenDBCallbacks<PrivateSchema>,
): Promise<PrivateNostrIDBDatabase> {
  return await idbOpenDB<PrivateSchema>(name, PRIVATE_NOSTR_IDB_VERSION, {
    ...callbacks,
    async upgrade(db, oldVersion, newVersion, transaction, event) {
      if (oldVersion === 0) {
        const events = db.createObjectStore("events");
        events.createIndex("id", "indexes.id", { unique: true });
        events.createIndex("pubkey", "indexes.pubkey");
        events.createIndex("kind", "indexes.kind");
        events.createIndex("created_at", "indexes.created_at");
        events.createIndex("tags", "indexes.tags", { multiEntry: true });

        const used = db.createObjectStore("used", { keyPath: "uid" });
        used.createIndex("date", "date");
      }

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
