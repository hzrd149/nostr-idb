import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEvent } from "../../__tests__/helpers.js";
import { type StoredEvent } from "../../lib/nostr.js";
import { NostrIDB } from "../../nostrdb/nostrdb.js";
import { getEventUID } from "../common.js";
import { openDB } from "../database.js";
import { addEvents } from "../insert.js";
import {
  getEventsPage,
  iterateEventPages,
  iterateEvents,
} from "../pagination.js";
import type { NostrIDBDatabase } from "../schema.js";

describe("cursor pagination", () => {
  let db: NostrIDBDatabase;
  let events: StoredEvent[];

  beforeEach(async () => {
    db = await openDB("test-pagination-" + Date.now());
    events = Array.from({ length: 45 }, (_, i) =>
      createTestEvent({
        kind: i % 3 === 0 ? 2 : 1,
        created_at: 100 + Math.floor(i / 15),
        content: String(i),
        tags: [
          ["t", "all"],
          ["t", i % 2 ? "odd" : "even"],
        ],
      }),
    );
    events.push(
      createTestEvent({
        kind: 30023,
        created_at: 101,
        tags: [["d", "article"]],
      }),
    );
    await addEvents(db, events);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    db.close();
    indexedDB.deleteDatabase(db.name);
  });

  function ordered(direction: "next" | "prev") {
    return [...events].sort(
      (a, b) =>
        (direction === "next" ? 1 : -1) *
        (a.created_at - b.created_at ||
          indexedDB.cmp(getEventUID(a), getEventUID(b))),
    );
  }

  it.each(["next", "prev"] as const)(
    "traverses timestamp ties and replaceable UIDs in %s order",
    async (direction) => {
      const result: StoredEvent[] = [];
      for await (const page of iterateEventPages(
        db,
        {},
        { pageSize: 4, direction },
      )) {
        expect(page.events.length).toBeLessThanOrEqual(4);
        expect(page.scanned).toBe(page.events.length);
        expect(Boolean(page.nextCursor)).toBe(!page.done);
        result.push(...page.events);
      }
      expect(result.map((e) => e.id)).toEqual(
        ordered(direction).map((e) => e.id),
      );
    },
  );

  it.each(["next", "prev"] as const)(
    "seeks past a deleted continuation row in %s order",
    async (direction) => {
      const first = await getEventsPage(db, {}, { direction, pageSize: 7 });
      const boundary = first.events.at(-1)!;
      await db.delete("events", getEventUID(boundary));
      const result = [...first.events];
      for await (const event of iterateEvents(
        db,
        {},
        { direction, cursor: first.nextCursor, pageSize: 3 },
      ))
        result.push(event);
      expect(result.map((e) => e.id)).toEqual(
        ordered(direction).map((e) => e.id),
      );
    },
  );

  it("bounds sparse scans, including empty pages, without eager ID or body reads", async () => {
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const keys = vi.spyOn(IDBIndex.prototype, "getAllKeys");
    const all = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const first = await getEventsPage(db, { kinds: [999] }, { scanLimit: 5 });
    expect(first.events).toEqual([]);
    expect(first.scanned).toBe(5);
    expect(first.done).toBe(false);
    expect(get).toHaveBeenCalledTimes(5);
    let scanned = first.scanned;
    for await (const page of iterateEventPages(
      db,
      { kinds: [999] },
      { cursor: first.nextCursor, scanLimit: 5 },
    ))
      scanned += page.scanned;
    expect(scanned).toBe(events.length);
    expect(keys).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();
  });

  it("matches overlapping filters once, with inclusive time and AND tags", async () => {
    const result: StoredEvent[] = [];
    const filters = [
      { kinds: [1], since: 101, until: 101, "&t": ["all", "odd"] },
      { ids: [events[0].id] },
    ];
    for await (const event of iterateEvents(db, [...filters, filters[0]], {
      scanLimit: 4,
      pageSize: 2,
    }))
      result.push(event);
    const expected = ordered("prev").filter(
      (e) =>
        e.id === events[0].id ||
        (e.kind === 1 &&
          e.created_at === 101 &&
          e.tags.some((t) => t[1] === "odd")),
    );
    expect(result.map((e) => e.id)).toEqual(expected.map((e) => e.id));
  });

  it("bounds time-index scans and handles empty ranges and stores", async () => {
    const page = await getEventsPage(db, { since: 101, until: 101 });
    expect(page.events).toHaveLength(16);
    expect(page.scanned).toBe(16);
    expect(page.done).toBe(true);
    expect((await getEventsPage(db, { since: 103, until: 100 })).scanned).toBe(
      0,
    );
    await db.clear("events");
    expect(await getEventsPage(db)).toEqual({
      events: [],
      done: true,
      scanned: 0,
      nextCursor: undefined,
    });
  });

  it("seeks into a timestamp bucket without replaying earlier rows", async () => {
    const first = await getEventsPage(db, {}, { pageSize: 12 });
    const range = vi.spyOn(IDBKeyRange, "upperBound");
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const page = await getEventsPage(
      db,
      {},
      { cursor: first.nextCursor, pageSize: 2 },
    );
    expect(page.events.map((e) => e.id)).toEqual(
      ordered("prev")
        .slice(12, 14)
        .map((e) => e.id),
    );
    expect(range).toHaveBeenCalledWith(first.events.at(-1)!.created_at);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("resumes after the entire boundary timestamp bucket is removed", async () => {
    const first = await getEventsPage(db, {}, { pageSize: 3 });
    const tx = db.transaction("events", "readwrite");
    for (const event of events.filter((e) => e.created_at === 102))
      tx.store.delete(getEventUID(event));
    await tx.done;
    const next = await getEventsPage(db, {}, { cursor: first.nextCursor });
    expect(next.events.map((e) => e.id)).toEqual(
      ordered("prev")
        .filter((e) => e.created_at < 102)
        .map((e) => e.id),
    );
    expect(next.done).toBe(true);
  });

  it("rejects incompatible cursors and ambiguous options", async () => {
    const { nextCursor } = await getEventsPage(db, {}, { pageSize: 2 });
    await expect(
      getEventsPage(db, { kinds: [1] }, { cursor: nextCursor }),
    ).rejects.toThrow("cursor");
    await expect(
      getEventsPage(db, {}, { cursor: nextCursor, direction: "next" }),
    ).rejects.toThrow("cursor");
    for (const cursor of ["broken", "null", "{}"])
      await expect(getEventsPage(db, {}, { cursor })).rejects.toThrow("cursor");
    for (const pageSize of [0, -1, 1.5, Infinity])
      await expect(getEventsPage(db, {}, { pageSize })).rejects.toThrow(
        "pageSize",
      );
    await expect(getEventsPage(db, {}, { scanLimit: 0 })).rejects.toThrow(
      "scanLimit",
    );
    await expect(getEventsPage(db, { limit: 10 })).rejects.toThrow("pageSize");
    await expect(getEventsPage(db, { search: "hello" })).rejects.toThrow(
      "search",
    );
    await expect(getEventsPage(db, [])).rejects.toThrow("No Filters");
  });

  it("releases transactions before yielding and does not prefetch after break", async () => {
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const iterator = iterateEvents(db, {}, { pageSize: 2 });
    const first = await iterator.next();
    expect(first.done).toBe(false);
    // A write must complete while the consumer is paused.
    await addEvents(db, [createTestEvent({ kind: 1, created_at: 999 })]);
    await iterator.return();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("honors cancellation before reading and between buffered events", async () => {
    const controller = new AbortController();
    const iterator = iterateEvents(db, {}, { signal: controller.signal });
    await iterator.next();
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      getEventsPage(db, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops an in-progress scan when aborted", async () => {
    const controller = new AbortController();
    const original = IDBObjectStore.prototype.get;
    const get = vi
      .spyOn(IDBObjectStore.prototype, "get")
      .mockImplementation(function (key) {
        controller.abort();
        return original.call(this, key);
      });
    await expect(
      getEventsPage(db, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(get).toHaveBeenCalledTimes(1);
    // Cancellation leaves no transaction blocking future writers.
    await db.clear("events");
  });

  it("exposes committed-only traversal on NostrIDB without warming caches", async () => {
    const store = new NostrIDB(db, {
      writeInterval: 100000,
      pruneInterval: 100000,
    });
    // Let the constructor's initial flush finish, then disable background work.
    await store.queryPage();
    await store.stop();
    try {
      await store.add(createTestEvent({ kind: 1, created_at: 999 }));
      const size = store.eventMap.size;
      expect((await store.queryPage()).events).toHaveLength(events.length);
      const result: StoredEvent[] = [];
      for await (const event of store.iterate({}, { pageSize: 3 }))
        result.push(event);
      expect(result).toHaveLength(events.length);
      let count = 0;
      for await (const page of store.pages({}, { pageSize: 4 }))
        count += page.events.length;
      expect(count).toBe(events.length);
      expect(store.eventMap.size).toBe(size);
      expect(store.indexCache.count).toBe(0);
    } finally {
      await store.stop();
    }
  });
});
