import type { StoredEvent } from "../lib/nostr.js";
import type { EventReader } from "./metadata.js";
import type { Schema } from "./schema.js";
import { IndexCache } from "../cache/index-cache.js";
import { selectEventsForFilters } from "../utils.js";
import { matchFilter } from "../lib/nostr.js";
import { getEventUID, INDEXABLE_TAGS } from "./common.js";
import type { NostrIDBDatabase } from "./schema.js";
import type { Filter } from "../lib/nostr.js";
import { startTimer } from "../debug.js";

/** Return all events for the given pubkeys */
export async function queryForPubkeys(
  db: NostrIDBDatabase,
  authors: Filter["authors"] = [],
  indexCache?: IndexCache,
): Promise<Set<string>> {
  const end = startTimer("queryForPubkeys", db.name);
  try {
    const loaded: string[] = [];
    const ids = new Set<string>();

    if (indexCache) {
      for (const pubkey of authors) {
        const cached = indexCache.getPubkeyIndex(pubkey);
        if (cached) {
          for (const id of cached) ids.add(id);
          loaded.push(pubkey);
        }
      }
    }

    // all indexes where loaded from indexCache
    if (loaded.length === authors.length) return Promise.resolve(ids);

    // load remaining indexes from db
    const trans = db.transaction("events", "readonly");
    const objectStore = trans.objectStore("events");
    const index = objectStore.index("pubkey");

    const handleResults = (pubkey: string, result: string[]) => {
      for (const id of result) ids.add(id);
      // add index to cache
      if (indexCache) indexCache.setPubkeyIndex(pubkey, new Set(result));
    };

    const promises = authors
      .filter((p) => !loaded.includes(p))
      .map((pubkey) =>
        index.getAllKeys(pubkey).then((r) => handleResults(pubkey, r)),
      );

    trans.commit();
    return await Promise.all(promises).then(() => ids);
  } finally {
    end();
  }
}

/** Return all events for the given indexable tag (OR logic) */
export async function queryForTag(
  db: NostrIDBDatabase,
  tag: string,
  values: string[],
  indexCache?: IndexCache,
): Promise<Set<string>> {
  const end = startTimer("queryForTag", db.name);
  try {
    const loaded: string[] = [];
    const ids = new Set<string>();

    if (indexCache) {
      for (const value of values) {
        const cached = indexCache.getTagIndex(tag + value);
        if (cached) {
          for (const id of cached) ids.add(id);
          loaded.push(value);
        }
      }
    }

    // all indexes where loaded from indexCache
    if (loaded.length === values.length) return Promise.resolve(ids);

    // load remaining indexes from db
    const trans = db.transaction("events", "readonly");
    const objectStore = trans.objectStore("events");
    const index = objectStore.index("tags");

    const handleResults = (value: string, result: string[]) => {
      for (const id of result) ids.add(id);
      // add index to cache
      if (indexCache) indexCache.setTagIndex(tag + value, new Set(result));
    };

    const promises = values.map((v) =>
      index.getAllKeys(tag + v).then((r) => handleResults(v, r)),
    );

    trans.commit();
    return await Promise.all(promises).then(() => ids);
  } finally {
    end();
  }
}

/** Return all events for the given indexable tag (AND logic - events must have ALL values) */
export async function queryForTagAnd(
  db: NostrIDBDatabase,
  tag: string,
  values: string[],
  indexCache?: IndexCache,
): Promise<Set<string>> {
  const end = startTimer("queryForTagAnd", db.name);
  try {
    if (values.length === 0) return Promise.resolve(new Set());
    if (values.length === 1) {
      // Single value AND is same as OR
      return await queryForTag(db, tag, values, indexCache);
    }

    const loaded: string[] = [];
    const valueSets: Set<string>[] = [];

    // Load from indexCache
    if (indexCache) {
      for (const value of values) {
        const cached = indexCache.getTagIndex(tag + value);
        if (cached) {
          valueSets.push(cached);
          loaded.push(value);
        }
      }
    }

    // All indexes were loaded from indexCache — no DB round-trip needed
    if (loaded.length === values.length) {
      return Promise.resolve(intersectSets(valueSets));
    }

    // Load remaining indexes from db
    const trans = db.transaction("events", "readonly");
    const objectStore = trans.objectStore("events");
    const index = objectStore.index("tags");

    const handleResults = (value: string, result: string[]) => {
      const s = new Set(result);
      valueSets.push(s);
      // add index to cache
      if (indexCache) indexCache.setTagIndex(tag + value, s);
    };

    const promises = values
      .filter((v) => !loaded.includes(v))
      .map((v) => index.getAllKeys(tag + v).then((r) => handleResults(v, r)));

    trans.commit();
    return await Promise.all(promises).then(() => intersectSets(valueSets));
  } finally {
    end();
  }
}

/** Intersect an array of Sets, iterating from smallest to largest for efficiency */
function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set<string>();

  // Sort ascending by size so we iterate over the smallest set first
  const sorted = sets.slice().sort((a, b) => a.size - b.size);

  let intersection = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const newIntersection = new Set<string>();
    for (const id of intersection) {
      if (next.has(id)) newIntersection.add(id);
    }
    intersection = newIntersection;
    // Short-circuit: empty intersection can never grow
    if (intersection.size === 0) return intersection;
  }
  return intersection;
}

/** Return all events for the given kinds */
export async function queryForKinds(
  db: NostrIDBDatabase,
  kinds: Filter["kinds"] = [],
  indexCache?: IndexCache,
): Promise<Set<string>> {
  const end = startTimer("queryForKinds", db.name);
  try {
    const loaded: number[] = [];
    const ids = new Set<string>();

    // load from indexCache
    if (indexCache) {
      for (const kind of kinds) {
        const cached = indexCache.getKindIndex(kind);
        if (cached) {
          for (const id of cached) ids.add(id);
          loaded.push(kind);
        }
      }
    }

    // all indexes where loaded from indexCache
    if (loaded.length === kinds.length) return Promise.resolve(ids);

    // load remaining indexes from db
    const trans = db.transaction("events", "readonly");
    const index = trans.objectStore("events").index("kind");

    const handleResults = (kind: number, result: string[]) => {
      for (const id of result) ids.add(id);
      // add index to cache
      if (indexCache) indexCache.setKindIndex(kind, new Set(result));
    };

    const promises = kinds
      .filter((k) => !loaded.includes(k))
      .map((kind) =>
        index.getAllKeys(kind).then((r) => handleResults(kind, r)),
      );

    trans.commit();
    return await Promise.all(promises).then(() => ids);
  } finally {
    end();
  }
}

/** Return all events for the given time range */
export async function queryForTime(
  db: NostrIDBDatabase,
  since: number | undefined,
  until: number | undefined,
): Promise<string[]> {
  const end = startTimer("queryForTime", db.name);
  try {
    let range: IDBKeyRange;
    if (since !== undefined && until !== undefined)
      range = IDBKeyRange.bound(since, until);
    else if (since !== undefined) range = IDBKeyRange.lowerBound(since);
    else if (until !== undefined) range = IDBKeyRange.upperBound(until);
    else throw new Error("Missing since or until");

    const ids = (
      await db.getAllKeysFromIndex("events", "created_at", range)
    ).reverse();
    return ids;
  } finally {
    end();
  }
}

/** Return all events for the given filter */
export async function getIdsForFilter(
  db: NostrIDBDatabase,
  filter: Filter,
  indexCache?: IndexCache,
): Promise<Set<string>> {
  // search is not supported, return an empty set
  if (filter.search) return new Set();

  if (filter.ids) {
    const rows = await Promise.all(
      filter.ids.map((id) => db.getFromIndex("events", "id", id)),
    );
    return new Set(
      rows.flatMap((row) =>
        row && matchFilter(filter, row.event) ? [getEventUID(row.event)] : [],
      ),
    );
  }

  let ids: Set<string> | null = null;
  const and = (iterable: Iterable<string>) => {
    const set = iterable instanceof Set ? iterable : new Set(iterable);
    if (!ids) ids = set;
    else for (const id of ids) if (!set.has(id)) ids.delete(id);
    return ids;
  };

  let timeFilterIds: string[] | null = null;

  // query for time first if since is set
  if (filter.since !== undefined) {
    timeFilterIds = await queryForTime(db, filter.since, filter.until);
    and(timeFilterIds);
  }

  for (const t of INDEXABLE_TAGS) {
    // Process &t filters first (AND logic) - they take precedence
    const andKey = `&${t}`;
    const andValues = filter[andKey as `&${string}`];

    // Process #t filters (OR logic), but exclude values that are in &t
    const orKey = `#${t}`;
    const orValues = filter[orKey as `#${string}`];

    if (andValues?.length) {
      // Apply AND logic first
      and(await queryForTagAnd(db, t, andValues, indexCache));
    }

    if (orValues?.length) {
      // Filter out values that are in &t (they should be ignored in OR)
      const filteredOrValues = andValues?.length
        ? orValues.filter((v) => !andValues.includes(v))
        : orValues;

      if (filteredOrValues.length > 0) {
        and(await queryForTag(db, t, filteredOrValues, indexCache));
      }
    }
  }

  if (filter.authors)
    and(await queryForPubkeys(db, filter.authors, indexCache));
  if (filter.kinds) and(await queryForKinds(db, filter.kinds, indexCache));

  // query for time last if only until is set
  if (filter.since === undefined && filter.until !== undefined) {
    timeFilterIds = await queryForTime(db, filter.since, filter.until);
    and(timeFilterIds);
  }

  // if the filter queried on time and has a limit. truncate the ids now
  if (filter.limit && timeFilterIds) {
    const limitIds = new Set<string>();
    for (const id of timeFilterIds) {
      if (limitIds.size >= filter.limit) break;
      if (ids!.has(id)) limitIds.add(id);
    }
    return limitIds;
  }

  if (ids === null) {
    // Empty and limit-only filters match every stored kind. Keep unsupported
    // selector-only filters on their existing error path.
    if (
      !Object.entries(filter).every(
        ([key, value]) =>
          value === undefined ||
          key === "limit" ||
          (key === "search" && !value),
      )
    )
      throw new Error("Empty filter");

    const allIds = new Set<string>();
    if (filter.limit === 0) return allIds;
    const limit =
      Number.isSafeInteger(filter.limit) && filter.limit! > 0
        ? filter.limit
        : undefined;
    const transaction = db.transaction("events", "readonly");
    let cursor = await transaction.store
      .index("created_at")
      .openKeyCursor(null, "prev");
    while (cursor) {
      allIds.add(cursor.primaryKey);
      if (limit !== undefined && allIds.size >= limit) break;
      cursor = await cursor.continue();
    }
    await transaction.done;
    return allIds;
  }
  return ids;
}

/** Return all events for the given filters */
export async function getIdsForFilters(
  db: NostrIDBDatabase,
  filters: Filter[],
  indexCache?: IndexCache,
): Promise<Set<string>> {
  if (filters.length === 0) throw new Error("No Filters");

  let ids = new Set<string>();

  for (const filter of filters) {
    const filterIds = await getIdsForFilter(db, filter, indexCache);
    for (const id of filterIds) ids.add(id);
  }

  return ids;
}

/** Return all events for the given uids */
async function loadEventsByUID<TEvent extends StoredEvent = StoredEvent>(
  db: NostrIDBDatabase,
  uids: string[],
  filters: Filter[],
  eventMap?: Map<string, TEvent>,
  readEvent: EventReader<TEvent> = (row) => row.event as TEvent,
  allowBulkReads = true,
  allowTagLimit = true,
): Promise<TEvent[]> {
  const end = startTimer("loadEventsByUID", db.name);
  try {
    const eventBuffer: TEvent[] = [];

    // load from in-memory event map
    let remainingIds: string[] = [];
    if (eventMap) {
      for (const uid of uids) {
        const event = eventMap.get(uid);
        if (event) eventBuffer.push(event);
        else remainingIds.push(uid);
      }
    } else remainingIds = uids;

    if (remainingIds.length === 0)
      return selectEventsForFilters(eventBuffer, filters);

    const trans = db.transaction("events", "readonly");
    const objectStore = trans.objectStore("events");

    const filter = filters[0];
    const limit = filter.limit;
    // Only optimize index-backed filters. Time-filter candidate truncation and
    // multi-filter limits retain their existing paths. Custom readers may alter
    // tags, so retain their previous loading behavior for tag-limited queries.
    if (
      filters.length === 1 &&
      limit !== undefined &&
      Number.isSafeInteger(limit) &&
      limit > 0 &&
      remainingIds.length >= 128 &&
      remainingIds.length > limit * 2 &&
      Object.keys(filter).every(
        (key) =>
          ["authors", "kinds", "limit"].includes(key) ||
          (allowTagLimit &&
            (key[0] === "#" || key[0] === "&") &&
            INDEXABLE_TAGS.includes(key.slice(1))),
      )
    ) {
      const wanted = new Set(remainingIds);
      const loaded = new Map<string, TEvent>();
      let cursor = await objectStore
        .index("created_at")
        .openKeyCursor(null, "prev");
      let cutoff: number | undefined;
      let matched = 0;
      let scanned = 0;
      const scanBudget = Math.max(512, limit * 8);
      while (cursor) {
        if (cutoff !== undefined && cursor.key < cutoff) break;
        // Avoid scanning the entire time index for sparse candidate selections.
        if (cutoff === undefined && scanned >= scanBudget) break;
        scanned++;
        const uid = cursor.primaryKey;
        if (wanted.has(uid)) {
          const row = await objectStore.get(uid);
          if (row && matchFilter(filter, row.event)) {
            loaded.set(uid, readEvent(row));
            if (++matched === limit) cutoff = cursor.key;
          }
        }
        cursor = await cursor.continue();
      }
      if (!cursor || cutoff !== undefined) {
        trans.commit();
        // Read the whole cutoff timestamp bucket, then restore candidate order:
        // date sorting is stable, and cached events must still precede disk rows.
        // The newest `limit` missing matches suffice even if cached bodies have
        // different timestamps or no longer match the filter.
        for (const uid of remainingIds) {
          const event = loaded.get(uid);
          if (event) eventBuffer.push(event);
        }
        return selectEventsForFilters(eventBuffer, filters);
      }
    }

    // Bulk reads avoid one request/promise chain per body for dense selections.
    // Count first and allow at most 10% over-fetch: a broad index must not turn a
    // sparse query or warm body cache into a large over-read. Time-window queries
    // retain point reads; keep the limited time-cursor strategy above first.
    const bulk =
      allowBulkReads &&
      filters.length === 1 &&
      filter.since === undefined &&
      filter.until === undefined
        ? getBulkReadIndex(filter)
        : undefined;
    if (bulk && remainingIds.length >= 128) {
      const index = objectStore.index(bulk.name);
      const count = await index.count(bulk.key);
      if (count <= remainingIds.length * 1.1) {
        // Keys and rows from the same index/transaction have identical ordering.
        // Use actual primary keys, not getEventUID: callers may retain versions
        // of replaceable events under their exact event IDs.
        const [keys, rows] = await Promise.all([
          index.getAllKeys(bulk.key),
          index.getAll(bulk.key),
        ]);
        trans.commit();
        const positions = new Map(keys.map((key, i) => [key, i]));
        for (const uid of remainingIds) {
          const position = positions.get(uid);
          if (position !== undefined)
            eventBuffer.push(readEvent(rows[position]));
        }
        return selectEventsForFilters(eventBuffer, filters);
      }
    }
    const handleEntry = (e?: Schema["events"]["value"]) =>
      e && eventBuffer.push(readEvent(e));
    const promises = Array.from(remainingIds).map((uid) =>
      objectStore.get(uid).then(handleEntry),
    );
    trans.commit();

    await Promise.all(promises);
    return selectEventsForFilters(eventBuffer, filters);
  } finally {
    end();
  }
}

/** Choose an exact index bucket that contains every candidate for one filter. */
function getBulkReadIndex(
  filter: Filter,
): { name: "tags" | "pubkey" | "kind"; key: string | number } | undefined {
  // IDs use a different lookup path; avoid bulk-reading unrelated index buckets.
  if (filter.ids) return;
  for (const tag of INDEXABLE_TAGS) {
    const values = filter[`&${tag}`]?.length
      ? filter[`&${tag}`]
      : filter[`#${tag}`];
    if (values?.length === 1) return { name: "tags", key: tag + values[0] };
  }
  if (filter.authors?.length === 1)
    return { name: "pubkey", key: filter.authors[0] };
  if (filter.kinds?.length === 1) return { name: "kind", key: filter.kinds[0] };
}

/** Return all events for the given filter */
export async function getEventsForFilter<
  TEvent extends StoredEvent = StoredEvent,
>(
  db: NostrIDBDatabase,
  filter: Filter,
  indexCache?: IndexCache,
  eventMap?: Map<string, TEvent>,
  readEvent?: EventReader<TEvent>,
): Promise<TEvent[]> {
  const end = startTimer("getEventsForFilter", db.name);
  try {
    const ids = await getIdsForFilter(db, filter, indexCache);
    return await loadEventsByUID(
      db,
      Array.from(ids),
      [filter],
      eventMap,
      readEvent,
      !indexCache,
      !readEvent,
    );
  } finally {
    end();
  }
}

/** Return all events for the given filters */
export async function getEventsForFilters<
  TEvent extends StoredEvent = StoredEvent,
>(
  db: NostrIDBDatabase,
  filters: Filter[],
  indexCache?: IndexCache,
  eventMap?: Map<string, TEvent>,
  readEvent?: EventReader<TEvent>,
): Promise<TEvent[]> {
  const end = startTimer("getEventsForFilters", db.name);
  try {
    const ids = await getIdsForFilters(db, filters, indexCache);
    return await loadEventsByUID(
      db,
      Array.from(ids),
      filters,
      eventMap,
      readEvent,
      !indexCache,
      !readEvent,
    );
  } finally {
    end();
  }
}

/** Return the number of events for the given filter */
export async function countEventsForFilter(
  db: NostrIDBDatabase,
  filter: Filter,
  indexCache?: IndexCache,
): Promise<number> {
  const end = startTimer("countEventsForFilter", db.name);
  try {
    const ids = await getIdsForFilter(db, filter, indexCache);
    return ids.size;
  } finally {
    end();
  }
}

/** Return the number of events for the given filters */
export async function countEventsForFilters(
  db: NostrIDBDatabase,
  filters: Filter[],
  indexCache?: IndexCache,
): Promise<number> {
  const end = startTimer("countEventsForFilters", db.name);
  try {
    const ids = await getIdsForFilters(db, filters, indexCache);
    return ids.size;
  } finally {
    end();
  }
}
