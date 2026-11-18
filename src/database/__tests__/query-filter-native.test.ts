import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexCache } from "../../cache/index-cache.js";
import type { StoredEvent } from "../../lib/nostr.js";
import { selectEventsForFilters } from "../../utils.js";
import { openDB } from "../database.js";
import { getEventsForFilter } from "../query-filter.js";
import type { NostrIDBDatabase } from "../schema.js";

describe("native fallback event-body reads", () => {
  let db: NostrIDBDatabase;
  let events: StoredEvent[];
  let cache: IndexCache;

  beforeEach(async () => {
    db = await openDB("test-query-native-" + Date.now());
    events = Array.from({ length: 160 }, (_, i) => ({
      id: i.toString(16).padStart(64, "0"),
      pubkey: "a".repeat(64),
      kind: 9,
      created_at: 1000 + Math.floor(i / 8),
      content: String(i),
      tags: [],
    }));
    const tx = db.transaction("events", "readwrite");
    for (const event of events)
      void tx.store.put({ event, tags: [], metadata: event.content }, event.id);
    await tx.done;
    cache = new IndexCache();
    // Supplied candidate indexes retain the point-read path, in this order.
    cache.setKindIndex(9, new Set(events.map((event) => event.id).reverse()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    indexedDB.deleteDatabase(db.name);
  });

  it("preserves candidate/tie order without per-request Promise listeners", async () => {
    const get = vi.spyOn(IDBObjectStore.prototype, "get");
    const listen = vi.spyOn(IDBRequest.prototype, "addEventListener");
    const result = await getEventsForFilter(db, { kinds: [9] }, cache);
    expect(result).toEqual(
      selectEventsForFilters([...events].reverse(), [{ kinds: [9] }]),
    );
    expect(get).toHaveBeenCalledTimes(events.length);
    // idb promisification installs success/error listeners on every request.
    // The candidate lookup is fully cached, so these are body requests only.
    expect(listen).not.toHaveBeenCalled();
  });

  it("preserves cached object precedence, missing rows and custom row readers", async () => {
    cache.setKindIndex(
      9,
      new Set(["missing", ...events.map((event) => event.id).reverse()]),
    );
    const cached = { ...events[159], content: "cached" };
    const eventMap = new Map([[cached.id, cached]]);
    const reader = vi.fn((row) => ({
      ...row.event,
      content: `metadata:${row.metadata}`,
    }));
    const result = await getEventsForFilter(
      db,
      { kinds: [9] },
      cache,
      eventMap,
      reader,
    );
    const loaded = [...events]
      .reverse()
      .filter((event) => event.id !== cached.id)
      .map((event) => ({ ...event, content: `metadata:${event.content}` }));
    expect(result).toEqual(
      selectEventsForFilters([cached, ...loaded], [{ kinds: [9] }]),
    );
    expect(result[0]).toBe(cached);
    expect(reader).toHaveBeenCalledTimes(events.length - 1);
    expect(eventMap.size).toBe(1);
  });

  it.each([new Error("reader failed"), undefined])(
    "rejects with the original thrown reader value without aborting: %s",
    async (error) => {
      const get = IDBObjectStore.prototype.get;
      let completed!: Promise<void>;
      let transaction: IDBTransaction | null = null;
      vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(
        function (key) {
          const request = get.call(this, key);
          if (!transaction) {
            transaction = this.transaction;
            completed = new Promise((resolve) =>
              transaction!.addEventListener("complete", () => resolve(), {
                once: true,
              }),
            );
          }
          return request;
        },
      );
      const reader = vi.fn(() => {
        throw error;
      });
      await expect(
        getEventsForFilter(db, { kinds: [9] }, cache, undefined, reader),
      ).rejects.toBe(error);
      await completed;
      expect(transaction!.error).toBeNull();
      expect(reader).toHaveBeenCalledTimes(events.length);
    },
  );

  it("propagates synchronous native get failures", async () => {
    const error = new DOMException("native get failed", "DataError");
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(() => {
      throw error;
    });
    await expect(getEventsForFilter(db, { kinds: [9] }, cache)).rejects.toBe(
      error,
    );
  });

  it("propagates request errors and transaction aborts without unhandled rejections", async () => {
    const get = IDBObjectStore.prototype.get;
    let requestError: DOMException | null = null;
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementationOnce(
      function (key) {
        const request = get.call(this, key);
        request.addEventListener(
          "error",
          () => {
            requestError = request.error;
          },
          { once: true },
        );
        return request;
      },
    );
    // Abort after all gets are queued but before explicitly committing.
    vi.spyOn(IDBTransaction.prototype, "commit").mockImplementationOnce(
      function () {
        this.abort();
      },
    );
    const error = await getEventsForFilter(db, { kinds: [9] }, cache).catch(
      (error: unknown) => error,
    );
    expect(error).toBe(requestError);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });
});
