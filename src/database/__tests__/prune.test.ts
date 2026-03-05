import { describe, it, expect, beforeEach } from "vitest";
import { pruneLastUsed } from "../prune.js";
import { addEvents, updateUsed } from "../insert.js";
import { countEvents } from "../query-misc.js";
import { openDB } from "../database.js";
import type { NostrIDBDatabase } from "../schema.js";
import { createTestEvent } from "../../__tests__/helpers.js";

/**
 * Seeds `n` events into the DB and marks them as used with sequential timestamps.
 * The first event in the returned array is the oldest (lowest date in `used`).
 */
async function seedEventsWithUsed(
  db: NostrIDBDatabase,
  n: number,
): Promise<ReturnType<typeof createTestEvent>[]> {
  const events = Array.from({ length: n }, (_, i) =>
    createTestEvent({ kind: 1, created_at: 1000 + i }),
  );
  await addEvents(db, events);

  // Mark used with ascending timestamps so first is LRU (oldest)
  for (let i = 0; i < events.length; i++) {
    await db.put("used", { uid: events[i].id, date: 1000 + i });
  }

  return events;
}

describe("pruneLastUsed", () => {
  let db: NostrIDBDatabase;

  beforeEach(async () => {
    db = await openDB("test-prune-" + Date.now());
  });

  it("should do nothing when the event count is at or below maxEvents", async () => {
    await seedEventsWithUsed(db, 5);

    await pruneLastUsed(db, 5);

    expect(await countEvents(db)).toBe(5);
  });

  it("should do nothing when the DB is empty", async () => {
    await pruneLastUsed(db, 10);
    expect(await countEvents(db)).toBe(0);
  });

  it("should prune down to maxEvents, removing the oldest (LRU) entries first", async () => {
    const events = await seedEventsWithUsed(db, 10);

    await pruneLastUsed(db, 5);

    expect(await countEvents(db)).toBe(5);

    // The 5 oldest events (index 0–4) should be gone
    for (let i = 0; i < 5; i++) {
      expect(await db.get("events", events[i].id)).toBeUndefined();
    }

    // The 5 newest events (index 5–9) should remain
    for (let i = 5; i < 10; i++) {
      expect(await db.get("events", events[i].id)).toBeDefined();
    }
  });

  it("should also remove the corresponding used entries for pruned events", async () => {
    const events = await seedEventsWithUsed(db, 6);

    await pruneLastUsed(db, 4);

    // The 2 oldest used entries should be deleted
    expect(await db.get("used", events[0].id)).toBeUndefined();
    expect(await db.get("used", events[1].id)).toBeUndefined();

    // The 4 remaining used entries should still exist
    for (let i = 2; i < 6; i++) {
      expect(await db.get("used", events[i].id)).toBeDefined();
    }
  });

  it("should skip events for which the skip predicate returns true", async () => {
    const events = await seedEventsWithUsed(db, 5);

    // Protect the oldest event from being pruned
    const protectedId = events[0].id;
    await pruneLastUsed(db, 3, (event) => event.id === protectedId);

    // With 5 events, maxEvents=3 we need to remove 2.
    // events[0] is protected, so events[1] and events[2] should be removed instead.
    expect(await db.get("events", events[0].id)).toBeDefined();
    expect(await db.get("events", events[1].id)).toBeUndefined();
    expect(await db.get("events", events[2].id)).toBeUndefined();
  });

  it("should leave events that have no used entry untouched", async () => {
    // Insert events but do NOT add used entries for them
    const events = Array.from({ length: 5 }, () =>
      createTestEvent({ kind: 1 }),
    );
    await addEvents(db, events);
    // No updateUsed call — used store is empty

    // Pruning with an empty used store should not crash and not remove anything
    await pruneLastUsed(db, 3);

    // Nothing can be pruned (no LRU data), so all events stay
    expect(await countEvents(db)).toBe(5);
  });

  it("should correctly prune from 20 down to 10", async () => {
    await seedEventsWithUsed(db, 20);

    await pruneLastUsed(db, 10);

    expect(await countEvents(db)).toBe(10);
  });
});
