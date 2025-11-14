import { describe, it, expect, beforeEach } from "vitest";
import {
  getIdsForFilter,
  getEventsForFilter,
  countEventsForFilter,
  queryForPubkeys,
  queryForKinds,
  queryForTag,
} from "../query-filter.js";
import { addEvents } from "../insert.js";
import { openDB } from "../database.js";
import { IndexCache } from "../../cache/index-cache.js";
import type { NostrEvent } from "nostr-tools/pure";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";

describe("Query Filter", () => {
  let db: NostrIDBDatabase;
  let indexCache: IndexCache;
  let testPubkey: string;

  beforeEach(async () => {
    db = await openDB("test-query-" + Date.now());
    indexCache = new IndexCache();
    testPubkey = getTestPublicKey();
  });

  const createEvent = (
    kind: number,
    created_at: number,
    tags: string[][] = [],
  ): NostrEvent => {
    return createTestEvent({ kind, created_at, tags });
  };

  describe("queryForPubkeys", () => {
    it("should return event IDs for a single pubkey", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await queryForPubkeys(db, [testPubkey]);

      expect(ids.size).toBe(3);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
    });

    it("should return event IDs for multiple pubkeys", async () => {
      const events = [createEvent(1, 1000), createEvent(1, 2000)];
      await addEvents(db, events);

      const ids = await queryForPubkeys(db, [testPubkey]);

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
    });

    it("should use index cache when available", async () => {
      const events = [createEvent(1, 1000)];
      await addEvents(db, events);

      // First query populates cache
      await queryForPubkeys(db, [testPubkey], indexCache);

      // Second query should use cache
      const ids = await queryForPubkeys(db, [testPubkey], indexCache);

      expect(ids.size).toBe(1);
      expect(ids.has(events[0].id)).toBe(true);
      expect(indexCache.getPubkeyIndex(testPubkey)).toBeDefined();
    });

    it("should return empty set for non-existent pubkey", async () => {
      const ids = await queryForPubkeys(db, ["nonexistent"]);
      expect(ids.size).toBe(0);
    });
  });

  describe("queryForKinds", () => {
    it("should return event IDs for a single kind", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(2, 3000),
      ];
      await addEvents(db, events);

      const ids = await queryForKinds(db, [1]);

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
      expect(ids.has(events[2].id)).toBe(false);
    });

    it("should return event IDs for multiple kinds", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(2, 2000),
        createEvent(3, 3000),
      ];
      await addEvents(db, events);

      const ids = await queryForKinds(db, [1, 2]);

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
      expect(ids.has(events[2].id)).toBe(false);
    });

    it("should use index cache when available", async () => {
      const events = [createEvent(1, 1000)];
      await addEvents(db, events);

      await queryForKinds(db, [1], indexCache);
      const ids = await queryForKinds(db, [1], indexCache);

      expect(ids.size).toBe(1);
      expect(indexCache.getKindIndex(1)).toBeDefined();
    });
  });

  describe("queryForTag", () => {
    it("should return event IDs for a single tag value", async () => {
      const events = [
        createEvent(1, 1000, [["e", "ref1"]]),
        createEvent(1, 2000, [["e", "ref1"]]),
        createEvent(1, 3000, [["e", "ref2"]]),
      ];
      await addEvents(db, events);

      const ids = await queryForTag(db, "e", ["ref1"]);

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
      expect(ids.has(events[2].id)).toBe(false);
    });

    it("should return event IDs for multiple tag values", async () => {
      const events = [
        createEvent(1, 1000, [["e", "ref1"]]),
        createEvent(1, 2000, [["e", "ref2"]]),
        createEvent(1, 3000, [["e", "ref3"]]),
      ];
      await addEvents(db, events);

      const ids = await queryForTag(db, "e", ["ref1", "ref2"]);

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
      expect(ids.has(events[2].id)).toBe(false);
    });

    it("should use index cache when available", async () => {
      const events = [createEvent(1, 1000, [["e", "ref1"]])];
      await addEvents(db, events);

      await queryForTag(db, "e", ["ref1"], indexCache);
      const ids = await queryForTag(db, "e", ["ref1"], indexCache);

      expect(ids.size).toBe(1);
      expect(indexCache.getTagIndex("eref1")).toBeDefined();
    });
  });

  describe("getIdsForFilter", () => {
    it("should filter by ids", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, {
        ids: [events[0].id, events[1].id],
      });

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
    });

    it("should filter by authors", async () => {
      const events = [createEvent(1, 1000), createEvent(1, 2000)];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { authors: [testPubkey] });

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
    });

    it("should filter by kinds", async () => {
      const events = [createEvent(1, 1000), createEvent(2, 2000)];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { kinds: [1] });

      expect(ids.size).toBe(1);
      expect(ids.has(events[0].id)).toBe(true);
    });

    it("should filter by since", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { since: 2000 });

      expect(ids.size).toBe(2);
      expect(ids.has(events[1].id)).toBe(true);
      expect(ids.has(events[2].id)).toBe(true);
    });

    it("should filter by until", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { until: 2000 });

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
      expect(ids.has(events[1].id)).toBe(true);
    });

    it("should filter by since and until", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { since: 1500, until: 2500 });

      expect(ids.size).toBe(1);
      expect(ids.has(events[1].id)).toBe(true);
    });

    it("should filter by tag", async () => {
      const events = [
        createEvent(1, 1000, [["e", "ref1"]]),
        createEvent(1, 2000, [["e", "ref2"]]),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { "#e": ["ref1"] });

      expect(ids.size).toBe(1);
      expect(ids.has(events[0].id)).toBe(true);
    });

    it("should combine multiple filters with AND logic", async () => {
      const events = [
        createEvent(1, 1000, [["e", "ref1"]]),
        createEvent(1, 2000, [["e", "ref1"]]),
        createEvent(2, 3000, [["e", "ref1"]]),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, {
        kinds: [1],
        authors: [testPubkey],
        "#e": ["ref1"],
      });

      expect(ids.size).toBe(2);
      expect(ids.has(events[0].id)).toBe(true);
    });

    it("should apply limit when using time filter", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const ids = await getIdsForFilter(db, { since: 1000, limit: 2 });

      expect(ids.size).toBe(2);
    });

    it("should return empty set for search filters", async () => {
      const ids = await getIdsForFilter(db, { search: "test" });
      expect(ids.size).toBe(0);
    });
  });

  describe("getEventsForFilter", () => {
    it("should return events sorted by date (newest first)", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 3000),
        createEvent(1, 2000),
      ];
      await addEvents(db, events);

      const result = await getEventsForFilter(db, { kinds: [1] });

      expect(result).toHaveLength(3);
      expect(result[0].created_at).toBe(3000);
      expect(result[1].created_at).toBe(2000);
      expect(result[2].created_at).toBe(1000);
    });

    it("should respect limit", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(1, 3000),
      ];
      await addEvents(db, events);

      const result = await getEventsForFilter(db, { kinds: [1], limit: 2 });

      expect(result).toHaveLength(2);
    });

    it("should use eventMap for cached events", async () => {
      const events = [createEvent(1, 1000)];
      await addEvents(db, events);

      const eventMap = new Map();
      eventMap.set(events[0].id, events[0]);

      const result = await getEventsForFilter(
        db,
        { ids: [events[0].id] },
        indexCache,
        eventMap,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(events[0]);
    });
  });

  describe("countEventsForFilter", () => {
    it("should return count of matching events", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(2, 3000),
      ];
      await addEvents(db, events);

      const count = await countEventsForFilter(db, { kinds: [1] });

      expect(count).toBe(2);
    });

    it("should return 0 for no matches", async () => {
      const count = await countEventsForFilter(db, { kinds: [999] });
      expect(count).toBe(0);
    });
  });
});
