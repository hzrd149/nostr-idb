import { describe, it, expect, beforeEach } from "vitest";
import { addEvents, updateUsed } from "../insert.js";
import { openDB } from "../database.js";
import { getEventUID } from "../common.js";
import type { NostrEvent } from "nostr-tools/pure";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent, getTestPublicKey } from "../../__tests__/helpers.js";

describe("addEvents", () => {
  let db: NostrIDBDatabase;

  beforeEach(async () => {
    db = await openDB("test-insert-" + Date.now());
  });

  const createEvent = (
    kind = 1,
    created_at = Math.floor(Date.now() / 1000),
    tags: string[][] = [],
    content = "test",
  ): NostrEvent => {
    return createTestEvent({ kind, created_at, tags, content });
  };

  describe("Regular Events", () => {
    it("should add a single event to the database", async () => {
      const event = createEvent();
      await addEvents(db, [event]);

      const stored = await db.get("events", event.id);
      expect(stored?.event.id).toBe(event.id);
    });

    it("should add multiple events to the database", async () => {
      const events = [createEvent(), createEvent(), createEvent()];
      await addEvents(db, events);

      const stored1 = await db.get("events", events[0].id);
      const stored2 = await db.get("events", events[1].id);
      const stored3 = await db.get("events", events[2].id);

      expect(stored1?.event.id).toBe(events[0].id);
      expect(stored2?.event.id).toBe(events[1].id);
      expect(stored3?.event.id).toBe(events[2].id);
    });

    it("should store event tags for indexing", async () => {
      const event = createEvent(1, Math.floor(Date.now() / 1000), [
        ["e", "referenced-event"],
        ["p", "mentioned-pubkey"],
      ]);
      await addEvents(db, [event]);

      const stored = await db.get("events", event.id);
      expect(stored?.tags).toContain("ereferenced-event");
      expect(stored?.tags).toContain("pmentioned-pubkey");
    });

    it("should filter out invalid events", async () => {
      const validEvent = createEvent();
      // Create an event with missing required fields
      const invalidEvent: any = {
        kind: 1,
        content: "test",
        // Missing pubkey, created_at, id, sig, tags
      };

      await addEvents(db, [validEvent, invalidEvent]);

      const stored1 = await db.get("events", validEvent.id);

      expect(stored1).toBeDefined();
      // The invalid event should not be stored
      const allEvents = await db.getAll("events");
      expect(allEvents).toHaveLength(1);
    });
  });

  describe("Replaceable Events", () => {
    it("should store replaceable event with UID key (kind 0)", async () => {
      const event = createEvent(0); // metadata
      await addEvents(db, [event]);

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(event.id);
      expect(uid).toBe(`0:${event.pubkey}:`);
    });

    it("should replace older event with newer one (kind 0)", async () => {
      const pubkey = getTestPublicKey();
      const oldEvent = createEvent(0, 1000);
      const newEvent = createEvent(0, 2000);

      await addEvents(db, [oldEvent]);
      await addEvents(db, [newEvent]);

      const uid = `0:${pubkey}:`;
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(newEvent.id);
      expect(stored?.event.created_at).toBe(2000);
    });

    it("should not replace newer event with older one (kind 0)", async () => {
      const pubkey = getTestPublicKey();
      // Create events with explicit timestamps
      const now = Math.floor(Date.now() / 1000);
      const newEvent = createEvent(0, now, [], "newer");
      const oldEvent = createEvent(0, now - 10, [], "older");

      // Add newer event first
      await addEvents(db, [newEvent]);
      // Try to add older event - should not replace
      await addEvents(db, [oldEvent]);

      const uid = `0:${pubkey}:`;
      const stored = await db.get("events", uid);
      // Should still have the newer event
      expect(stored?.event.content).toBe("newer");
      expect(stored?.event.created_at).toBe(now);
    });

    it("should handle replaceable events with same timestamp", async () => {
      const pubkey = getTestPublicKey();
      const event1 = createEvent(0, 1000);
      const event2 = createEvent(0, 1000);

      await addEvents(db, [event1]);
      await addEvents(db, [event2]);

      const uid = `0:${pubkey}:`;
      const stored = await db.get("events", uid);
      // Should store the second one since created_at is not less
      expect(stored?.event.id).toBe(event2.id);
    });

    it("should store replaceable event kind 3 (contacts)", async () => {
      const event = createEvent(3);
      await addEvents(db, [event]);

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(event.id);
    });
  });

  describe("Addressable Events", () => {
    it("should store addressable event with d tag (kind 30000)", async () => {
      const event = createEvent(30000, Math.floor(Date.now() / 1000), [
        ["d", "my-list"],
      ]);
      await addEvents(db, [event]);

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(event.id);
      expect(uid).toBe(`30000:${event.pubkey}:my-list`);
    });

    it("should store addressable event without d tag", async () => {
      const event = createEvent(30001);
      await addEvents(db, [event]);

      const uid = getEventUID(event);
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(event.id);
    });

    it("should replace older addressable event with newer one", async () => {
      const pubkey = getTestPublicKey();
      const oldEvent = createEvent(30023, 1000, [["d", "article-1"]]);
      const newEvent = createEvent(30023, 2000, [["d", "article-1"]]);

      await addEvents(db, [oldEvent]);
      await addEvents(db, [newEvent]);

      const uid = `30023:${pubkey}:article-1`;
      const stored = await db.get("events", uid);
      expect(stored?.event.id).toBe(newEvent.id);
    });

    it("should not replace newer addressable event with older one", async () => {
      const pubkey = getTestPublicKey();
      // Create events with explicit timestamps
      const now = Math.floor(Date.now() / 1000);
      const newEvent = createEvent(30023, now, [["d", "article-1"]], "newer");
      const oldEvent = createEvent(
        30023,
        now - 10,
        [["d", "article-1"]],
        "older",
      );

      // Add newer event first
      await addEvents(db, [newEvent]);
      // Try to add older event - should not replace
      await addEvents(db, [oldEvent]);

      const uid = `30023:${pubkey}:article-1`;
      const stored = await db.get("events", uid);
      // Should still have the newer event
      expect(stored?.event.content).toBe("newer");
      expect(stored?.event.created_at).toBe(now);
    });

    it("should store different addressable events with different d tags", async () => {
      const pubkey = getTestPublicKey();
      const event1 = createEvent(30023, Math.floor(Date.now() / 1000), [
        ["d", "article-1"],
      ]);
      const event2 = createEvent(30023, Math.floor(Date.now() / 1000), [
        ["d", "article-2"],
      ]);

      await addEvents(db, [event1, event2]);

      const stored1 = await db.get("events", `30023:${pubkey}:article-1`);
      const stored2 = await db.get("events", `30023:${pubkey}:article-2`);

      expect(stored1?.event.id).toBe(event1.id);
      expect(stored2?.event.id).toBe(event2.id);
    });
  });

  describe("Mixed Event Types", () => {
    it("should handle batch with mixed event types", async () => {
      const pubkey = getTestPublicKey();
      const regularEvent = createEvent(1);
      const replaceableEvent = createEvent(0);
      const addressableEvent = createEvent(
        30000,
        Math.floor(Date.now() / 1000),
        [["d", "test"]],
      );

      await addEvents(db, [regularEvent, replaceableEvent, addressableEvent]);

      const stored1 = await db.get("events", regularEvent.id);
      const stored2 = await db.get("events", `0:${pubkey}:`);
      const stored3 = await db.get("events", `30000:${pubkey}:test`);

      expect(stored1?.event.id).toBe(regularEvent.id);
      expect(stored2?.event.id).toBe(replaceableEvent.id);
      expect(stored3?.event.id).toBe(addressableEvent.id);
    });
  });
});

describe("updateUsed", () => {
  let db: NostrIDBDatabase;

  beforeEach(async () => {
    db = await openDB("test-used-" + Date.now());
  });

  it("should update used timestamp for a single UID", async () => {
    await updateUsed(db, ["event1"]);

    const used = await db.get("used", "event1");
    expect(used).toBeDefined();
    expect(used?.uid).toBe("event1");
    expect(used?.date).toBeGreaterThan(0);
  });

  it("should update used timestamp for multiple UIDs", async () => {
    await updateUsed(db, ["event1", "event2", "event3"]);

    const used1 = await db.get("used", "event1");
    const used2 = await db.get("used", "event2");
    const used3 = await db.get("used", "event3");

    expect(used1?.uid).toBe("event1");
    expect(used2?.uid).toBe("event2");
    expect(used3?.uid).toBe("event3");
  });

  it("should update existing used entry", async () => {
    await updateUsed(db, ["event1"]);
    const first = await db.get("used", "event1");

    // Wait a bit to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await updateUsed(db, ["event1"]);
    const second = await db.get("used", "event1");

    expect(second?.date).toBeGreaterThanOrEqual(first!.date);
  });

  it("should work with Set as input", async () => {
    const uids = new Set(["event1", "event2"]);
    await updateUsed(db, uids);

    const used1 = await db.get("used", "event1");
    const used2 = await db.get("used", "event2");

    expect(used1).toBeDefined();
    expect(used2).toBeDefined();
  });
});
