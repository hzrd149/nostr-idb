import { describe, it, expect, beforeEach, vi } from "vitest";
import { WriteQueue } from "../write-queue.js";
import { openDB } from "../../database/database.js";
import { getEventUID } from "../../database/common.js";
import type { NostrEvent } from "../../lib/nostr.js";
import type { NostrIDBDatabase } from "../../database/schema.js";
import { createTestEvent } from "../../__tests__/helpers.js";

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
    it("preserves same-call duplicates while excluding already queued IDs", () => {
      const first = createEvent();
      const second = createEvent();
      queue.addEvent(first);
      queue.addEvents([first, second, second]);
      expect(queue.matchPending([{}])).toEqual([first, second, second]);
      expect(queue["queuedIds"].size).toBe(2);
      expect(queue["lastUsedQueue"].size).toBe(2);
    });

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

    describe("NIP-91 &t filters", () => {
      it("should match events with ALL &t tag values (AND logic)", () => {
        const event1 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
          ],
        });
        const event2 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["t", "meme"]], // missing "cat"
        });
        queue.addEvents([event1, event2]);

        const matches = queue.matchPending([
          { kinds: [1], "&t": ["meme", "cat"] },
        ]);

        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe(event1.id);
      });

      it("should apply AND precedence over OR", () => {
        const event1 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
            ["t", "black"],
          ],
        });
        const event2 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
            ["t", "white"],
          ],
        });
        const event3 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "black"],
          ], // missing "cat"
        });
        queue.addEvents([event1, event2, event3]);

        const matches = queue.matchPending([
          { kinds: [1], "&t": ["meme", "cat"], "#t": ["black", "white"] },
        ]);

        expect(matches).toHaveLength(2);
        expect(matches.map((e) => e.id)).toContain(event1.id);
        expect(matches.map((e) => e.id)).toContain(event2.id);
        expect(matches.map((e) => e.id)).not.toContain(event3.id);
      });

      it("should ignore values in &t when processing #t", () => {
        const event1 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
          ],
        });
        const event2 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
            ["t", "black"],
          ],
        });
        queue.addEvents([event1, event2]);

        const matches = queue.matchPending([
          { kinds: [1], "&t": ["meme", "cat"], "#t": ["meme", "black"] },
        ]);

        // "meme" in #t should be ignored, so only event2 with "black" should match
        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe(event2.id);
      });

      it("should work with only &t filter (no #t)", () => {
        const event1 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["t", "meme"],
            ["t", "cat"],
          ],
        });
        const event2 = createTestEvent({
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["t", "meme"]],
        });
        queue.addEvents([event1, event2]);

        const matches = queue.matchPending([
          { kinds: [1], "&t": ["meme", "cat"] },
        ]);

        expect(matches).toHaveLength(1);
        expect(matches[0].id).toBe(event1.id);
      });
    });
  });

  describe("flush", () => {
    it("uses default 1000-event batches in FIFO order across compaction", async () => {
      const base = createEvent();
      const events = Array.from({ length: 2001 }, (_, i) => ({
        ...base,
        id: i.toString(16).padStart(64, "0"),
      }));
      queue.addEvents(events);
      const batches: NostrEvent[][] = [];
      queue.processEvents = async (batch) => {
        batches.push(batch);
        return [];
      };
      await queue.flush();
      expect(batches[0]).toEqual(events.slice(0, 1000));
      expect(queue.matchPending([{}])).toEqual(events.slice(1000));
      expect(queue["queuedIds"].size).toBe(1001);
      expect(await db.get("used", events[2000].id)).toBeDefined();
      await queue.flush();
      expect(batches[1]).toEqual(events.slice(1000, 2000));
      expect(queue.matchPending([{}])).toEqual(events.slice(2000));
      await queue.flush();
      await queue.flush();
      expect(batches.map((batch) => batch.length)).toEqual([1000, 1000, 1]);
      expect(queue.matchPending([{}])).toEqual([]);
      expect(queue["queuedIds"].size).toBe(0);
    });

    it("accepts and drains queues larger than the argument limit", async () => {
      const base = createEvent();
      const events = Array.from({ length: 150000 }, (_, i) => ({
        ...base,
        id: i.toString(16).padStart(64, "0"),
      }));
      queue.addEvents(events);
      expect(queue["lastUsedQueue"].size).toBe(events.length);
      // Isolate queue handling from 150k unrelated IndexedDB touch writes.
      queue["lastUsedQueue"].clear();
      let processed = 0;
      queue.processEvents = async (batch) => {
        for (const event of batch) {
          if (event !== events[processed++]) throw new Error("Out of order");
        }
        return [];
      };
      while (processed < events.length) await queue.flush(16384);
      expect(processed).toBe(events.length);
      expect(queue.matchPending([{}])).toEqual([]);
      expect(queue["queuedIds"].size).toBe(0);
    });

    it.each([1, 3])(
      "keeps events added during an async hook pending (batch %i)",
      async (count) => {
        const events = [createEvent(), createEvent(), createEvent()];
        const added = createEvent();
        queue.addEvents(events);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        queue.processEvents = async () => {
          await gate;
        };
        const flushing = queue.flush(count);
        expect(queue.matchPending([{}])).toEqual(events.slice(count));
        queue.addEvents([events[0], added]);
        expect(queue.matchPending([{}])).toEqual([
          ...events.slice(count),
          events[0],
          added,
        ]);
        release();
        await flushing;
        expect(queue["queuedIds"].has(events[0].id)).toBe(true);
        expect(await db.get("used", added.id)).toBeDefined();
        queue.processEvents = null;
        await queue.flush();
        expect(await db.get("events", added.id)).toBeDefined();
        expect(queue.matchPending([{}])).toEqual([]);
      },
    );

    it("preserves the remaining queue when the processing hook rejects", async () => {
      const events = [createEvent(), createEvent(), createEvent()];
      queue.addEvents(events);
      queue.processEvents = async () => {
        throw new Error("hook failed");
      };
      await expect(queue.flush(1)).rejects.toThrow("hook failed");
      expect(queue.matchPending([{}])).toEqual(events.slice(1));
      expect(queue["queuedIds"].has(events[0].id)).toBe(false);
      queue.processEvents = null;
      await queue.flush();
      expect(await db.get("events", events[2].id)).toBeDefined();
    });

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
    it("resets the pending cursor after a partial flush", async () => {
      queue.addEvents([createEvent(), createEvent(), createEvent()]);
      await queue.flush(1);
      queue.clear();
      const event = createEvent();
      queue.addEvent(event);
      expect(queue.matchPending([{}])).toEqual([event]);
      await queue.flush();
      expect(await db.get("events", event.id)).toBeDefined();
    });

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
