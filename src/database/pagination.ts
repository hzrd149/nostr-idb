import { matchFilters, type Filter, type StoredEvent } from "../lib/nostr.js";
import type { NostrIDBDatabase, Schema } from "./schema.js";
import type { EventReader } from "./metadata.js";

/** Opaque, serializable continuation returned by queryPage. */
export type QueryCursor = string;

/** Options for bounded, chronological reads of committed events. */
export type QueryPageOptions = {
  cursor?: QueryCursor;
  pageSize?: number;
  /** Maximum candidate rows examined per transaction (default 4096). */
  scanLimit?: number;
  direction?: "next" | "prev";
  signal?: AbortSignal;
};

/** A bounded page; empty events do not imply completion. */
export type QueryPage<TEvent extends StoredEvent = StoredEvent> = {
  events: TEvent[];
  nextCursor?: QueryCursor;
  done: boolean;
  scanned: number;
};

type Position = { time: number; uid: string };
type Token = Position & { version: 1; query: string };

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
}

function prepare(filters: Filter | Filter[]) {
  const list = structuredClone(Array.isArray(filters) ? filters : [filters]);
  if (list.length === 0) throw new Error("No Filters");
  for (const filter of list) {
    if (filter.limit !== undefined)
      throw new Error("Pagination uses pageSize, not filter.limit");
    if (filter.search !== undefined)
      throw new Error("Pagination does not support search");
    for (const time of [filter.since, filter.until]) {
      if (time !== undefined && !Number.isFinite(time))
        throw new Error("Time bounds must be finite");
    }
  }
  return list;
}

/** Read a bounded page without materializing candidate ID sets or populating caches. */
export async function getEventsPage<TEvent extends StoredEvent = StoredEvent>(
  db: NostrIDBDatabase,
  filters: Filter | Filter[] = {},
  options: QueryPageOptions = {},
  readEvent?: EventReader<TEvent>,
): Promise<QueryPage<TEvent>> {
  const {
    pageSize = 100,
    scanLimit = 4096,
    direction = "prev",
    signal,
  } = options;
  positiveInteger(pageSize, "pageSize");
  positiveInteger(scanLimit, "scanLimit");
  if (direction !== "next" && direction !== "prev")
    throw new Error("Invalid pagination direction");
  signal?.throwIfAborted();
  const list = prepare(filters);
  const query = JSON.stringify([
    db.name,
    db.version,
    direction,
    list.map((filter) =>
      Object.fromEntries(
        Object.entries(filter)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    ),
  ]);
  let position: Position | undefined;
  if (options.cursor !== undefined) {
    let token: Token;
    try {
      token = JSON.parse(options.cursor);
    } catch {
      throw new Error("Invalid pagination cursor");
    }
    if (
      !token ||
      token.version !== 1 ||
      token.query !== query ||
      !Number.isFinite(token.time) ||
      typeof token.uid !== "string"
    )
      throw new Error("Invalid or incompatible pagination cursor");
    position = token;
  }

  const active = list.filter(
    (f) => f.since === undefined || f.until === undefined || f.since <= f.until,
  );
  const empty = (): QueryPage<TEvent> => ({
    events: [],
    done: true,
    scanned: 0,
  });
  if (active.length === 0) return empty();
  let lower = active.every((f) => f.since !== undefined)
    ? Math.min(...active.map((f) => f.since!))
    : undefined;
  let upper = active.every((f) => f.until !== undefined)
    ? Math.max(...active.map((f) => f.until!))
    : undefined;
  if (position) {
    if (direction === "next")
      lower = Math.max(lower ?? -Infinity, position.time);
    else upper = Math.min(upper ?? Infinity, position.time);
  }
  if (lower !== undefined && upper !== undefined && lower > upper)
    return empty();
  const range =
    lower !== undefined && upper !== undefined
      ? IDBKeyRange.bound(lower, upper)
      : lower !== undefined
        ? IDBKeyRange.lowerBound(lower)
        : upper !== undefined
          ? IDBKeyRange.upperBound(upper)
          : undefined;

  const tx = db.transaction("events", "readonly");
  const store = tx.objectStore("events");
  const rows: Schema["events"]["value"][] = [];
  let scanned = 0;
  let last: Position | undefined;
  // Key cursors avoid deserializing the resume row and the look-ahead row.
  let cursor = await store.index("created_at").openKeyCursor(range, direction);
  if (cursor && position && cursor.key === position.time) {
    const comparison = indexedDB.cmp(cursor.primaryKey, position.uid);
    if (
      (direction === "next" && comparison < 0) ||
      (direction === "prev" && comparison > 0)
    )
      cursor = await cursor.continuePrimaryKey(position.time, position.uid);
    if (
      cursor &&
      cursor.key === position.time &&
      cursor.primaryKey === position.uid
    )
      cursor = await cursor.continue();
  }
  while (cursor && scanned < scanLimit && rows.length < pageSize) {
    if (signal?.aborted) break;
    last = { time: cursor.key, uid: cursor.primaryKey };
    scanned++;
    const row = await store.get(cursor.primaryKey);
    if (row && matchFilters(active, row.event)) rows.push(row);
    cursor = await cursor.continue();
  }
  await tx.done;
  signal?.throwIfAborted();
  const done = cursor === null;
  return {
    events: rows.map((row) =>
      readEvent ? readEvent(row) : (row.event as TEvent),
    ),
    done,
    scanned,
    nextCursor:
      !done && last
        ? JSON.stringify({ version: 1, query, ...last } satisfies Token)
        : undefined,
  };
}

/** Lazily read pages, releasing each transaction before yielding to the caller. */
export async function* iterateEventPages<
  TEvent extends StoredEvent = StoredEvent,
>(
  db: NostrIDBDatabase,
  filters: Filter | Filter[] = {},
  options: QueryPageOptions = {},
  readEvent?: EventReader<TEvent>,
): AsyncGenerator<QueryPage<TEvent>, void, undefined> {
  const stableFilters = prepare(filters);
  const stableOptions = { ...options };
  let cursor = stableOptions.cursor;
  while (true) {
    const page = await getEventsPage<TEvent>(
      db,
      stableFilters,
      {
        ...stableOptions,
        cursor,
      },
      readEvent,
    );
    yield page;
    if (page.done) return;
    cursor = page.nextCursor;
  }
}

/** Lazily traverse committed events with at most one page buffered. */
export async function* iterateEvents<TEvent extends StoredEvent = StoredEvent>(
  db: NostrIDBDatabase,
  filters: Filter | Filter[] = {},
  options: QueryPageOptions = {},
  readEvent?: EventReader<TEvent>,
): AsyncGenerator<TEvent, void, undefined> {
  const signal = options.signal;
  for await (const page of iterateEventPages<TEvent>(
    db,
    filters,
    options,
    readEvent,
  )) {
    for (const event of page.events) {
      signal?.throwIfAborted();
      yield event;
    }
  }
}
