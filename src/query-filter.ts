import type { Event, Filter } from "nostr-tools";
import type { NostrIDB } from "./schema.js";
import { GENERIC_TAGS } from "./common.js";
import { sortByDate } from "./utils";
import { IndexCache } from "./index-cache";

export function queryForPubkeys(
  db: NostrIDB,
  authors: Filter["authors"] = [],
  indexCache?: IndexCache,
) {
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
  if (loaded.length === authors.length) return ids;

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
  return Promise.all(promises).then(() => ids);
}

export function queryForTag(
  db: NostrIDB,
  tag: string,
  values: string[],
  indexCache?: IndexCache,
) {
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
  if (loaded.length === values.length) return ids;

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
  return Promise.all(promises).then(() => ids);
}

export function queryForKinds(
  db: NostrIDB,
  kinds: Filter["kinds"] = [],
  indexCache?: IndexCache,
) {
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
  if (loaded.length === kinds.length) return ids;

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
    .map((kind) => index.getAllKeys(kind).then((r) => handleResults(kind, r)));

  trans.commit();
  return Promise.all(promises).then(() => ids);
}

export async function queryForTime(
  db: NostrIDB,
  since: number | undefined,
  until: number | undefined,
) {
  let range: IDBKeyRange;
  if (since !== undefined && until !== undefined)
    range = IDBKeyRange.bound(since, until);
  else if (since !== undefined) range = IDBKeyRange.lowerBound(since);
  else if (until !== undefined) range = IDBKeyRange.upperBound(until);
  else throw new Error("Missing since or until");

  const arr = await db.getAllKeysFromIndex("events", "created_at", range);
  const ids = new Set<string>(arr);
  return ids;
}

export async function getIdsForFilter(
  db: NostrIDB,
  filter: Filter,
  indexCache?: IndexCache,
): Promise<Set<string>> {
  // search is not supported, return an empty set
  if (filter.search) return new Set();

  if (filter.ids) return new Set(filter.ids);

  let ids: Set<string> | null = null;
  const and = (set: Set<string>) => {
    if (!ids) ids = set;
    for (const id of ids) {
      if (!set.has(id)) ids.delete(id);
    }
    return ids;
  };

  // query for time first if both are set
  if (filter.since && filter.until)
    and(await queryForTime(db, filter.since, filter.until));

  for (const t of GENERIC_TAGS) {
    const key = `#${t}`;
    const values = filter[key as `#${string}`];
    if (values?.length) and(await queryForTag(db, t, values, indexCache));
  }

  if (filter.authors)
    and(await queryForPubkeys(db, filter.authors, indexCache));
  if (filter.kinds) and(await queryForKinds(db, filter.kinds, indexCache));

  // query for time last if only one is set
  if (
    (filter.since === undefined && filter.until) ||
    (filter.since && filter.until === undefined)
  )
    and(await queryForTime(db, filter.since, filter.until));

  if (ids === null) throw new Error("Empty filter");
  return ids;
}

export async function getIdsForFilters(
  db: NostrIDB,
  filters: Filter[],
  indexCache?: IndexCache,
) {
  if (filters.length === 0) throw new Error("No Filters");

  let ids: Set<string> | null = null;

  for (const filter of filters) {
    const filterIds = await getIdsForFilter(db, filter, indexCache);
    if (!ids) ids = filterIds;
    else for (const id of ids) if (!filterIds.has(id)) ids.delete(id);
  }

  if (ids === null) throw new Error("Empty filters");

  return ids;
}

async function loadEventsById(db: NostrIDB, ids: string[], filters: Filter[]) {
  const events: Event[] = [];
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");
  const index = objectStore.index("id");

  const handleEntry = (e?: { event: Event }) => e && events.push(e.event);

  const promises = Array.from(ids).map((id) => index.get(id).then(handleEntry));

  const sorted = await Promise.all(promises).then(() =>
    events.sort(sortByDate),
  );
  trans.commit();

  let minLimit = Infinity;
  for (const filter of filters) {
    if (filter.limit && filter.limit < minLimit) minLimit = filter.limit;
  }
  if (sorted.length > minLimit) sorted.length = minLimit;

  return sorted;
}
export async function getEventsForFilter(
  db: NostrIDB,
  filter: Filter,
  indexCache?: IndexCache,
) {
  const ids = await getIdsForFilter(db, filter, indexCache);
  return await loadEventsById(db, Array.from(ids), [filter]);
}

export async function getEventsForFilters(
  db: NostrIDB,
  filters: Filter[],
  indexCache?: IndexCache,
) {
  const ids = await getIdsForFilters(db, filters, indexCache);
  return await loadEventsById(db, Array.from(ids), filters);
}

export async function countEventsForFilter(
  db: NostrIDB,
  filter: Filter,
  indexCache?: IndexCache,
) {
  const ids = await getIdsForFilter(db, filter, indexCache);
  return ids.size;
}

export async function countEventsForFilters(
  db: NostrIDB,
  filters: Filter[],
  indexCache?: IndexCache,
) {
  const ids = await getIdsForFilters(db, filters, indexCache);
  return ids.size;
}
