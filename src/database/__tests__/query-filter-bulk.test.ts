import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Filter, StoredEvent } from "../../lib/nostr.js";
import { selectEventsForFilters } from "../../utils.js";
import { IndexCache } from "../../cache/index-cache.js";
import { getEventTags } from "../common.js";
import { openDB } from "../database.js";
import {
  getEventsForFilter,
  getEventsForFilters,
  getIdsForFilters,
} from "../query-filter.js";
import type { NostrIDBDatabase } from "../schema.js";
import type { EventReader } from "../metadata.js";

describe("dense query body loading", () => {
  let db: NostrIDBDatabase;
  let events: StoredEvent[];

  beforeEach(async () => {
    db = await openDB("test-query-bulk-" + Date.now());
    events = Array.from({ length: 640 }, (_, i) => ({
      id: i.toString(16).padStart(64, "0"),
      pubkey: (i % 4).toString(16).padStart(64, "0"),
      kind: 9,
      created_at: 1000 + Math.floor(i / 8),
      content: String(i),
      tags: [
        ["h", `community-${i % 2}`],
        ["t", "shared"],
      ],
    }));
    const tx = db.transaction("events", "readwrite");
    for (const event of events)
      void tx.store.put(
        { event, tags: getEventTags(event), metadata: event.content },
        event.id,
      );
    await tx.done;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    indexedDB.deleteDatabase(db.name);
  });

  async function reference(
    filters: Filter[],
    cache?: IndexCache,
    eventMap?: Map<string, StoredEvent>,
    reader: EventReader = (row) => row.event,
  ) {
    const ids = await getIdsForFilters(db, filters, cache);
    const cached: StoredEvent[] = [];
    const loaded: StoredEvent[] = [];
    for (const uid of ids) {
      const event = eventMap?.get(uid);
      if (event) cached.push(event);
      else {
        const row = await db.get("events", uid);
        if (row) loaded.push(reader(row));
      }
    }
    return selectEventsForFilters([...cached, ...loaded], filters);
  }

  it.each<Filter>([
    { "#h": ["community-0"] },
    { "&h": ["community-0"] },
    { kinds: [9] },
    { authors: ["0".repeat(64)] },
  ])("bulk reads a dense single index bucket: %j", async (filter) => {
    const expected = await reference([filter]);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    expect(await getEventsForFilter(db, filter)).toEqual(expected);
    expect(get).not.toHaveBeenCalled();
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("preserves tag limit ties, cached identity, AND/OR logic and per-filter limits", async () => {
    const cached = { ...events[638], content: "cached", created_at: 2000 };
    const eventMap = new Map([[cached.id, cached]]);
    const filter: Filter = {
      "#h": ["community-0"],
      "&t": ["shared"],
      "#t": ["shared"],
      limit: 10,
    };
    const expected = await reference([filter], undefined, eventMap);
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const result = await getEventsForFilter(db, filter, undefined, eventMap);
    expect(result).toEqual(expected);
    expect(result[0]).toBe(cached);
    expect(get.mock.calls.length).toBeLessThan(20);
    const filters = [filter, { "#h": ["community-1"], limit: 7 }];
    expect(await getEventsForFilters(db, filters)).toEqual(
      await reference(filters),
    );
  });

  it("does not bulk-read a broad bucket for sparse candidates or a warm event cache", async () => {
    const filter = { "#h": ["community-0"], authors: ["0".repeat(64)] };
    const expected = await reference([filter]);
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    expect(await getEventsForFilter(db, filter)).toEqual(expected);
    expect(getAll).not.toHaveBeenCalled();
    const eventMap = new Map(
      events.slice(0, 630).map((event) => [event.id, event]),
    );
    const cachedFilter = { kinds: [9] };
    expect(
      await getEventsForFilter(db, cachedFilter, undefined, eventMap),
    ).toEqual(await reference([cachedFilter], undefined, eventMap));
    expect(getAll).not.toHaveBeenCalled();
  });

  it("preserves cached precedence when bulk-reading the remaining bodies", async () => {
    const cached = { ...events[0], content: "cached" };
    const eventMap = new Map([[cached.id, cached]]);
    const filter = { kinds: [9] };
    const expected = await reference([filter], undefined, eventMap);
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    const result = await getEventsForFilter(db, filter, undefined, eventMap);
    expect(result).toEqual(expected);
    expect(result.find((event) => event.id === cached.id)).toBe(cached);
    expect(eventMap.size).toBe(1);
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("keeps partial/missing cached candidate indexes on the existing path", async () => {
    const cache = new IndexCache();
    cache.setKindIndex(
      9,
      new Set([...events.map((event) => event.id).reverse(), "missing"]),
    );
    const expected = await reference([{ kinds: [9] }], cache);
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    expect(await getEventsForFilter(db, { kinds: [9] }, cache)).toEqual(
      expected,
    );
    expect(getAll).not.toHaveBeenCalled();
  });

  it("leaves time-window reads and inclusive boundaries on the original path", async () => {
    const filter = {
      "#h": ["community-0"],
      since: 1020,
      until: 1060,
    };
    const expected = await reference([filter]);
    const count = vi.spyOn(IDBIndex.prototype, "count");
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    expect(await getEventsForFilter(db, filter)).toEqual(expected);
    expect(expected.some((event) => event.created_at === 1020)).toBe(true);
    expect(expected.some((event) => event.created_at === 1060)).toBe(true);
    expect(count).not.toHaveBeenCalled();
    expect(getAll).not.toHaveBeenCalled();
  });

  it("uses primary keys for retained replaceable versions and invokes the row reader", async () => {
    const tx = db.transaction("events", "readwrite");
    for (const event of events) {
      const version = { ...event, kind: 30023, tags: [["d", "same"]] };
      void tx.store.put(
        {
          event: version,
          tags: getEventTags(version),
          metadata: event.content,
        },
        event.id,
      );
    }
    await tx.done;
    const reader: EventReader = (row) => ({
      ...row.event,
      content: String(row.metadata),
    });
    const filter = { kinds: [30023] };
    const expected = await reference([filter], undefined, undefined, reader);
    const getAll = vi.spyOn(IDBIndex.prototype, "getAll");
    expect(
      await getEventsForFilter(db, filter, undefined, undefined, reader),
    ).toEqual(expected);
    expect(expected).toHaveLength(640);
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("does not prematurely limit tag matches transformed by a custom reader", async () => {
    const reader: EventReader = (row) => ({
      ...row.event,
      tags: row.event.created_at > 1050 ? [] : row.event.tags,
    });
    const filter = { "#h": ["community-0"], limit: 10 };
    expect(
      await getEventsForFilter(db, filter, undefined, undefined, reader),
    ).toEqual(await reference([filter], undefined, undefined, reader));
  });

  it("propagates custom reader failures and IndexedDB bulk read errors", async () => {
    const error = new Error("reader failed");
    await expect(
      getEventsForFilter(db, { kinds: [9] }, undefined, undefined, () => {
        throw error;
      }),
    ).rejects.toBe(error);
    vi.spyOn(IDBIndex.prototype, "getAll").mockImplementation(() => {
      throw new DOMException("bulk read failed", "UnknownError");
    });
    await expect(getEventsForFilter(db, { kinds: [9] })).rejects.toThrow(
      "bulk read failed",
    );
  });
});
