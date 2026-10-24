import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestEvent } from "../../__tests__/helpers.js";
import { deleteByFilter } from "../../database/delete.js";
import { getEventUID } from "../../database/common.js";
import { openDB } from "../../database/database.js";
import { addEvents, updateUsed } from "../../database/insert.js";
import {
  countEventsForFilter,
  getEventsForFilters,
  getIdsForFilter,
} from "../../database/query-filter.js";
import type { NostrIDBDatabase } from "../../database/schema.js";
import type { Filter, StoredEvent } from "../../lib/nostr.js";
import { NostrIDB } from "../nostrdb.js";

function expectEvents(actual: StoredEvent[], expected: StoredEvent[]) {
  expect(actual.map((event) => event.id)).toEqual(
    expected.map((event) => event.id),
  );
}

describe("query and pruning regressions", () => {
  let db: NostrIDBDatabase;
  let cache: NostrIDB | undefined;

  beforeEach(async () => {
    db = await openDB("test-query-regressions-" + Date.now());
  });

  afterEach(async () => {
    await cache?.stop();
    db.close();
  });

  it.each([0, 10002, 30023])(
    "resolves kind %i through its event ID",
    async (kind) => {
      const event = createTestEvent({ kind, tags: [["d", "article"]] });
      await addEvents(db, [event]);
      expect(await getIdsForFilter(db, { ids: [event.id] })).toEqual(
        new Set([getEventUID(event)]),
      );
      expectEvents(await getEventsForFilters(db, [{ ids: [event.id] }]), [
        event,
      ]);
      expect(await countEventsForFilter(db, { ids: [event.id] })).toBe(1);
    },
  );

  it("enforces all constraints on ID filters and omits missing IDs", async () => {
    const event = createTestEvent({
      kind: 1,
      created_at: 10,
      tags: [
        ["t", "cat"],
        ["t", "pet"],
      ],
    });
    await addEvents(db, [event]);
    const mismatches: Filter[] = [
      { kinds: [2] },
      { authors: ["0".repeat(64)] },
      { since: 11 },
      { until: 0 },
      { "#t": ["dog"] },
      { "&t": ["cat", "dog"] },
    ];
    for (const filter of mismatches) {
      expect(await getIdsForFilter(db, { ...filter, ids: [event.id] })).toEqual(
        new Set(),
      );
      expectEvents(
        await getEventsForFilters(db, [{ ...filter, ids: [event.id] }]),
        [],
      );
    }
    expect(await getIdsForFilter(db, { ids: ["0".repeat(64)] })).toEqual(
      new Set(),
    );
    expectEvents(
      await getEventsForFilters(db, [
        { ids: [event.id], "&t": ["cat", "pet"], since: 10, until: 10 },
      ]),
      [event],
    );
  });

  it("deletes replaceable events by hex ID only when other constraints match", async () => {
    const event = createTestEvent({ kind: 30023, tags: [["d", "article"]] });
    await addEvents(db, [event]);
    expect(await deleteByFilter(db, { ids: [event.id], kinds: [1] })).toBe(0);
    expect(await deleteByFilter(db, { ids: [event.id] })).toBe(1);
    expect(await db.count("events")).toBe(0);
  });

  it("limits each filter independently before union and deduplication", async () => {
    const a = createTestEvent({ kind: 1, created_at: 10 });
    const b = createTestEvent({ kind: 2, created_at: 20 });
    const c = createTestEvent({ kind: 2, created_at: 30 });
    await addEvents(db, [a, b, c]);
    expectEvents(
      await getEventsForFilters(db, [
        { kinds: [1], limit: 1 },
        { kinds: [2], limit: 2 },
      ]),
      [c, b, a],
    );
    expectEvents(
      await getEventsForFilters(db, [{ kinds: [1], limit: 1 }, { kinds: [2] }]),
      [c, b, a],
    );
    expectEvents(
      await getEventsForFilters(db, [
        { kinds: [2], limit: 1 },
        { kinds: [2], limit: 2 },
      ]),
      [c, b],
    );
    expectEvents(
      await getEventsForFilters(db, [
        { kinds: [1], limit: 0 },
        { kinds: [2], limit: 1 },
      ]),
      [c],
    );
  });

  it("applies limits to persisted and pending events together for queries and history", async () => {
    const old = createTestEvent({ kind: 1, created_at: 10 });
    const newest = createTestEvent({ kind: 1, created_at: 30 });
    const other = createTestEvent({ kind: 2, created_at: 20 });
    await addEvents(db, [old, newest]);
    cache = new NostrIDB(db, { writeInterval: 100000, pruneInterval: 100000 });
    // Let the constructor's initial flush complete before queuing events.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cache.add(createTestEvent({ kind: 1, created_at: 15 }));
    await cache.add(other);
    const filters = [
      { kinds: [1], limit: 1 },
      { kinds: [2], limit: 1 },
    ];
    expectEvents(await cache.query(filters), [newest, other]);
    const history = cache.subscribe(filters);
    expect((await history.next()).value?.id).toBe(newest.id);
    expect((await history.next()).value?.id).toBe(other.id);
    await history.return();
    const pendingNewest = createTestEvent({ kind: 1, created_at: 40 });
    await cache.add(pendingNewest);
    expectEvents(await cache.query(filters), [pendingNewest, other]);
  });

  it("invalidates warm caches when the background timer prunes", async () => {
    const events = [10, 20, 30].map((created_at) =>
      createTestEvent({ kind: 1, created_at }),
    );
    await addEvents(db, events);
    await updateUsed(db, events.map(getEventUID));
    cache = new NostrIDB(db, {
      maxEvents: 1,
      maxMemoryEvents: 10,
      pruneInterval: 100,
    });
    expect(await cache.query({ kinds: [1] })).toHaveLength(3);
    expect(cache.eventMap.size).toBe(3);
    await vi.waitFor(async () => {
      expect(await db.count("events")).toBe(1);
      expect(cache!.eventMap.size).toBe(1);
    });
    const remaining = (await db.getAll("events")).map((row) => row.event);
    expectEvents(await cache.query({ kinds: [1] }), remaining);
  });

  it("bounds event bodies by default and reloads evicted bodies from disk", async () => {
    const events = [10, 20, 30].map((created_at) =>
      createTestEvent({ kind: 1, created_at }),
    );
    await addEvents(db, events);
    cache = new NostrIDB(db, { maxEvents: 1, pruneInterval: 100000 });
    expect(await cache.query({ kinds: [1] })).toHaveLength(3);
    expect(cache.eventMap.size).toBe(1);
    expectEvents(await cache.query({ ids: [events[2].id] }), [events[2]]);
    expect(cache.eventMap.size).toBe(1);
    expect(cache.eventMap.has(events[2].id)).toBe(true);
  });

  it("bounds additions and allows disabling body caching", async () => {
    cache = new NostrIDB(db, { maxMemoryEvents: 0, pruneInterval: 100000 });
    const event = createTestEvent({ kind: 1 });
    await cache.add(event);
    expect(cache.eventMap.size).toBe(0);
    expectEvents(await cache.query({ ids: [event.id] }), [event]);
    expect(cache.eventMap.size).toBe(0);
  });
});
