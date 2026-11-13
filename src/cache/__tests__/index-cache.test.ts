import { describe, it, expect, beforeEach } from "vitest";
import { IndexCache } from "../index-cache.js";
import type { NostrEvent } from "../../lib/nostr.js";

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
    it("preserves successors when touching middle and newest entries", () => {
      cache.max = 4;
      for (const kind of [1, 2, 3, 4]) cache.setKindIndex(kind, []);

      cache.getKindIndex(2);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([1, 3, 4, 2]);
      cache.getKindIndex(2);
      cache.getKindIndex(4);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([1, 3, 2, 4]);

      cache.setKindIndex(5, []);
      cache.setKindIndex(6, []);
      expect([...cache.kinds.keys()]).toEqual([2, 4, 5, 6]);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([2, 4, 5, 6]);
    });

    it.each(["kind", "pubkey", "tag"] as const)(
      "replaces a %s index without retaining or evicting stale objects",
      (type) => {
        cache.max = 2;
        const set = (uids: string[]) => {
          if (type === "kind") cache.setKindIndex(1, uids);
          else if (type === "pubkey") cache.setPubkeyIndex("key", uids);
          else cache.setTagIndex("key", uids);
        };
        const get = () => {
          if (type === "kind") return cache.getKindIndex(1);
          if (type === "pubkey") return cache.getPubkeyIndex("key");
          return cache.getTagIndex("key");
        };
        set(["old"]);
        const old = get();
        cache.setKindIndex(99, []);
        for (let i = 0; i < 20; i++) set(["new"]);
        const current = get();
        expect(current).not.toBe(old);
        expect([...current!]).toEqual(["new"]);
        expect(cache.count).toBe(2);
        expect(cache.lastUsed).toHaveLength(2);
        expect(cache.lastUsed).not.toContain(old);
        expect(cache.kinds.has(99)).toBe(true);

        cache.setKindIndex(100, []);
        expect(cache.kinds.has(99)).toBe(false);
        expect(get()).toBe(current);
        cache.setKindIndex(101, []);
        cache.setKindIndex(102, []);
        expect(get()).toBeUndefined();
        expect(cache.lastUsed).not.toContain(current);
        expect(cache.count).toBe(2);
      },
    );

    it("stays bounded across interleaved types, touches, and replacements", () => {
      cache.max = 7;
      const expected = new Map<string, unknown>();
      for (let i = 0; i < 300; i++) {
        const key = i % 11;
        const type = i % 3;
        const id = `${type}:${key}`;
        if (type === 0) cache.setKindIndex(key, []);
        else if (type === 1) cache.setPubkeyIndex(String(key), []);
        else cache.setTagIndex(String(key), []);
        expected.delete(id);
        expected.set(id, undefined);
        if (expected.size > cache.max) {
          expected.delete(expected.keys().next().value!);
        }

        const touchKey = (i + 5) % 11;
        const touched = cache.getKindIndex(touchKey);
        const touchID = `0:${touchKey}`;
        expect(!!touched).toBe(expected.has(touchID));
        if (touched) {
          expected.delete(touchID);
          expected.set(touchID, undefined);
        }
        expect(cache.count).toBe(expected.size);
        expect(
          cache.lastUsed.map(
            (index) =>
              `${["kind", "pubkey", "tag"].indexOf(index.type)}:${index.key}`,
          ),
        ).toEqual([...expected.keys()]);
      }
    });

    it("does not reintroduce evicted keys during event updates", () => {
      cache.max = 3;
      const event = createEvent("event", 1, "pubkey", [["t", "topic"]]);
      cache.setKindIndex(1, []);
      cache.setPubkeyIndex("pubkey", []);
      cache.setTagIndex("ttopic", []);
      cache.setKindIndex(2, []);
      cache.setPubkeyIndex("other", []);
      expect(cache.kinds.has(1)).toBe(false);
      expect(cache.pubkeys.has("pubkey")).toBe(false);
      cache.addEventToIndexes(event);
      expect(cache.tags.get("ttopic")?.has("event")).toBe(true);
      expect(cache.lastUsed.at(-1)).toBe(cache.tags.get("ttopic"));
      cache.removeEvent(event);
      expect(cache.tags.get("ttopic")?.has("event")).toBe(false);
      expect(cache.kinds.has(1)).toBe(false);
      expect(cache.pubkeys.has("pubkey")).toBe(false);
      expect(cache.count).toBe(3);
      expect(cache.lastUsed).toHaveLength(3);
      cache.setKindIndex(3, []);
      expect(cache.kinds.has(2)).toBe(false);
      expect(cache.tags.has("ttopic")).toBe(true);
    });

    it("supports shrinking capacity to zero and reuse after clearing", () => {
      cache.setKindIndex(1, []);
      cache.setPubkeyIndex("pubkey", []);
      cache.max = 0;
      cache.pruneIndexes();
      expect(cache.count).toBe(0);
      expect(cache.lastUsed).toEqual([]);
      cache.setTagIndex("tag", []);
      expect(cache.count).toBe(0);
      cache.max = 2;
      cache.setKindIndex(1, []);
      cache.clear();
      cache.setKindIndex(2, []);
      cache.setKindIndex(3, []);
      cache.setKindIndex(4, []);
      expect([...cache.kinds.keys()]).toEqual([3, 4]);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([3, 4]);
    });

    it("accepts assigned LRU order and uses it for eviction", () => {
      cache.max = 3;
      cache.setKindIndex(1, []);
      cache.setPubkeyIndex("pubkey", []);
      cache.setTagIndex("tag", []);
      const reversed = cache.lastUsed.reverse();
      cache.lastUsed = reversed;
      expect(cache.lastUsed).toEqual(reversed);
      cache.setKindIndex(2, []);
      expect(cache.tags.has("tag")).toBe(false);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([
        "pubkey",
        1,
        2,
      ]);
    });

    it("reconciles stale and duplicate assignments without losing omitted live indexes", () => {
      cache.max = 3;
      cache.setKindIndex(1, ["old"]);
      const stale = cache.kinds.get(1)!;
      cache.setKindIndex(1, ["current"]);
      const current = cache.kinds.get(1)!;
      cache.setPubkeyIndex("pubkey", []);
      const pubkey = cache.pubkeys.get("pubkey")!;
      cache.setTagIndex("tag", []);
      cache.lastUsed = [current, stale, pubkey, current];
      expect(cache.lastUsed.map((index) => index.key)).toEqual([
        "tag",
        "pubkey",
        1,
      ]);
      expect(cache.lastUsed).not.toContain(stale);
      expect(cache.count).toBe(3);

      cache.max = 2;
      cache.lastUsed = [];
      expect(cache.tags.has("tag")).toBe(false);
      expect(cache.lastUsed).toEqual([pubkey, current]);
      cache.setTagIndex("new", []);
      expect(cache.pubkeys.has("pubkey")).toBe(false);
      expect(cache.kinds.get(1)).toBe(current);
      expect(cache.count).toBe(2);
    });

    it("exposes an ordered snapshot without allowing array mutation to corrupt LRU", () => {
      cache.max = 2;
      cache.setKindIndex(1, []);
      cache.setKindIndex(2, []);
      const snapshot = cache.lastUsed;
      snapshot.reverse();
      snapshot.pop();
      cache.setKindIndex(3, []);
      expect([...cache.kinds.keys()]).toEqual([2, 3]);
      expect(cache.lastUsed.map((index) => index.key)).toEqual([2, 3]);
    });

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
