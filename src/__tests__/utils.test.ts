import { describe, it, expect } from "vitest";
import { sortByDate } from "../utils.js";
import type { NostrEvent } from "nostr-tools/pure";

describe("sortByDate", () => {
  const createEvent = (id: string, created_at: number): NostrEvent => ({
    id,
    pubkey: "pubkey1",
    created_at,
    kind: 1,
    tags: [],
    content: "test",
    sig: "sig1",
  });

  it("should sort events by created_at descending (newest first)", () => {
    const event1 = createEvent("event1", 1000);
    const event2 = createEvent("event2", 2000);
    const event3 = createEvent("event3", 3000);

    const sorted = [event1, event2, event3].sort(sortByDate);

    expect(sorted[0].id).toBe("event3");
    expect(sorted[1].id).toBe("event2");
    expect(sorted[2].id).toBe("event1");
  });

  it("should handle events with same timestamp", () => {
    const event1 = createEvent("event1", 1000);
    const event2 = createEvent("event2", 1000);

    const sorted = [event1, event2].sort(sortByDate);

    expect(sorted).toHaveLength(2);
    // Order should be stable for same timestamps
  });

  it("should handle single event", () => {
    const event = createEvent("event1", 1000);
    const sorted = [event].sort(sortByDate);

    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("event1");
  });

  it("should handle empty array", () => {
    const sorted = [].sort(sortByDate);
    expect(sorted).toHaveLength(0);
  });

  it("should work with already sorted array", () => {
    const event1 = createEvent("event1", 3000);
    const event2 = createEvent("event2", 2000);
    const event3 = createEvent("event3", 1000);

    const sorted = [event1, event2, event3].sort(sortByDate);

    expect(sorted[0].id).toBe("event1");
    expect(sorted[1].id).toBe("event2");
    expect(sorted[2].id).toBe("event3");
  });

  it("should work with reverse sorted array", () => {
    const event1 = createEvent("event1", 1000);
    const event2 = createEvent("event2", 2000);
    const event3 = createEvent("event3", 3000);

    const sorted = [event1, event2, event3].sort(sortByDate);

    expect(sorted[0].id).toBe("event3");
    expect(sorted[1].id).toBe("event2");
    expect(sorted[2].id).toBe("event1");
  });

  it("should handle large timestamp differences", () => {
    const event1 = createEvent("event1", 1);
    const event2 = createEvent("event2", Number.MAX_SAFE_INTEGER);

    const sorted = [event1, event2].sort(sortByDate);

    expect(sorted[0].id).toBe("event2");
    expect(sorted[1].id).toBe("event1");
  });
});
