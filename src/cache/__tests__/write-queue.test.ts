import { describe, it, expect, beforeEach, vi } from "vitest";
import { WriteQueue } from "../write-queue.js";
import { openDB } from "../../database/database.js";
import { getEventUID } from "../../database/common.js";
import type { NostrEvent } from "nostr-tools/pure";
import type { NostrIDBDatabase } from "../../database/schema.js";
import { createTestEvent } from "../../../tests/helpers.js";

describe("WriteQueue", () => {
  let db: NostrIDBDatabase;
  let queue: WriteQueue;

  beforeEach(async () => {
    db = await openDB("test-write-queue-" + Date.now());
    queue = new WriteQueue(db);
  });

  const createEvent = (kind = 1): NostrEvent => {
    return createTestEvent({ kind, created_at: Math.floor(Date.now() / 1000) });
  };

  describe("addEvent", () => {
    it("should add an event to the queue", () => {
      const event = createEvent();
      queue.addEvent(event);

      expect(queue["eventQueue"]).toHaveLength(1);
      expect(queue["eventQueue"][0]).toBe(event);
    });

    it("should not add duplicate events", () => {
      const event = createEvent();
      queue.addEvent(event);
      queue.addEvent(event);

      expect(queue["eventQueue"]).toHaveLength(1);
    });

    it("should track queued event IDs", () => {
      const event = createEvent();
      queue.addEvent(event);

      expect(queue["queuedIds"].has(event.id)).toBe(true);
    });

    it("should add event to lastUsedQueue", () => {
      const event = createEvent();
      queue.addEvent(event);

      expect(queue["lastUsedQueue"].size).toBeGreaterThan(0);
    });
  });

  describe("addEvents", () => {
    it("should add multiple events to the queue", () => {
      const events = [createEvent(), createEvent(), createEvent()];
      queue.addEvents(events);

      expect(queue["eventQueue"]).toHaveLength(3);
    });

    it("should filter out duplicate events", () => {
      const event1 = createEvent();
      const event2 = createEvent();

      queue.addEvent(event1);
      queue.addEvents([event1, event2]);

      expect(queue["eventQueue"]).toHaveLength(2);
    });

    it("should not add anything if all events are duplicates", () => {
      const event1 = createEvent();
      const event2 = createEvent();
      queue.addEvent(event1);
      queue.addEvent(event2);

      // Try to add the same events again - addEvents filters based on queuedIds
      queue.addEvents([event1, event2]);

      expect(queue["eventQueue"]).toHaveLength(2); // Still 2, not 4
    });
  });

  describe("touch", () => {
    it("should add single event UID to lastUsedQueue", () => {
      const event = createEvent();
      queue.touch(event);

      expect(queue["lastUsedQueue"].size).toBe(1);
    });

    it("should add multiple event UIDs to lastUsedQueue", () => {
      const events = [createEvent(), createEvent()];
      queue.touch(events);

      expect(queue["lastUsedQueue"].size).toBe(2);
    });

    it("should not add duplicates to lastUsedQueue", () => {
      const event = createEvent();
      queue.touch(event);
      queue.touch(event);

      expect(queue["lastUsedQueue"].size).toBe(1);
    });
  });

  describe("matchPending", () => {
    it("should return events matching the filter", () => {
      const event1 = createEvent(1);
      const event2 = createEvent(2);
      queue.addEvents([event1, event2]);

      const matches = queue.matchPending([{ kinds: [1] }]);

      expect(matches).toHaveLength(1);
      expect(matches[0].id).toBe(event1.id);
    });

    it("should return empty array if no events match", () => {
      const event1 = createEvent(1);
      queue.addEvent(event1);

      const matches = queue.matchPending([{ kinds: [2] }]);

      expect(matches).toHaveLength(0);
    });

    it("should match multiple filters", () => {
      const event1 = createEvent(1);
      const event2 = createEvent(2);
      queue.addEvents([event1, event2]);

      const matches = queue.matchPending([{ kinds: [1] }, { kinds: [2] }]);

      expect(matches).toHaveLength(2);
    });
  });

  describe("flush", () => {
    it("should write events to the database", async () => {
      const event = createEvent();
      queue.addEvent(event);

      await queue.flush();

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(event.id);
    });

    it("should remove flushed events from queue", async () => {
      const event = createEvent();
      queue.addEvent(event);

      await queue.flush();

      expect(queue["eventQueue"]).toHaveLength(0);
      expect(queue["queuedIds"].has(event.id)).toBe(false);
    });

    it("should flush only specified count of events", async () => {
      const events = Array.from({ length: 10 }, () => createEvent());
      queue.addEvents(events);

      await queue.flush(5);

      expect(queue["eventQueue"]).toHaveLength(5);
    });

    it("should update lastUsed entries", async () => {
      const event = createEvent();
      queue.addEvent(event);

      await queue.flush();

      const uid = getEventUID(event);
      const used = await db.get("used", uid);
      expect(used).toBeDefined();
      expect(used?.uid).toBe(uid);
    });

    it("should clear lastUsedQueue after flush", async () => {
      const event = createEvent();
      queue.addEvent(event);

      await queue.flush();

      expect(queue["lastUsedQueue"].size).toBe(0);
    });

    it("should call processEvents if provided", async () => {
      const event = createEvent();
      queue.addEvent(event);

      const processEvents = vi.fn().mockResolvedValue(undefined);
      queue.processEvents = processEvents;

      await queue.flush();

      expect(processEvents).toHaveBeenCalledWith([event]);
    });

    it("should use modified events from processEvents", async () => {
      const event = createEvent();
      queue.addEvent(event);

      const modifiedEvent = { ...event, content: "modified" };
      queue.processEvents = vi.fn().mockResolvedValue([modifiedEvent]);

      await queue.flush();

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.content).toBe("modified");
    });
  });

  describe("clear", () => {
    it("should clear all events from the queue", () => {
      const events = [createEvent(), createEvent()];
      queue.addEvents(events);

      queue.clear();

      expect(queue["eventQueue"]).toHaveLength(0);
    });

    it("should not clear queuedIds", () => {
      const event = createEvent();
      queue.addEvent(event);

      queue.clear();

      // queuedIds should still contain the ID until flush
      expect(queue["queuedIds"].has(event.id)).toBe(true);
    });
  });
});
