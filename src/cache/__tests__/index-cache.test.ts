import { describe, it, expect, beforeEach } from "vitest";
import { IndexCache } from "../index-cache.js";
import type { NostrEvent } from "nostr-tools/pure";

describe("IndexCache", () => {
  let cache: IndexCache;

  beforeEach(() => {
    cache = new IndexCache();
  });

  const createEvent = (
    id: string,
    kind: number,
    pubkey: string,
    tags: string[][] = [],
  ): NostrEvent => ({
    id,
    pubkey,
    created_at: Date.now(),
    kind,
    tags,
    content: "test",
    sig: "sig1",
  });

  describe("Kind Index", () => {
    it("should set and get kind index", () => {
      const uids = new Set(["event1", "event2"]);
      cache.setKindIndex(1, uids);

      const result = cache.getKindIndex(1);
      expect(result).toBeDefined();
      expect(result?.size).toBe(2);
      expect(result?.has("event1")).toBe(true);
      expect(result?.has("event2")).toBe(true);
    });

    it("should return undefined for non-existent kind", () => {
      const result = cache.getKindIndex(999);
      expect(result).toBeUndefined();
    });

    it("should update lastUsed when getting kind index", () => {
      cache.setKindIndex(1, new Set(["event1"]));
      cache.setKindIndex(2, new Set(["event2"]));

      cache.getKindIndex(1);

      // Kind 1 should be at the end of lastUsed
      expect(cache["lastUsed"][cache["lastUsed"].length - 1].key).toBe(1);
    });
  });

  describe("Pubkey Index", () => {
    it("should set and get pubkey index", () => {
      const uids = new Set(["event1", "event2"]);
      cache.setPubkeyIndex("pubkey1", uids);

      const result = cache.getPubkeyIndex("pubkey1");
      expect(result).toBeDefined();
      expect(result?.size).toBe(2);
      expect(result?.has("event1")).toBe(true);
    });

    it("should return undefined for non-existent pubkey", () => {
      const result = cache.getPubkeyIndex("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should update lastUsed when getting pubkey index", () => {
      cache.setPubkeyIndex("pubkey1", new Set(["event1"]));
      cache.setPubkeyIndex("pubkey2", new Set(["event2"]));

      cache.getPubkeyIndex("pubkey1");

      expect(cache["lastUsed"][cache["lastUsed"].length - 1].key).toBe(
        "pubkey1",
      );
    });
  });

  describe("Tag Index", () => {
    it("should set and get tag index", () => {
      const uids = new Set(["event1", "event2"]);
      cache.setTagIndex("eevent-id", uids);

      const result = cache.getTagIndex("eevent-id");
      expect(result).toBeDefined();
      expect(result?.size).toBe(2);
    });

    it("should return undefined for non-existent tag", () => {
      const result = cache.getTagIndex("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should update lastUsed when getting tag index", () => {
      cache.setTagIndex("tag1", new Set(["event1"]));
      cache.setTagIndex("tag2", new Set(["event2"]));

      cache.getTagIndex("tag1");

      expect(cache["lastUsed"][cache["lastUsed"].length - 1].key).toBe("tag1");
    });
  });

  describe("addEventToIndexes", () => {
    it("should add event to kind index if it exists", () => {
      cache.setKindIndex(1, new Set(["event1"]));
      const event = createEvent("event2", 1, "pubkey1");

      cache.addEventToIndexes(event);

      const kindIndex = cache.getKindIndex(1);
      expect(kindIndex?.has("event2")).toBe(true);
      expect(kindIndex?.size).toBe(2);
    });

    it("should add event to pubkey index if it exists", () => {
      cache.setPubkeyIndex("pubkey1", new Set(["event1"]));
      const event = createEvent("event2", 1, "pubkey1");

      cache.addEventToIndexes(event);

      const pubkeyIndex = cache.getPubkeyIndex("pubkey1");
      expect(pubkeyIndex?.has("event2")).toBe(true);
      expect(pubkeyIndex?.size).toBe(2);
    });

    it("should add event to tag indexes if they exist", () => {
      cache.setTagIndex("eevent-id-1", new Set(["event1"]));
      const event = createEvent("event2", 1, "pubkey1", [["e", "event-id-1"]]);

      cache.addEventToIndexes(event);

      const tagIndex = cache.getTagIndex("eevent-id-1");
      expect(tagIndex?.has("event2")).toBe(true);
    });

    it("should not create new indexes if they don't exist", () => {
      const event = createEvent("event1", 1, "pubkey1");

      cache.addEventToIndexes(event);

      expect(cache.getKindIndex(1)).toBeUndefined();
      expect(cache.getPubkeyIndex("pubkey1")).toBeUndefined();
    });
  });

  describe("removeEvent", () => {
    it("should remove event from kind index", () => {
      cache.setKindIndex(1, new Set(["event1", "event2"]));
      const event = createEvent("event1", 1, "pubkey1");

      cache.removeEvent(event);

      const kindIndex = cache.getKindIndex(1);
      expect(kindIndex?.has("event1")).toBe(false);
      expect(kindIndex?.size).toBe(1);
    });

    it("should remove event from pubkey index", () => {
      cache.setPubkeyIndex("pubkey1", new Set(["event1", "event2"]));
      const event = createEvent("event1", 1, "pubkey1");

      cache.removeEvent(event);

      const pubkeyIndex = cache.getPubkeyIndex("pubkey1");
      expect(pubkeyIndex?.has("event1")).toBe(false);
      expect(pubkeyIndex?.size).toBe(1);
    });

    it("should remove event from tag indexes", () => {
      cache.setTagIndex("eevent-id-1", new Set(["event1", "event2"]));
      const event = createEvent("event1", 1, "pubkey1", [["e", "event-id-1"]]);

      cache.removeEvent(event);

      const tagIndex = cache.getTagIndex("eevent-id-1");
      expect(tagIndex?.has("event1")).toBe(false);
      expect(tagIndex?.size).toBe(1);
    });
  });

  describe("clear", () => {
    it("should clear all indexes", () => {
      cache.setKindIndex(1, new Set(["event1"]));
      cache.setPubkeyIndex("pubkey1", new Set(["event1"]));
      cache.setTagIndex("tag1", new Set(["event1"]));

      cache.clear();

      expect(cache.kinds.size).toBe(0);
      expect(cache.pubkeys.size).toBe(0);
      expect(cache.tags.size).toBe(0);
      expect(cache["lastUsed"]).toHaveLength(0);
    });
  });

  describe("pruneIndexes", () => {
    it("should prune indexes when count exceeds max", () => {
      cache.max = 3;

      cache.setKindIndex(1, new Set(["event1"]));
      cache.setKindIndex(2, new Set(["event2"]));
      cache.setKindIndex(3, new Set(["event3"]));
      cache.setKindIndex(4, new Set(["event4"])); // This should trigger pruning

      // The first index (kind 1) should be pruned
      expect(cache.getKindIndex(1)).toBeUndefined();
      expect(cache.getKindIndex(2)).toBeDefined();
      expect(cache.getKindIndex(3)).toBeDefined();
      expect(cache.getKindIndex(4)).toBeDefined();
    });

    it("should maintain LRU order", () => {
      cache.max = 3;

      cache.setKindIndex(1, new Set(["event1"]));
      cache.setKindIndex(2, new Set(["event2"]));
      cache.setKindIndex(3, new Set(["event3"]));

      // Access kind 1 to make it recently used
      cache.getKindIndex(1);

      // Add a new index, should prune kind 2 (least recently used)
      cache.setKindIndex(4, new Set(["event4"]));

      expect(cache.getKindIndex(1)).toBeDefined();
      expect(cache.getKindIndex(2)).toBeUndefined();
      expect(cache.getKindIndex(3)).toBeDefined();
      expect(cache.getKindIndex(4)).toBeDefined();
    });

    it("should prune different types of indexes", () => {
      cache.max = 3;

      cache.setKindIndex(1, new Set(["event1"]));
      cache.setPubkeyIndex("pubkey1", new Set(["event2"]));
      cache.setTagIndex("tag1", new Set(["event3"]));
      cache.setKindIndex(2, new Set(["event4"])); // Should prune kind 1

      expect(cache.getKindIndex(1)).toBeUndefined();
      expect(cache.getPubkeyIndex("pubkey1")).toBeDefined();
      expect(cache.getTagIndex("tag1")).toBeDefined();
      expect(cache.getKindIndex(2)).toBeDefined();
    });
  });

  describe("count", () => {
    it("should return total count of all indexes", () => {
      cache.setKindIndex(1, new Set(["event1"]));
      cache.setPubkeyIndex("pubkey1", new Set(["event2"]));
      cache.setTagIndex("tag1", new Set(["event3"]));

      expect(cache.count).toBe(3);
    });

    it("should return 0 for empty cache", () => {
      expect(cache.count).toBe(0);
    });
  });
});
