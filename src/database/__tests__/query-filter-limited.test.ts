import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";
import { IndexCache } from "../../cache/index-cache.js";
import type { Filter, StoredEvent } from "../../lib/nostr.js";
import { selectEventsForFilters } from "../../utils.js";
import { getEventUID } from "../common.js";
import { openDB } from "../database.js";
import { addEvents } from "../insert.js";
import {
  getEventsForFilter,
  getEventsForFilters,
  getIdsForFilters,
} from "../query-filter.js";
import type { NostrIDBDatabase } from "../schema.js";

describe("limited candidate loading", () => {
  let db: NostrIDBDatabase;
  let events: StoredEvent[];

  beforeEach(async () => {
    db = await openDB("test-query-limited-" + Date.now());
    events = Array.from({ length: 360 }, (_, i) =>
      createTestEvent({
        kind: 1,
        created_at: 1000 + Math.floor(i / 12),
        content: String(i),
        tags: [["custom", i % 2 ? "odd" : "even"]],
      }),
    );
    events.push(
      createTestEvent({ kind: 0, created_at: 1029 }),
      createTestEvent({
        kind: 30023,
        created_at: 1029,
        tags: [["d", "article"]],
      }),
    );
    await addEvents(db, events);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    indexedDB.deleteDatabase(db.name);
  });

  // Reference the previous point-read path, including its candidate ordering.
  async function pointReadResult(
    filters: Filter[],
    cache?: IndexCache,
    eventMap = new Map<string, StoredEvent>(),
  ) {
    const ids = await getIdsForFilters(db, filters, cache);
    const cached: StoredEvent[] = [];
    const loaded: StoredEvent[] = [];
    for (const uid of ids) {
      const event = eventMap.get(uid);
      if (event) cached.push(event);
      else {
        const row = await db.get("events", uid);
        if (row) loaded.push(row.event);
      }
    }
    return selectEventsForFilters([...cached, ...loaded], filters);
  }

  it("preserves tie ordering, replaceable UIDs and cached object precedence", async () => {
    const filter = { authors: [getTestPublicKey()], limit: 10 };
    const cached = { ...events[350], content: "cached body" };
    const eventMap = new Map([[getEventUID(cached), cached]]);
    const expected = await pointReadResult([filter], undefined, eventMap);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

    const result = await getEventsForFilter(db, filter, undefined, eventMap);

    expect(structuredClone(result)).toEqual(structuredClone(expected));
    expect(result.find((event) => event.id === cached.id)).toBe(cached);
    expect(result.some((event) => event.kind === 0)).toBe(true);
    expect(result.some((event) => event.kind === 30023)).toBe(true);
    expect(getAll).not.toHaveBeenCalled();
    expect(get.mock.calls.length).toBeLessThanOrEqual(14);
    expect(result[0]).toBe(cached);
    expect(eventMap.size).toBe(1);
  });

  it("retains per-filter limits, post-load tag matching and inclusive time boundaries", async () => {
    const filters: Filter[] = [
      { authors: [getTestPublicKey()], "#custom": ["odd"], limit: 7 },
      { kinds: [1], "&custom": ["even"], since: 1000, until: 1001, limit: 5 },
      { kinds: [0, 30023], since: 1029, until: 1029 },
    ];
    const expected = await pointReadResult(filters);
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

    const result = await getEventsForFilters(db, filters);

    expect(structuredClone(result)).toEqual(structuredClone(expected));
    expect(getAll).not.toHaveBeenCalled();
    expect(result.filter((event) => event.kind !== 1)).toHaveLength(2);
  });

  it("ignores extra rows and missing UIDs even with a warm candidate index", async () => {
    const cache = new IndexCache();
    // Reverse order deliberately: time-index order must not decide tied limits.
    const ids = events.slice(0, 300).map(getEventUID).reverse();
    ids.splice(10, 0, "missing-uid");
    cache.setPubkeyIndex(getTestPublicKey(), new Set(ids));
    const filter = { authors: [getTestPublicKey()], limit: 10 };
    const expected = await pointReadResult([filter], cache);
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");

    expect(
      structuredClone(await getEventsForFilter(db, filter, cache)),
    ).toEqual(structuredClone(expected));
    expect(getAll).not.toHaveBeenCalled();
  });

  it("uses a dense kind bucket when candidates are sparse in the time index", async () => {
    await addEvents(
      db,
      Array.from({ length: 600 }, (_, i) =>
        createTestEvent({ kind: 2, created_at: 2000 + i }),
      ),
    );
    const filter = { kinds: [1], limit: 10 };
    const expected = await pointReadResult([filter]);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const indexGetAll = vi.spyOn(IDBIndex.prototype, "getAll");

    expect(await getEventsForFilter(db, filter)).toEqual(expected);
    expect(getAll).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(indexGetAll).toHaveBeenCalledTimes(1);
  });

  it("preserves unlimited results and skips body reads for fully cached candidates", async () => {
    const filter = { authors: [getTestPublicKey()] };
    const expected = await pointReadResult([filter]);
    expect(await getEventsForFilter(db, filter)).toEqual(expected);

    const eventMap = new Map(
      events.map((event) => [getEventUID(event), event]),
    );
    const cachedExpected = await pointReadResult([filter], undefined, eventMap);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const result = await getEventsForFilter(db, filter, undefined, eventMap);
    expect(result).toEqual(cachedExpected);
    expect(get).not.toHaveBeenCalled();
    for (const event of result)
      expect(event).toBe(eventMap.get(getEventUID(event)));
  });

  it("handles cached bodies with changed timestamps or nonmatching kinds", async () => {
    const filter = { kinds: [1], limit: 10 };
    const eventMap = new Map([
      [getEventUID(events[0]), { ...events[0], created_at: 9999 }],
      [getEventUID(events[350]), { ...events[350], kind: 2 }],
      [getEventUID(events[351]), { ...events[351], created_at: 0 }],
    ]);
    const expected = await pointReadResult([filter], undefined, eventMap);
    expect(await getEventsForFilter(db, filter, undefined, eventMap)).toEqual(
      expected,
    );
  });
});
