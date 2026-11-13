import { describe, expect, it } from "vitest";
import { getEventUID } from "../../database/common.js";
import type { StoredEvent } from "../../lib/nostr.js";
import { NostrIDB } from "../nostrdb.js";

class CacheHarness extends NostrIDB {
  // Exercise cache maintenance without opening IndexedDB or starting timers.
  override async start() {}

  populate(events: Iterable<StoredEvent>) {
    this.addToEventMaps(events);
  }
}

function event(id: number, kind = 1): StoredEvent {
  return {
    id: String(id),
    pubkey: "author",
    kind,
    created_at: id,
    tags: [],
    content: "",
  };
}

function reference(
  map: Map<string, StoredEvent>,
  events: Iterable<StoredEvent>,
  max: number,
) {
  for (const event of events) {
    const uid = getEventUID(event);
    map.delete(uid);
    map.set(uid, event);
    while (map.size > max) map.delete(map.keys().next().value!);
  }
}

function expectSame(
  actual: Map<string, StoredEvent>,
  expected: Map<string, StoredEvent>,
) {
  expect([...actual.keys()]).toEqual([...expected.keys()]);
  for (const [uid, value] of expected) expect(actual.get(uid)).toBe(value);
}

describe("event-body cache population", () => {
  it.each([false, true])(
    "matches sequential LRU updates across duplicates, replacements and capacity changes (iterable=%s)",
    (iterable) => {
      const cache = new CacheHarness(undefined, { maxMemoryEvents: 7 });
      const map = cache.eventMap;
      const expected = new Map<string, StoredEvent>();
      let seed = 42;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
      };
      for (let round = 0; round < 150; round++) {
        const max = random() % 12;
        cache.options.maxMemoryEvents = max;
        const batch = Array.from({ length: 1 + (random() % 40) }, () =>
          event(random() % 24, random() % 5 === 0 ? 0 : 1),
        );
        reference(expected, batch, max);
        cache.populate(iterable ? batch.values() : batch);
        expect(cache.eventMap).toBe(map);
        expectSame(map, expected);
      }
    },
  );

  it("retains the last replacement object and last-touch order in oversized arrays", () => {
    const cache = new CacheHarness(undefined, { maxMemoryEvents: 3 });
    const old = event(10, 30000);
    const replacement = event(11, 30000);
    const a = event(1);
    const b = event(2);
    const batch = [event(0), old, a, b, replacement, a];
    cache.populate([event(100), event(101)]);
    cache.populate(batch);
    expect([...cache.eventMap.values()]).toEqual([b, replacement, a]);
    expect(cache.eventMap.get(getEventUID(old))).toBe(replacement);
  });

  it("preserves untouched cache entries when a long batch has too few distinct UIDs", () => {
    const cache = new CacheHarness(undefined, { maxMemoryEvents: 3 });
    const a = event(1);
    const b = event(2);
    const replacement = event(4, 0);
    cache.populate([a, b]);
    cache.populate([event(3, 0), replacement, replacement, replacement]);
    expect([...cache.eventMap.values()]).toEqual([a, b, replacement]);
  });

  it("clears existing bodies when caching is disabled", () => {
    const cache = new CacheHarness(undefined, { maxMemoryEvents: 3 });
    cache.populate([event(1), event(2)]);
    cache.options.maxMemoryEvents = 0;
    cache.populate([event(3)]);
    expect(cache.eventMap.size).toBe(0);
  });
});
