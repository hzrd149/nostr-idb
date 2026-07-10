import type { Filter, NostrEvent } from "../lib/nostr.js";
import {
  isAddressableKind,
  isReplaceableKind,
  matchFilters,
  validateEvent,
} from "../lib/nostr.js";
import { sortByDate } from "../utils.js";
import { getEventTags, getEventUID, INDEXABLE_TAGS } from "./common.js";
import { encryptEvent, decryptEvent, hmacIndexToken } from "./encryption.js";
import { getIdsForFilters } from "./query-filter.js";
import type {
  EncryptedNostrIDBDatabase,
  NostrIDBDatabase,
  PrivateNostrIDBDatabase,
} from "./schema.js";

function eventAAD(uid: string): string {
  return `nostr-idb:event:v1:${uid}`;
}

/** Add events to an encrypted database that keeps query metadata in cleartext. */
export async function addEncryptedEvents(
  db: EncryptedNostrIDBDatabase,
  events: NostrEvent[],
  encryptionKey: CryptoKey,
) {
  events = events.filter((event) => validateEvent(event));

  const replaceableEvents = events.filter(
    (e) => isReplaceableKind(e.kind) || isAddressableKind(e.kind),
  );
  const existingEvents: Record<string, number> = {};
  if (replaceableEvents.length > 0) {
    const readTransaction = db.transaction("events", "readonly");
    const promises = replaceableEvents.map((e) => {
      const uid = getEventUID(e);
      return readTransaction.store
        .get(uid)
        .then((r) => r && (existingEvents[uid] = r.event.created_at));
    });
    readTransaction.commit();
    await Promise.all(promises);
  }

  const records: Array<{
    uid: string;
    record: {
      event: {
        id: string;
        pubkey: string;
        kind: number;
        created_at: number;
      };
      tags: string[];
      encrypted: Awaited<ReturnType<typeof encryptEvent>>;
    };
  }> = [];
  for (const event of events) {
    const uid = getEventUID(event);
    if (!existingEvents[uid] || event.created_at >= existingEvents[uid]) {
      records.push({
        uid,
        record: {
          event: {
            id: event.id,
            pubkey: event.pubkey,
            kind: event.kind,
            created_at: event.created_at,
          },
          tags: getEventTags(event),
          encrypted: await encryptEvent(event, encryptionKey, eventAAD(uid)),
        },
      });
    }
  }

  const writeTransaction = db.transaction("events", "readwrite");
  for (const { uid, record } of records) {
    writeTransaction.objectStore("events").put(record, uid);
  }

  await writeTransaction.commit();
}

/** Add events to an encrypted database with HMAC-tokenized query indexes. */
export async function addPrivateEvents(
  db: PrivateNostrIDBDatabase,
  events: NostrEvent[],
  encryptionKey: CryptoKey,
  indexKey: CryptoKey,
) {
  events = events.filter((event) => validateEvent(event));

  const existingEvents: Record<string, number> = {};
  const privateKeys = new Map<NostrEvent, string>();
  const replaceableEvents = events.filter(
    (e) => isReplaceableKind(e.kind) || isAddressableKind(e.kind),
  );

  for (const event of events) {
    privateKeys.set(event, await getPrivateEventKey(indexKey, event));
  }

  if (replaceableEvents.length > 0) {
    const readTransaction = db.transaction("events", "readonly");
    const promises = replaceableEvents.map((e) => {
      const key = privateKeys.get(e)!;
      return readTransaction.store
        .get(key)
        .then((r) => r && (existingEvents[key] = r.indexes.created_at));
    });
    readTransaction.commit();
    await Promise.all(promises);
  }

  const records: Array<{
    key: string;
    record: {
      indexes: Awaited<ReturnType<typeof getPrivateEventIndexes>>;
      encrypted: Awaited<ReturnType<typeof encryptEvent>>;
    };
  }> = [];
  for (const event of events) {
    const key = privateKeys.get(event)!;
    if (!existingEvents[key] || event.created_at >= existingEvents[key]) {
      records.push({
        key,
        record: {
          indexes: await getPrivateEventIndexes(indexKey, event),
          encrypted: await encryptEvent(event, encryptionKey, eventAAD(key)),
        },
      });
    }
  }

  const writeTransaction = db.transaction("events", "readwrite");
  for (const { key, record } of records) {
    writeTransaction.objectStore("events").put(record, key);
  }

  await writeTransaction.commit();
}

/** Returns the event with a clear primary key from an encrypted database. */
export async function getEncryptedEvent(
  db: EncryptedNostrIDBDatabase,
  uid: string,
  encryptionKey: CryptoKey,
): Promise<NostrEvent | undefined> {
  const row = await db.get("events", uid);
  if (!row) return undefined;
  return await decryptEvent(row.encrypted, encryptionKey, eventAAD(uid));
}

/** Returns the event with a tokenized primary key from a private database. */
export async function getPrivateEvent(
  db: PrivateNostrIDBDatabase,
  uid: string,
  encryptionKey: CryptoKey,
  indexKey: CryptoKey,
): Promise<NostrEvent | undefined> {
  const key = await hmacIndexToken(indexKey, "uid", uid);
  const row = await db.get("events", key);
  if (!row) return undefined;
  return await decryptEvent(row.encrypted, encryptionKey, eventAAD(key));
}

/** Return events matching filters from a clear-metadata encrypted database. */
export async function getEncryptedEventsForFilters(
  db: EncryptedNostrIDBDatabase,
  filters: Filter[],
  encryptionKey: CryptoKey,
  eventMap?: Map<string, NostrEvent>,
): Promise<NostrEvent[]> {
  const ids = await getIdsForFilters(
    db as unknown as NostrIDBDatabase,
    filters,
  );
  return await loadEncryptedEventsByUID(
    db,
    Array.from(ids),
    filters,
    encryptionKey,
    eventMap,
  );
}

/** Return events matching filters from a private-index encrypted database. */
export async function getPrivateEventsForFilters(
  db: PrivateNostrIDBDatabase,
  filters: Filter[],
  encryptionKey: CryptoKey,
  indexKey: CryptoKey,
  eventMap?: Map<string, NostrEvent>,
): Promise<NostrEvent[]> {
  const ids = await getPrivateIdsForFilters(db, filters, indexKey);
  return await loadPrivateEventsByKey(
    db,
    Array.from(ids),
    filters,
    encryptionKey,
    eventMap,
  );
}

/** Return the count of events matching filters in a private-index encrypted database. */
export async function countPrivateEventsForFilters(
  db: PrivateNostrIDBDatabase,
  filters: Filter[],
  indexKey: CryptoKey,
): Promise<number> {
  return (await getPrivateIdsForFilters(db, filters, indexKey)).size;
}

/** Return the count of events matching filters in a clear-metadata encrypted database. */
export async function countEncryptedEventsForFilters(
  db: EncryptedNostrIDBDatabase,
  filters: Filter[],
): Promise<number> {
  return (await getIdsForFilters(db as unknown as NostrIDBDatabase, filters))
    .size;
}

/** Prune encrypted/private events by least-recently-used primary key. */
export async function pruneEncryptedLastUsed(
  db: EncryptedNostrIDBDatabase | PrivateNostrIDBDatabase,
  maxEvents: number,
) {
  const writableDb = db as EncryptedNostrIDBDatabase;
  const count = await db.count("events");
  if (count <= maxEvents) return;

  const used = (await db.getAll("used")).sort((a, b) => a.date - b.date);
  const uidsToDelete = used
    .slice(0, count - maxEvents)
    .map((entry) => entry.uid);
  if (uidsToDelete.length === 0) return;

  const eventsTransaction = writableDb.transaction("events", "readwrite");
  const usedTransaction = writableDb.transaction("used", "readwrite");
  const promises: Promise<void>[] = [];

  for (const uid of uidsToDelete) {
    promises.push(eventsTransaction.store.delete(uid));
    promises.push(usedTransaction.store.delete(uid));
  }

  eventsTransaction.commit();
  usedTransaction.commit();
  await Promise.all(promises);
}

/** Delete a clear-metadata encrypted event by clear primary key. */
export async function deleteEncryptedEvent(
  db: EncryptedNostrIDBDatabase,
  uid: string,
): Promise<boolean> {
  const transaction = db.transaction("events", "readwrite");
  const objectStore = transaction.objectStore("events");
  const existing = await objectStore.get(uid);
  if (!existing) {
    await transaction.commit();
    return false;
  }

  await objectStore.delete(uid);
  await transaction.commit();
  return true;
}

/** Delete a private-index encrypted event by clear UID. */
export async function deletePrivateEvent(
  db: PrivateNostrIDBDatabase,
  uid: string,
  indexKey: CryptoKey,
): Promise<boolean> {
  return await deletePrivateEventByKey(
    db,
    await hmacIndexToken(indexKey, "uid", uid),
  );
}

/** Delete clear-metadata encrypted events matching filters. */
export async function deleteEncryptedByFilters(
  db: EncryptedNostrIDBDatabase,
  filters: Filter[],
): Promise<number> {
  const ids = await getIdsForFilters(
    db as unknown as NostrIDBDatabase,
    filters,
  );
  const transaction = db.transaction("events", "readwrite");
  let count = 0;
  for (const id of ids) {
    await transaction.store.delete(id);
    count++;
  }
  await transaction.commit();
  return count;
}

/** Delete private-index encrypted events matching filters. */
export async function deletePrivateByFilters(
  db: PrivateNostrIDBDatabase,
  filters: Filter[],
  indexKey: CryptoKey,
): Promise<number> {
  const ids = await getPrivateIdsForFilters(db, filters, indexKey);
  const transaction = db.transaction("events", "readwrite");
  let count = 0;
  for (const id of ids) {
    await transaction.store.delete(id);
    count++;
  }
  await transaction.commit();
  return count;
}

/** Clear all events from an encrypted or private database. */
export async function deleteAllEncryptedEvents(
  db: EncryptedNostrIDBDatabase | PrivateNostrIDBDatabase,
): Promise<void> {
  await db.clear("events");
}

/** Update the last used timestamp of the given encrypted/private primary keys. */
export async function updateEncryptedUsed(
  db: EncryptedNostrIDBDatabase | PrivateNostrIDBDatabase,
  uids: Iterable<string>,
) {
  const trans = (db as EncryptedNostrIDBDatabase).transaction(
    "used",
    "readwrite",
  );
  const nowUnix = Math.floor(new Date().valueOf() / 1000);

  for (const uid of uids) {
    trans.objectStore("used").put({ uid, date: nowUnix });
  }

  await trans.commit();
}

async function loadEncryptedEventsByUID(
  db: EncryptedNostrIDBDatabase,
  uids: string[],
  filters: Filter[],
  encryptionKey: CryptoKey,
  eventMap?: Map<string, NostrEvent>,
): Promise<NostrEvent[]> {
  const eventBuffer: NostrEvent[] = [];
  let remainingIds: string[] = [];
  if (eventMap) {
    for (const uid of uids) {
      const event = eventMap.get(uid);
      if (event) eventBuffer.push(event);
      else remainingIds.push(uid);
    }
  } else remainingIds = uids;

  const trans = db.transaction("events", "readonly");
  const promises = remainingIds.map(async (uid) => {
    const row = await trans.store.get(uid);
    if (row)
      eventBuffer.push(
        await decryptEvent(row.encrypted, encryptionKey, eventAAD(uid)),
      );
  });
  trans.commit();

  await Promise.all(promises);
  return sortAndLimit(
    eventBuffer.filter((e) => matchFilters(filters, e)),
    filters,
  );
}

async function loadPrivateEventsByKey(
  db: PrivateNostrIDBDatabase,
  keys: string[],
  filters: Filter[],
  encryptionKey: CryptoKey,
  eventMap?: Map<string, NostrEvent>,
): Promise<NostrEvent[]> {
  const eventBuffer: NostrEvent[] = [];
  let remainingKeys: string[] = [];
  if (eventMap) {
    for (const key of keys) {
      const event = eventMap.get(key);
      if (event) eventBuffer.push(event);
      else remainingKeys.push(key);
    }
  } else remainingKeys = keys;

  const trans = db.transaction("events", "readonly");
  const promises = remainingKeys.map(async (key) => {
    const row = await trans.store.get(key);
    if (row)
      eventBuffer.push(
        await decryptEvent(row.encrypted, encryptionKey, eventAAD(key)),
      );
  });
  trans.commit();

  await Promise.all(promises);
  return sortAndLimit(
    eventBuffer.filter((e) => matchFilters(filters, e)),
    filters,
  );
}

function sortAndLimit(events: NostrEvent[], filters: Filter[]): NostrEvent[] {
  const sorted = events.sort(sortByDate);
  let minLimit = Infinity;
  for (const filter of filters) {
    if (filter.limit && filter.limit < minLimit) minLimit = filter.limit;
  }
  if (sorted.length > minLimit) sorted.length = minLimit;
  return sorted;
}

async function getPrivateEventKey(
  indexKey: CryptoKey,
  event: NostrEvent,
): Promise<string> {
  return await hmacIndexToken(indexKey, "uid", getEventUID(event));
}

async function getPrivateEventIndexes(indexKey: CryptoKey, event: NostrEvent) {
  return {
    id: await hmacIndexToken(indexKey, "id", event.id),
    pubkey: await hmacIndexToken(indexKey, "pubkey", event.pubkey),
    kind: await hmacIndexToken(indexKey, "kind", event.kind),
    created_at: event.created_at,
    tags: await Promise.all(
      getEventTags(event).map((tag) => hmacIndexToken(indexKey, "tag", tag)),
    ),
  };
}

async function getPrivateIdsForFilters(
  db: PrivateNostrIDBDatabase,
  filters: Filter[],
  indexKey: CryptoKey,
): Promise<Set<string>> {
  if (filters.length === 0) throw new Error("No Filters");

  const ids = new Set<string>();
  for (const filter of filters) {
    const filterIds = await getPrivateIdsForFilter(db, filter, indexKey);
    for (const id of filterIds) ids.add(id);
  }
  return ids;
}

async function getPrivateIdsForFilter(
  db: PrivateNostrIDBDatabase,
  filter: Filter,
  indexKey: CryptoKey,
): Promise<Set<string>> {
  if (filter.search) return new Set();

  let ids: Set<string> | null = null;
  const and = (iterable: Iterable<string>) => {
    const set = iterable instanceof Set ? iterable : new Set(iterable);
    if (!ids) ids = set;
    else for (const id of ids) if (!set.has(id)) ids.delete(id);
    return ids;
  };

  let timeFilterIds: string[] | null = null;

  if (filter.ids) {
    and(
      await queryPrivateIndex(
        db,
        "id",
        await tokenValues(indexKey, "id", filter.ids),
      ),
    );
  }

  if (filter.since !== undefined) {
    timeFilterIds = await queryPrivateForTime(db, filter.since, filter.until);
    and(timeFilterIds);
  }

  for (const t of INDEXABLE_TAGS) {
    const andValues = filter[`&${t}` as `&${string}`];
    const orValues = filter[`#${t}` as `#${string}`];

    if (andValues?.length) {
      and(
        await queryPrivateForTagAnd(
          db,
          await tokenValues(
            indexKey,
            "tag",
            andValues.map((v) => t + v),
          ),
        ),
      );
    }

    if (orValues?.length) {
      const filteredOrValues = andValues?.length
        ? orValues.filter((v) => !andValues.includes(v))
        : orValues;
      if (filteredOrValues.length > 0) {
        and(
          await queryPrivateIndex(
            db,
            "tags",
            await tokenValues(
              indexKey,
              "tag",
              filteredOrValues.map((v) => t + v),
            ),
          ),
        );
      }
    }
  }

  if (filter.authors)
    and(
      await queryPrivateIndex(
        db,
        "pubkey",
        await tokenValues(indexKey, "pubkey", filter.authors),
      ),
    );
  if (filter.kinds)
    and(
      await queryPrivateIndex(
        db,
        "kind",
        await tokenValues(indexKey, "kind", filter.kinds),
      ),
    );

  if (filter.since === undefined && filter.until !== undefined) {
    timeFilterIds = await queryPrivateForTime(db, filter.since, filter.until);
    and(timeFilterIds);
  }

  const currentIds = ids as Set<string> | null;
  if (filter.limit && timeFilterIds && currentIds) {
    const limitIds = new Set<string>();
    for (const id of timeFilterIds) {
      if (limitIds.size >= filter.limit) break;
      if (currentIds.has(id)) limitIds.add(id);
    }
    return limitIds;
  }

  if (ids === null) throw new Error("Empty filter");
  return ids;
}

async function tokenValues(
  key: CryptoKey,
  namespace: string,
  values: Array<string | number>,
): Promise<string[]> {
  return await Promise.all(
    values.map((value) => hmacIndexToken(key, namespace, value)),
  );
}

async function queryPrivateIndex(
  db: PrivateNostrIDBDatabase,
  indexName: "id" | "pubkey" | "kind" | "tags",
  values: string[],
): Promise<Set<string>> {
  const trans = db.transaction("events", "readonly");
  const index = trans.store.index(indexName);
  const ids = new Set<string>();
  const promises = values.map(async (value) => {
    const result = await index.getAllKeys(value);
    for (const id of result) ids.add(String(id));
  });
  trans.commit();
  await Promise.all(promises);
  return ids;
}

async function queryPrivateForTagAnd(
  db: PrivateNostrIDBDatabase,
  values: string[],
): Promise<Set<string>> {
  if (values.length === 0) return new Set();
  const sets: Set<string>[] = [];
  for (const value of values)
    sets.push(await queryPrivateIndex(db, "tags", [value]));
  return intersectSets(sets);
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set<string>();
  const sorted = sets.slice().sort((a, b) => a.size - b.size);
  let intersection = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const nextIntersection = new Set<string>();
    for (const id of intersection) {
      if (next.has(id)) nextIntersection.add(id);
    }
    intersection = nextIntersection;
    if (intersection.size === 0) return intersection;
  }
  return intersection;
}

async function queryPrivateForTime(
  db: PrivateNostrIDBDatabase,
  since: number | undefined,
  until: number | undefined,
): Promise<string[]> {
  let range: IDBKeyRange;
  if (since !== undefined && until !== undefined)
    range = IDBKeyRange.bound(since, until);
  else if (since !== undefined) range = IDBKeyRange.lowerBound(since);
  else if (until !== undefined) range = IDBKeyRange.upperBound(until);
  else throw new Error("Missing since or until");

  return (await db.getAllKeysFromIndex("events", "created_at", range))
    .map(String)
    .reverse();
}

async function deletePrivateEventByKey(
  db: PrivateNostrIDBDatabase,
  key: string,
): Promise<boolean> {
  const transaction = db.transaction("events", "readwrite");
  const objectStore = transaction.objectStore("events");
  const existing = await objectStore.get(key);
  if (!existing) {
    await transaction.commit();
    return false;
  }

  await objectStore.delete(key);
  await transaction.commit();
  return true;
}
