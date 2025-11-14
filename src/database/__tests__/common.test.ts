import { describe, it, expect } from "vitest";
import {
  getEventUID,
  getEventTags,
  INDEXABLE_TAGS,
} from "../common.js";
import type { NostrEvent } from "nostr-tools/pure";

describe("getEventUID", () => {
  it("should return event.id for regular events", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("abc123");
  });

  it("should return kind:pubkey: for replaceable events (kind 0)", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 0, // metadata - replaceable
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("0:pubkey1:");
  });

  it("should return kind:pubkey: for replaceable events (kind 3)", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 3, // contacts - replaceable
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("3:pubkey1:");
  });

  it("should include d tag for addressable events (kind 30000)", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 30000, // addressable
      tags: [["d", "my-identifier"]],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("30000:pubkey1:my-identifier");
  });

  it("should use empty string for d tag if not present in addressable events", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 30001, // addressable
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("30001:pubkey1:");
  });

  it("should cache the UID on the event object", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const uid1 = getEventUID(event);
    const uid2 = getEventUID(event);

    expect(uid1).toBe(uid2);
    expect(uid1).toBe("abc123");
  });

  it("should handle parameterized replaceable events (kind 30023)", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 30023, // long-form content
      tags: [["d", "my-article"]],
      content: "test",
      sig: "sig1",
    };

    const uid = getEventUID(event);
    expect(uid).toBe("30023:pubkey1:my-article");
  });
});

describe("getEventTags", () => {
  it("should return empty array for events with no tags", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toEqual([]);
  });

  it("should extract single-letter tags with values", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [
        ["e", "event-id-1"],
        ["p", "pubkey-1"],
      ],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toContain("eevent-id-1");
    expect(tags).toContain("ppubkey-1");
    expect(tags).toHaveLength(2);
  });

  it("should ignore tags with multi-character names", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [
        ["e", "event-id-1"],
        ["relay", "wss://relay.example.com"],
        ["p", "pubkey-1"],
      ],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toContain("eevent-id-1");
    expect(tags).toContain("ppubkey-1");
    expect(tags).not.toContain("relaywss://relay.example.com");
    expect(tags).toHaveLength(2);
  });

  it("should ignore tags with no value", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [["e"], ["p", "pubkey-1"]],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toContain("ppubkey-1");
    expect(tags).toHaveLength(1);
  });

  it("should only include tags in INDEXABLE_TAGS", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [
        ["a", "value-a"],
        ["z", "value-z"],
        ["A", "value-A"],
        ["Z", "value-Z"],
      ],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toContain("avalue-a");
    expect(tags).toContain("zvalue-z");
    expect(tags).toContain("Avalue-A");
    expect(tags).toContain("Zvalue-Z");
    expect(tags).toHaveLength(4);
  });

  it("should handle multiple tags with same tag name", () => {
    const event: NostrEvent = {
      id: "abc123",
      pubkey: "pubkey1",
      created_at: 1234567890,
      kind: 1,
      tags: [
        ["e", "event-id-1"],
        ["e", "event-id-2"],
        ["e", "event-id-3"],
      ],
      content: "test",
      sig: "sig1",
    };

    const tags = getEventTags(event);
    expect(tags).toContain("eevent-id-1");
    expect(tags).toContain("eevent-id-2");
    expect(tags).toContain("eevent-id-3");
    expect(tags).toHaveLength(3);
  });
});

describe("INDEXABLE_TAGS", () => {
  it("should contain all lowercase letters", () => {
    const lowercase = "abcdefghijklmnopqrstuvwxyz".split("");
    lowercase.forEach((letter) => {
      expect(INDEXABLE_TAGS).toContain(letter);
    });
  });

  it("should contain all uppercase letters", () => {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    uppercase.forEach((letter) => {
      expect(INDEXABLE_TAGS).toContain(letter);
    });
  });

  it("should have exactly 52 tags (26 lowercase + 26 uppercase)", () => {
    expect(INDEXABLE_TAGS).toHaveLength(52);
  });
});
