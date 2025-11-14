import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NostrIDB } from "../nostrdb.js";
import { openDB } from "../../database/database.js";
import { getEventUID } from "../../database/common.js";
import type { NostrEvent } from "nostr-tools/pure";
import type { NostrIDBDatabase } from "../../database/schema.js";
import { createTestEvent, getTestPublicKey } from "../../../tests/helpers.js";

describe("NostrIDB", () => {
  let db: NostrIDBDatabase;
  let nostrDB: NostrIDB;
  let testPubkey: string;

  beforeEach(async () => {
    db = await openDB("test-nostrdb-" + Date.now());
    nostrDB = new NostrIDB(db, {
      writeInterval: 10,
      pruneInterval: 100000, // Set high to avoid pruning during tests
    });
    testPubkey = getTestPublicKey();
  });

  afterEach(async () => {
    await nostrDB.stop();
  });

  const createEvent = (
    kind = 1,
    created_at = Math.floor(Date.now() / 1000),
    tags: string[][] = [],
  ): NostrEvent => {
    return createTestEvent({ kind, created_at, tags });
  };

  describe("add", () => {
    it("should add an event to the database", async () => {
      const event = createEvent();
      const result = await nostrDB.add(event);

      expect(result).toBe(true);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stored = await nostrDB.event(event.id);
      expect(stored?.id).toBe(event.id);
    });

    it("should add event to in-memory eventMap", async () => {
      const event = createEvent();
      await nostrDB.add(event);

      const uid = getEventUID(event);
      expect(nostrDB.eventMap.has(uid)).toBe(true);
    });

    it("should not add ephemeral events to database", async () => {
      const event = createEvent(20000); // ephemeral kind
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const stored = await nostrDB.event(event.id);
      expect(stored).toBeUndefined();
    });

    it("should notify active subscriptions", async () => {
      const events: NostrEvent[] = [];
      const subscription = nostrDB.subscribe([{ kinds: [1] }], {
        event: (event) => events.push(event),
      });

      const event = createEvent(1);
      await nostrDB.add(event);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);

      subscription.close();
    });
  });

  describe("event", () => {
    it("should retrieve an event by ID", async () => {
      const event = createEvent();
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const retrieved = await nostrDB.event(event.id);
      expect(retrieved?.id).toBe(event.id);
    });

    it("should return undefined for non-existent event", async () => {
      const retrieved = await nostrDB.event("nonexistent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("replaceable", () => {
    it("should retrieve replaceable event", async () => {
      const event = createEvent(0);
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const retrieved = await nostrDB.replaceable(0, testPubkey);
      expect(retrieved?.id).toBe(event.id);
    });

    it("should retrieve addressable event with identifier", async () => {
      const event = createEvent(30000, Math.floor(Date.now() / 1000), [
        ["d", "test"],
      ]);
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const retrieved = await nostrDB.replaceable(30000, testPubkey, "test");
      expect(retrieved?.id).toBe(event.id);
    });
  });

  describe("filters", () => {
    it("should return events matching filters", async () => {
      const events = [
        createEvent(1, 1000),
        createEvent(1, 2000),
        createEvent(2, 3000),
      ];

      for (const event of events) {
        await nostrDB.add(event);
      }

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const result = await nostrDB.filters([{ kinds: [1] }]);

      expect(result).toHaveLength(2);
      expect(result[0].created_at).toBe(2000); // Sorted by date, newest first
      expect(result[1].created_at).toBe(1000);
    });

    it("should include pending events from write queue", async () => {
      const event1 = createEvent(1);
      await nostrDB.add(event1);

      // Don't wait for flush, query immediately
      const result = await nostrDB.filters([{ kinds: [1] }]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(event1.id);
    });

    it("should deduplicate events from queue and database", async () => {
      const event = createEvent(1);
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Add again (will be in queue)
      await nostrDB.add(event);

      const result = await nostrDB.filters([{ kinds: [1] }]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(event.id);
    });
  });

  describe("count", () => {
    it("should count events matching filters", async () => {
      const events = [createEvent(1), createEvent(1), createEvent(2)];

      for (const event of events) {
        await nostrDB.add(event);
      }

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const count = await nostrDB.count([{ kinds: [1] }]);
      expect(count).toBe(2);
    });
  });

  describe("subscribe", () => {
    it("should call event handler for existing events", async () => {
      const event = createEvent(1);
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const events: NostrEvent[] = [];
      const subscription = nostrDB.subscribe([{ kinds: [1] }], {
        event: (e) => events.push(e),
      });

      // Wait for subscription to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].id).toBe(event.id);

      subscription.close();
    });

    it("should receive new events after subscription", async () => {
      const events: NostrEvent[] = [];
      const subscription = nostrDB.subscribe([{ kinds: [1] }], {
        event: (e) => events.push(e),
      });

      const event = createEvent(1);
      await nostrDB.add(event);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);

      subscription.close();
    });

    it("should not receive events after close", async () => {
      const events: NostrEvent[] = [];
      const subscription = nostrDB.subscribe([{ kinds: [1] }], {
        event: (e) => events.push(e),
      });

      subscription.close();

      const event = createEvent(1);
      await nostrDB.add(event);

      expect(events).toHaveLength(0);
    });
  });

  describe("deleteEvent", () => {
    it("should delete an event by ID", async () => {
      const event = createEvent();
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const deleted = await nostrDB.deleteEvent(event.id);
      expect(deleted).toBe(true);

      const retrieved = await nostrDB.event(event.id);
      expect(retrieved).toBeUndefined();
    });

    it("should remove event from eventMap", async () => {
      const event = createEvent();
      await nostrDB.add(event);

      const uid = getEventUID(event);
      await nostrDB.deleteEvent(event.id);

      expect(nostrDB.eventMap.has(uid)).toBe(false);
    });

    it("should return false for non-existent event", async () => {
      const deleted = await nostrDB.deleteEvent("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("deleteReplaceable", () => {
    it("should delete replaceable event", async () => {
      const event = createEvent(0);
      await nostrDB.add(event);

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const deleted = await nostrDB.deleteReplaceable(testPubkey, 0);
      expect(deleted).toBe(true);

      const retrieved = await nostrDB.replaceable(0, testPubkey);
      expect(retrieved).toBeUndefined();
    });
  });

  describe("deleteByFilters", () => {
    it("should delete events matching filters", async () => {
      const events = [createEvent(1), createEvent(1), createEvent(2)];

      for (const event of events) {
        await nostrDB.add(event);
      }

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      const deletedCount = await nostrDB.deleteByFilters([{ kinds: [1] }]);
      expect(deletedCount).toBe(2);

      const remaining = await nostrDB.filters([{ kinds: [1, 2] }]);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].kind).toBe(2);
    });
  });

  describe("deleteAllEvents", () => {
    it("should delete all events", async () => {
      const events = [createEvent(1), createEvent(2), createEvent(3)];

      for (const event of events) {
        await nostrDB.add(event);
      }

      // Wait for flush
      await new Promise((resolve) => setTimeout(resolve, 50));

      await nostrDB.deleteAllEvents();

      const count = await nostrDB.count([{ kinds: [1, 2, 3] }]);
      expect(count).toBe(0);
      expect(nostrDB.eventMap.size).toBe(0);
    });
  });

  describe("supports", () => {
    it("should return supported features", async () => {
      const features = await nostrDB.supports();
      expect(features).toContain("subscribe");
    });
  });

  describe("start and stop", () => {
    it("should start the database", async () => {
      const newDB = new NostrIDB(db, { writeInterval: 10 });
      await newDB.start();

      expect(newDB.running).toBe(true);

      await newDB.stop();
    });

    it("should stop the database", async () => {
      await nostrDB.stop();
      expect(nostrDB.running).toBe(false);
    });

    it("should not start if already running", async () => {
      const newDB = new NostrIDB(db);
      await newDB.start();
      await newDB.start(); // Second start should be no-op

      expect(newDB.running).toBe(true);

      await newDB.stop();
    });
  });
});
