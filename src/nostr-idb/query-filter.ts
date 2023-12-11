import type { Event, Filter } from "nostr-tools";
import type { IDBPDatabase } from "idb";
import type { Schema } from "./schema";
import { GENERIC_TAGS } from "./common";

export function createReadTransaction(db: IDBPDatabase<Schema>) {
  return db.transaction("events", "readonly");
}

export function queryForPubkeys(
  db: IDBPDatabase<Schema>,
  authors: Filter["authors"] = [],
) {
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

export function queryForTag(
  db: IDBPDatabase<Schema>,
  tag: string,
  values: string[],
) {
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

export function queryForKinds(
  db: IDBPDatabase<Schema>,
  kinds: Filter["kinds"] = [],
) {
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
  db: IDBPDatabase<Schema>,
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

export async function getEventsForFilters<K extends number = number>(
  db: IDBPDatabase<Schema>,
  filters: Filter<K>[],
) {
  let ids: Set<string> | null = null;
  const and = (set: Set<string>) => {
    if (!ids) ids = set;
    for (const id of ids) if (!set.has(id)) ids.delete(id);
  };

  for (const filter of filters) {
    if (filter.ids) and(new Set(filter.ids));
    if (filter.authors) and(await queryForPubkeys(db, filter.authors));
    if (filter.kinds) and(await queryForKinds(db, filter.kinds));
    if (filter.since || filter.until)
      and(await queryForTime(db, filter.since, filter.until));

    for (const t of GENERIC_TAGS) {
      const key = `#${t}`;
      const values = filter[key as `#${string}`];
      if (values?.length) and(await queryForTag(db, t, values));
    }
  }

  if (ids) {
    // load events
    const events: Event[] = [];
    const trans = db.transaction("events", "readonly");
    const objectStore = trans.objectStore("events");
    const index = objectStore.index("id");

    const handleEntry = (e?: { event: Event }) => e && events.push(e.event);

    const promises = Array.from(ids as Set<string>).map((id) =>
      index.get(id).then(handleEntry),
    );

    const result = Promise.all(promises).then(() =>
      events.sort((a, b) => b.created_at - a.created_at),
    );
    trans.commit();

    return result;
  } else return [];
}
