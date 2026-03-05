import { describe, it, expect, beforeEach } from "vitest";
import {
  deleteEvent,
  deleteReplaceable,
  deleteAllReplaceable,
  deleteEventsByIds,
  deleteByFilter,
  deleteByFilters,
  deleteAllEvents,
} from "../delete.js";
import { addEvents } from "../insert.js";
import { openDB } from "../database.js";
import { getEventUID } from "../common.js";
import { IndexCache } from "../../cache/index-cache.js";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";

describe("delete", () => {
  let db: NostrIDBDatabase;
  let pubkey: string;

  beforeEach(async () => {
    db = await openDB("test-delete-" + Date.now());
    pubkey = getTestPublicKey();
  });

  describe("deleteEvent", () => {
    it("should delete an existing event and return true", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      const result = await deleteEvent(db, event.id);

      expect(result).toBe(true);
      const stored = await db.get("events", event.id);
      expect(stored).toBeUndefined();
    });

    it("should return false for a non-existent event", async () => {
      const result = await deleteEvent(db, "nonexistent-id");
      expect(result).toBe(false);
    });

    it("should delete a replaceable event by its UID key", async () => {
      const event = createTestEvent({ kind: 0 });
      await addEvents(db, [event]);
      const uid = getEventUID(event); // "0:pubkey:"

      const result = await deleteEvent(db, uid);

      expect(result).toBe(true);
      const stored = await db.get("events", uid);
      expect(stored).toBeUndefined();
    });

    it("should update IndexCache when a cache is provided", async () => {
      const cache = new IndexCache();
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      // Seed the cache with the event's pubkey index
      cache.setPubkeyIndex(pubkey, new Set([event.id]));
      expect(cache.getPubkeyIndex(pubkey)?.has(event.id)).toBe(true);

      await deleteEvent(db, event.id, cache);

      // Cache should no longer contain the event
      expect(cache.getPubkeyIndex(pubkey)?.has(event.id)).toBe(false);
    });

    it("should work without a cache parameter", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      // Should not throw
      await expect(deleteEvent(db, event.id)).resolves.toBe(true);
    });
  });

  describe("deleteReplaceable", () => {
    it("should delete a replaceable event (kind 0) by pubkey and kind", async () => {
      const event = createTestEvent({ kind: 0 });
      await addEvents(db, [event]);

      const result = await deleteReplaceable(db, pubkey, 0);

      expect(result).toBe(true);
      const stored = await db.get("events", `0:${pubkey}:`);
      expect(stored).toBeUndefined();
    });

    it("should delete an addressable event (kind 30000) with identifier", async () => {
      const event = createTestEvent({
        kind: 30000,
        tags: [["d", "my-list"]],
      });
      await addEvents(db, [event]);

      const result = await deleteReplaceable(db, pubkey, 30000, "my-list");

      expect(result).toBe(true);
      const stored = await db.get("events", `30000:${pubkey}:my-list`);
      expect(stored).toBeUndefined();
    });

    it("should delete an addressable event with an empty identifier", async () => {
      const event = createTestEvent({ kind: 30001 }); // no d tag → identifier ""
      await addEvents(db, [event]);

      const result = await deleteReplaceable(db, pubkey, 30001, "");

      expect(result).toBe(true);
    });

    it("should return false when the event does not exist", async () => {
      const result = await deleteReplaceable(db, pubkey, 0);
      expect(result).toBe(false);
    });

    it("should throw for a non-replaceable kind", async () => {
      await expect(deleteReplaceable(db, pubkey, 1)).rejects.toThrow(
        "Kind 1 is not replaceable",
      );
    });
  });

  describe("deleteAllReplaceable", () => {
    it("should delete all replaceable events for pubkey and kind, returning the count", async () => {
      // kind 0 is replaceable — only one is stored at a time (same UID)
      // Use an addressable kind so multiple can coexist with different d-tags
      const e1 = createTestEvent({ kind: 30023, tags: [["d", "article-1"]] });
      const e2 = createTestEvent({ kind: 30023, tags: [["d", "article-2"]] });
      await addEvents(db, [e1, e2]);

      const count = await deleteAllReplaceable(db, pubkey, 30023);

      expect(count).toBe(2);
      const remaining = await db.getAll("events");
      expect(remaining).toHaveLength(0);
    });

    it("should return 0 when no matching events exist", async () => {
      const count = await deleteAllReplaceable(db, pubkey, 30023);
      expect(count).toBe(0);
    });

    it("should throw for a non-replaceable kind", async () => {
      await expect(deleteAllReplaceable(db, pubkey, 1)).rejects.toThrow(
        "Kind 1 is not replaceable",
      );
    });

    it("should update IndexCache for each deleted event", async () => {
      const cache = new IndexCache();
      const e1 = createTestEvent({ kind: 30023, tags: [["d", "article-1"]] });
      const e2 = createTestEvent({ kind: 30023, tags: [["d", "article-2"]] });
      await addEvents(db, [e1, e2]);

      // IndexCache.removeEvent uses event.id (the hash), not the UID.
      // Seed the pubkey index with the event hashes so removeEvent can find them.
      cache.setPubkeyIndex(pubkey, new Set([e1.id, e2.id]));

      await deleteAllReplaceable(db, pubkey, 30023, cache);

      // Both event hashes should be removed from the pubkey index
      expect(cache.getPubkeyIndex(pubkey)?.has(e1.id)).toBe(false);
      expect(cache.getPubkeyIndex(pubkey)?.has(e2.id)).toBe(false);
    });
  });

  describe("deleteEventsByIds", () => {
    it("should delete multiple events and return the correct count", async () => {
      const events = [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
      ];
      await addEvents(db, events);

      const count = await deleteEventsByIds(db, [events[0].id, events[1].id]);

      expect(count).toBe(2);
      expect(await db.get("events", events[0].id)).toBeUndefined();
      expect(await db.get("events", events[1].id)).toBeUndefined();
      expect(await db.get("events", events[2].id)).toBeDefined();
    });

    it("should return 0 for an empty array without touching the DB", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      const count = await deleteEventsByIds(db, []);

      expect(count).toBe(0);
      expect(await db.get("events", event.id)).toBeDefined();
    });

    it("should ignore IDs that do not exist and count only actual deletes", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      const count = await deleteEventsByIds(db, [event.id, "ghost-id"]);

      expect(count).toBe(1);
    });

    it("should update IndexCache for each deleted event", async () => {
      const cache = new IndexCache();
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);
      cache.setPubkeyIndex(pubkey, new Set([event.id]));

      await deleteEventsByIds(db, [event.id], cache);

      expect(cache.getPubkeyIndex(pubkey)?.has(event.id)).toBe(false);
    });
  });

  describe("deleteByFilter", () => {
    it("should delete events matching a kind filter and return the count", async () => {
      const keep = createTestEvent({ kind: 2 });
      const del1 = createTestEvent({ kind: 1 });
      const del2 = createTestEvent({ kind: 1 });
      await addEvents(db, [keep, del1, del2]);

      const count = await deleteByFilter(db, { kinds: [1] });

      expect(count).toBe(2);
      expect(await db.get("events", del1.id)).toBeUndefined();
      expect(await db.get("events", del2.id)).toBeUndefined();
      expect(await db.get("events", keep.id)).toBeDefined();
    });

    it("should delete events matching an author filter", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      const count = await deleteByFilter(db, { authors: [pubkey] });

      expect(count).toBe(1);
    });

    it("should return 0 when no events match", async () => {
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);

      const count = await deleteByFilter(db, { kinds: [999] });

      expect(count).toBe(0);
      expect(await db.get("events", event.id)).toBeDefined();
    });
  });

  describe("deleteByFilters", () => {
    it("should delete the union of all matching filters without double-counting", async () => {
      // Use kind 4 (non-replaceable) so all events get distinct IDB keys
      const e1 = createTestEvent({ kind: 4 });
      const e2 = createTestEvent({ kind: 4 });
      const e3 = createTestEvent({ kind: 5 });
      await addEvents(db, [e1, e2, e3]);

      // e1 and e2 match both filters — should only be deleted once each
      const count = await deleteByFilters(db, [
        { kinds: [4] },
        { ids: [e1.id, e2.id] }, // same events again — union should deduplicate
      ]);

      expect(count).toBe(2); // e1 and e2
      expect(await db.get("events", e3.id)).toBeDefined();
    });

    it("should return 0 when no filters match", async () => {
      await addEvents(db, [createTestEvent({ kind: 1 })]);
      const count = await deleteByFilters(db, [{ kinds: [999] }]);
      expect(count).toBe(0);
    });
  });

  describe("deleteAllEvents", () => {
    it("should clear all events from the store", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 2 }),
        createTestEvent({ kind: 3 }),
      ]);

      await deleteAllEvents(db);

      const remaining = await db.getAll("events");
      expect(remaining).toHaveLength(0);
    });

    it("should clear the IndexCache when one is provided", async () => {
      const cache = new IndexCache();
      const event = createTestEvent({ kind: 1 });
      await addEvents(db, [event]);
      cache.setKindIndex(1, new Set([event.id]));

      await deleteAllEvents(db, cache);

      expect(cache.count).toBe(0);
    });

    it("should work without a cache parameter", async () => {
      await addEvents(db, [createTestEvent({ kind: 1 })]);
      await expect(deleteAllEvents(db)).resolves.toBeUndefined();
    });
  });
});
