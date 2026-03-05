import { describe, it, expect, beforeEach } from "vitest";
import {
  getReplaceableEvents,
  countEventsByPubkeys,
  countEventsByKind,
  countEvents,
} from "../query-misc.js";
import { addEvents } from "../insert.js";
import { openDB } from "../database.js";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";

describe("query-misc", () => {
  let db: NostrIDBDatabase;
  let pubkey: string;

  beforeEach(async () => {
    db = await openDB("test-query-misc-" + Date.now());
    pubkey = getTestPublicKey();
  });

  describe("getReplaceableEvents", () => {
    it("should return the event for a single pointer", async () => {
      const event = createTestEvent({
        kind: 30023,
        tags: [["d", "article-1"]],
      });
      await addEvents(db, [event]);

      const results = await getReplaceableEvents(db, [
        { kind: 30023, pubkey, identifier: "article-1" },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(event.id);
    });

    it("should return an empty array for a pointer with no matching event", async () => {
      const results = await getReplaceableEvents(db, [
        { kind: 30023, pubkey, identifier: "ghost" },
      ]);

      expect(results).toHaveLength(0);
    });

    it("should handle a pointer without an identifier (uses empty string key)", async () => {
      const event = createTestEvent({ kind: 30001 }); // no d tag → "" identifier
      await addEvents(db, [event]);

      const results = await getReplaceableEvents(db, [{ kind: 30001, pubkey }]);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(event.id);
    });

    it("should return multiple events for multiple pointers, sorted by created_at descending", async () => {
      const old = createTestEvent({
        kind: 30023,
        created_at: 1000,
        tags: [["d", "article-1"]],
      });
      const recent = createTestEvent({
        kind: 30023,
        created_at: 2000,
        tags: [["d", "article-2"]],
      });
      await addEvents(db, [old, recent]);

      const results = await getReplaceableEvents(db, [
        { kind: 30023, pubkey, identifier: "article-1" },
        { kind: 30023, pubkey, identifier: "article-2" },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0].created_at).toBe(2000);
      expect(results[1].created_at).toBe(1000);
    });

    it("should deduplicate when the same pointer appears twice", async () => {
      const event = createTestEvent({
        kind: 30023,
        tags: [["d", "article-1"]],
      });
      await addEvents(db, [event]);

      const results = await getReplaceableEvents(db, [
        { kind: 30023, pubkey, identifier: "article-1" },
        { kind: 30023, pubkey, identifier: "article-1" },
      ]);

      // Same key — should produce only one result
      expect(results).toHaveLength(1);
    });
  });

  describe("countEventsByPubkeys", () => {
    it("should return an empty object when the DB is empty", async () => {
      const counts = await countEventsByPubkeys(db);
      expect(counts).toEqual({});
    });

    it("should return the correct count for a single pubkey", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 2 }),
      ]);

      const counts = await countEventsByPubkeys(db);

      expect(counts[pubkey]).toBe(3);
    });

    it("should return per-pubkey counts for all pubkeys in the DB", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
      ]);

      const counts = await countEventsByPubkeys(db);

      // All test events share the same pubkey from helpers
      const totalEvents = Object.values(counts).reduce((a, b) => a + b, 0);
      expect(totalEvents).toBe(2);
    });
  });

  describe("countEventsByKind", () => {
    it("should return an empty object when the DB is empty", async () => {
      const counts = await countEventsByKind(db);
      expect(counts).toEqual({});
    });

    it("should return the correct count for a single kind", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
      ]);

      const counts = await countEventsByKind(db);

      expect(counts[1]).toBe(3);
    });

    it("should return per-kind counts for multiple kinds", async () => {
      // Use non-replaceable kinds only (kind 3 is contacts — replaceable)
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 4 }),
        createTestEvent({ kind: 5 }),
        createTestEvent({ kind: 5 }),
        createTestEvent({ kind: 5 }),
      ]);

      const counts = await countEventsByKind(db);

      expect(counts[1]).toBe(2);
      expect(counts[4]).toBe(1);
      expect(counts[5]).toBe(3);
    });
  });

  describe("countEvents", () => {
    it("should return 0 for an empty DB", async () => {
      const count = await countEvents(db);
      expect(count).toBe(0);
    });

    it("should return the correct total count after inserts", async () => {
      await addEvents(db, [
        createTestEvent({ kind: 1 }),
        createTestEvent({ kind: 2 }),
        createTestEvent({ kind: 3 }),
      ]);

      const count = await countEvents(db);

      expect(count).toBe(3);
    });

    it("should count replaceable events as a single entry per UID", async () => {
      // Inserting two kind-0 events for the same pubkey — only one slot
      const older = createTestEvent({ kind: 0, created_at: 1000 });
      const newer = createTestEvent({ kind: 0, created_at: 2000 });
      await addEvents(db, [older, newer]);

      const count = await countEvents(db);

      expect(count).toBe(1); // second overwrites first
    });
  });
});
