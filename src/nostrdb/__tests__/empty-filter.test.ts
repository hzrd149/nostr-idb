import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEvent } from "../../__tests__/helpers.js";
import { getEventUID } from "../../database/common.js";
import { openDB } from "../../database/database.js";
import { deleteByFilter } from "../../database/delete.js";
import { addEvents } from "../../database/insert.js";
import {
  countEventsForFilter,
  getEventsForFilter,
  getEventsForFilters,
  getIdsForFilter,
} from "../../database/query-filter.js";
import type { NostrIDBDatabase } from "../../database/schema.js";
import { NostrIDB } from "../nostrdb.js";

function expectEvents(actual: { id: string }[], expected: { id: string }[]) {
  expect(actual.map((event) => event.id)).toEqual(
    expected.map((event) => event.id),
  );
}

describe("empty filters", () => {
  let db: NostrIDBDatabase;
  let cache: NostrIDB | undefined;

  beforeEach(async () => {
    db = await openDB("test-empty-filter-" + Date.now());
  });

  afterEach(async () => {
    await cache?.stop();
    cache = undefined;
    db.close();
    vi.restoreAllMocks();
  });

  it("returns empty results on an empty database", async () => {
    expect(await getEventsForFilter(db, {})).toEqual([]);
    expect(await getEventsForFilter(db, { limit: 10 })).toEqual([]);
    expect(await countEventsForFilter(db, {})).toBe(0);
    await expect(getEventsForFilters(db, [])).rejects.toThrow("No Filters");
  });

  it("reads and counts all stored kinds, including replaceable events", async () => {
    const events = [1, 0, 10002, 30023].map((kind, i) =>
      createTestEvent({ kind, created_at: i, tags: [["d", "article"]] }),
    );
    await addEvents(db, events);
    expect(await getIdsForFilter(db, {})).toEqual(
      new Set(events.map(getEventUID)),
    );
    expectEvents(await getEventsForFilter(db, {}), [...events].reverse());
    expectEvents(await getEventsForFilters(db, [{}]), [...events].reverse());
    expect(await countEventsForFilter(db, {})).toBe(4);
    expectEvents(
      await getEventsForFilter(db, { limit: 2 }),
      events.slice(2).reverse(),
    );
    expect(await getIdsForFilter(db, { limit: 2 })).toHaveProperty("size", 2);
    expect(await getIdsForFilter(db, { limit: 0 })).toEqual(new Set());
    expect(await getEventsForFilter(db, { limit: 0 })).toEqual([]);
    expectEvents(
      await getEventsForFilter(db, { until: 1, limit: 2 }),
      events.slice(0, 2).reverse(),
    );
    expect(await deleteByFilter(db, {})).toBe(4);
    expect(await db.count("events")).toBe(0);
  });

  it("combines limited and unrestricted filters without duplicates", async () => {
    const events = [1, 2, 3].map((created_at) =>
      createTestEvent({ kind: 1, created_at }),
    );
    await addEvents(db, events);
    expectEvents(
      await getEventsForFilters(db, [{ limit: 1 }, {}]),
      [...events].reverse(),
    );
    expect(await getEventsForFilter(db, { kinds: [] })).toEqual([]);
    expect(await getEventsForFilter(db, { authors: [] })).toEqual([]);
    expect(await getEventsForFilter(db, { ids: [] })).toEqual([]);
    expect(await getEventsForFilter(db, { search: "unsupported" })).toEqual([]);
  });

  it("limits equal-timestamp events consistently with warm and cold caches", async () => {
    const events = [1, 2, 3].map((kind) =>
      createTestEvent({ kind, created_at: 10 }),
    );
    await addEvents(db, events);
    cache = new NostrIDB(db, { pruneInterval: 100000 });
    const first = await cache.query({ limit: 2 });
    expect(first).toHaveLength(2);
    expect(await cache.query({ limit: 2 })).toEqual(first);
    cache.eventMap.clear();
    expect(await cache.query({ limit: 2 })).toEqual(first);
  });

  it("includes pending writes and warns only for unlimited empty reads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const old = createTestEvent({ kind: 1, created_at: 10 });
    const newest = createTestEvent({ kind: 30023, created_at: 30 });
    await addEvents(db, [old]);
    cache = new NostrIDB(db, { writeInterval: 100000, pruneInterval: 100000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cache.add(newest);
    expect(await cache.query({ limit: 1 })).toEqual([newest]);
    expect(warn).not.toHaveBeenCalled();
    expectEvents(await cache.query({}), [newest, old]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("entire database"),
    );
    expect(await cache.count({})).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);

    const history = cache.subscribe({});
    expect((await history.next()).value?.id).toEqual(newest.id);
    expect((await history.next()).value?.id).toEqual(old.id);
    await history.return();
    expect(warn).toHaveBeenCalledTimes(2);

    const limited = cache.subscribe({ limit: 1 });
    expect((await limited.next()).value).toEqual(newest);
    await limited.return();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
