import type { Event, Filter } from "nostr-tools";
import type { NostrIDB } from "./schema.js";
import { GENERIC_TAGS } from "./common.js";
import { sortByDate } from "./utils";

export function queryForPubkeys(db: NostrIDB, authors: Filter["authors"] = []) {
  const ids = new Set<string>();
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");
  const index = objectStore.index("pubkey");

  const handleEvents = (result: string[]) => {
    for (const id of result) ids.add(id);
  };

  const promises = authors.map((pubkey) =>
    index.getAllKeys(pubkey).then(handleEvents),
  );

  const result = Promise.all(promises).then(() => ids);
  trans.commit();

  return result;
}

export function queryForTag(db: NostrIDB, tag: string, values: string[]) {
  const ids = new Set<string>();
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");
  const index = objectStore.index("tags");

  const handleEvents = (result: string[]) => {
    for (const id of result) ids.add(id);
  };

  const promises = values.map((v) =>
    index.getAllKeys(tag + v).then(handleEvents),
  );

  const result = Promise.all(promises).then(() => ids);
  trans.commit();

  return result;
}

export function queryForKinds(db: NostrIDB, kinds: Filter["kinds"] = []) {
  const ids = new Set<string>();
  const trans = db.transaction("events", "readonly");
  const objectStore = trans.objectStore("events");
  const index = objectStore.index("kind");

  const handleEvents = (result: string[]) => {
    for (const id of result) ids.add(id);
  };

  const promises = kinds.map((kind) =>
    index.getAllKeys(kind).then(handleEvents),
  );

  const result = Promise.all(promises).then(() => ids);
  trans.commit();

  return result;
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

  const arr = await db.getAllKeysFromIndex("events", "create_at", range);
  const ids = new Set<string>(arr);
  return ids;
}

export async function getIdsForFilter(
  db: NostrIDB,
  filter: Filter,
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
    if (values?.length) and(await queryForTag(db, t, values));
  }

  if (filter.authors) and(await queryForPubkeys(db, filter.authors));
  if (filter.kinds) and(await queryForKinds(db, filter.kinds));

  // query for time last if only one is set
  if (
    (filter.since === undefined && filter.until) ||
    (filter.since && filter.until === undefined)
  )
    and(await queryForTime(db, filter.since, filter.until));

  if (ids === null) throw new Error("Empty filter");
  return ids;
}

export async function getIdsForFilters(db: NostrIDB, filters: Filter[]) {
  if (filters.length === 0) throw new Error("No Filters");

  let ids: Set<string> | null = null;

  for (const filter of filters) {
    const filterIds = await getIdsForFilter(db, filter);
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
export async function getEventsForFilter(db: NostrIDB, filter: Filter) {
  const ids = await getIdsForFilter(db, filter);
  return await loadEventsById(db, Array.from(ids), [filter]);
}

export async function getEventsForFilters(db: NostrIDB, filters: Filter[]) {
  const ids = await getIdsForFilters(db, filters);
  return await loadEventsById(db, Array.from(ids), filters);
}

export async function countEventsForFilter(db: NostrIDB, filter: Filter) {
  const ids = await getIdsForFilter(db, filter);
  return ids.size;
}

export async function countEventsForFilters(db: NostrIDB, filters: Filter[]) {
  const ids = await getIdsForFilters(db, filters);
  return ids.size;
}
