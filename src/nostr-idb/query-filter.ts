import { matchFilter, type Event, type Filter } from "nostr-tools";
import type { IDBPCursor, IDBPCursorWithValue, IDBPDatabase } from "idb";
import type { Schema } from "./schema";
import { GENERIC_TAGS } from "./common";

// export function queryForPubkeys(
//   db: IDBPDatabase<Schema>,
//   authors: Filter["authors"] = [],
// ) {
//   const ids = new Set<string>();
//   const trans = db.transaction("events", "readonly");
//   const objectStore = trans.objectStore("events");
//   const index = objectStore.index("pubkey");

//   const handleEvents = (result: string[]) => {
//     for (const id of result) ids.add(id);
//   };

//   const promises = authors.map((pubkey) =>
//     index.getAllKeys(pubkey).then(handleEvents),
//   );

//   const result = Promise.all(promises).then(() => ids);
//   trans.commit();

//   return result;
// }

// export function queryForTag(
//   db: IDBPDatabase<Schema>,
//   tag: string,
//   values: string[],
// ) {
//   const ids = new Set<string>();
//   const trans = db.transaction("events", "readonly");
//   const objectStore = trans.objectStore("events");
//   const index = objectStore.index("tags");

//   const handleEvents = (result: string[]) => {
//     for (const id of result) ids.add(id);
//   };

//   const promises = values.map((v) =>
//     index.getAllKeys(tag + v).then(handleEvents),
//   );

//   const result = Promise.all(promises).then(() => ids);
//   trans.commit();

//   return result;
// }

// export function queryForKinds(
//   db: IDBPDatabase<Schema>,
//   kinds: Filter["kinds"] = [],
// ) {
//   const ids = new Set<string>();
//   const trans = db.transaction("events", "readonly");
//   const objectStore = trans.objectStore("events");
//   const index = objectStore.index("kind");

//   const handleEvents = (result: string[]) => {
//     for (const id of result) ids.add(id);
//   };

//   const promises = kinds.map((kind) =>
//     index.getAllKeys(kind).then(handleEvents),
//   );

//   const result = Promise.all(promises).then(() => ids);
//   trans.commit();

//   return result;
// }

// export async function queryForTime(
//   db: IDBPDatabase<Schema>,
//   since: number | undefined,
//   until: number | undefined,
// ) {
//   let range: IDBKeyRange;
//   if (since !== undefined && until !== undefined)
//     range = IDBKeyRange.bound(since, until);
//   else if (since !== undefined) range = IDBKeyRange.lowerBound(since);
//   else if (until !== undefined) range = IDBKeyRange.upperBound(until);
//   else throw new Error("Missing since or until");

//   const arr = await db.getAllKeysFromIndex("events", "create_at", range);
//   const ids = new Set<string>(arr);
//   return ids;
// }

// export async function getEventsForFilters<K extends number = number>(
//   db: IDBPDatabase<Schema>,
//   filters: Filter<K>[],
// ) {
//   let ids: Set<string> | null = null;
//   const and = (set: Set<string>) => {
//     if (!ids) ids = set;
//     for (const id of ids) if (!set.has(id)) ids.delete(id);
//   };

//   for (const filter of filters) {
//     if (filter.ids) and(new Set(filter.ids));
//     if (filter.authors) and(await queryForPubkeys(db, filter.authors));
//     if (filter.kinds) and(await queryForKinds(db, filter.kinds));
//     if (filter.since || filter.until)
//       and(await queryForTime(db, filter.since, filter.until));

//     for (const t of GENERIC_TAGS) {
//       const key = `#${t}`;
//       const values = filter[key as `#${string}`];
//       if (values?.length) and(await queryForTag(db, t, values));
//     }
//   }

//   if (ids) {
//     // load events
//     const events: Event[] = [];
//     const trans = db.transaction("events", "readonly");
//     const objectStore = trans.objectStore("events");
//     const index = objectStore.index("id");

//     const handleEntry = (e?: { event: Event }) => e && events.push(e.event);

//     const promises = Array.from(ids as Set<string>).map((id) =>
//       index.get(id).then(handleEntry),
//     );

//     const result = Promise.all(promises).then(() =>
//       events.sort((a, b) => b.created_at - a.created_at),
//     );
//     trans.commit();

//     return result;
//   } else return [];
// }

function sortByPrimaryKey(
  a: IDBPCursorWithValue<Schema>,
  b: IDBPCursorWithValue<Schema>,
) {
  return b.primaryKey - a.primaryKey;
}
// function sortGroupByPrimaryKey(
//   a: IDBPCursorWithValue<Schema>[],
//   b: IDBPCursorWithValue<Schema>[],
// ) {
//   return b[0].primaryKey - a[0].primaryKey;
// }

export async function queryWithCursors<K extends number = number>(
  db: IDBPDatabase<Schema>,
  filter: Filter<K>,
) {
  const events: Event[] = [];
  const trans = db.transaction("events", "readonly");

  const groups: IDBPCursorWithValue<Schema, ["events"], "events">[][] = [];
  const cursorTypes = new WeakMap<
    IDBPCursorWithValue<Schema, ["events"], "events">,
    string
  >();

  // build the OR groups
  if (filter.authors) {
    const cursors: IDBPCursorWithValue<
      Schema,
      ["events"],
      "events",
      "pubkey"
    >[] = [];
    for (const pubkey of filter.authors) {
      const c = await trans.store.index("pubkey").openCursor(pubkey, "prev");
      if (c) {
        cursors.push(c);
        cursorTypes.set(c, "pubkey");
      }
    }
    groups.push(cursors);
  }
  if (filter.kinds) {
    const cursors: IDBPCursorWithValue<Schema, ["events"], "events", "kind">[] =
      [];
    for (const kind of filter.kinds) {
      const c = await trans.store.index("kind").openCursor(kind, "prev");
      if (c) {
        cursors.push(c);
        cursorTypes.set(c, "kind");
      }
    }
    groups.push(cursors);
  }
  // this probably dose not make sense
  if (filter.ids) {
    throw new Error("Dont use queryWithCursors with ids");
  }
  if (filter.until) {
    const c = await trans.store
      .index("created_at")
      .openCursor(IDBKeyRange.upperBound(filter.until), "prev");
    if (c) {
      cursorTypes.set(c, "created_at");
      groups.push([c]);
    }
  }

  for (let g = 0; g < groups.length; g++) {
    // remove any cursors that are past the "since" filter
    if (filter.since) {
      const since = filter.since;
      groups[g] = groups[g].filter((c) => c.primaryKey >= since);
    }

    // failed to create any cursors for group. exit
    if (groups[g].length === 0) return events;
  }

  let cursors = groups.flat().sort(sortByPrimaryKey);

  const limit = filter.limit || Infinity;
  while (events.length < limit) {
    const checked: IDBPCursorWithValue<Schema, ["events"], "events">[] = [];

    for (const cursor of cursors) {
      if (checked.includes(cursor)) continue;

      // add to checked array
      checked.push(cursor);

      // skip checking cursors out of date range
      if (
        filter.until &&
        cursor.source.name !== "created_at" &&
        cursor.primaryKey > filter.until
      )
        continue;

      const event = cursor.value.event;
      if (matchFilter(filter, cursor.value.event)) {
        events.push(cursor.value.event);

        // move the checked cursors to the current row if they match
        for (const other of checked) {
          // don't bother moving other cursors on the same index
          if (other.source === cursor.source) continue;

          // special case for date cursor
          if (other.source.name === "created_at") {
            const newCursor = await other.continue(cursor.primaryKey);
            if (newCursor === null)
              throw new Error("Unable to continue to primary key");
            continue;
          }

          if (other.primaryKey === cursor.primaryKey) continue;

          const key = cursorTypes.get(other);
          if (!key) throw new Error("Missing cursor key");
          // @ts-ignore
          const eventKey = event[key];
          if (eventKey === other.key) {
            // other cursor matches this row. move it
            const newCursor = await other.continuePrimaryKey(
              other.key,
              cursor.primaryKey,
            );

            if (newCursor === null)
              throw new Error("Unable to continue to primary key");
          }
        }

        // stop checking cursors
        break;
      }
    }

    // move all checked cursors
    for (const cursor of checked) {
      const newCursor = await cursor.continue();
      if (
        newCursor === null ||
        (filter.since && newCursor.primaryKey < filter.since)
      ) {
        // cursor ended, remove it from its group
        cursors = cursors.filter((c) => c !== cursor);
        for (let g = 0; g < groups.length; g++) {
          if (groups[g].includes(cursor)) {
            // the group has no cursors left, exit
            if (groups[g].length === 1) {
              return events;
            }
            groups[g] = groups[g].filter((c) => c !== cursor);
          }
        }
      }
    }

    cursors.sort(sortByPrimaryKey);
  }
  return events;
}
