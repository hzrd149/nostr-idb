// ---------------------------------------------------------------------------
// Core Nostr types (structurally compatible with nostr-tools)
// ---------------------------------------------------------------------------

/**
 * The fields required to construct a Nostr event before signing.
 * Structurally identical to nostr-tools' EventTemplate.
 */
export type EventTemplate = {
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
};

/**
 * A Nostr event as defined by NIP-01.
 * Structurally identical to nostr-tools' NostrEvent so the two are
 * interchangeable at the type level without requiring nostr-tools at runtime.
 */
export interface NostrEvent {
  kind: number;
  tags: string[][];
  content: string;
  created_at: number;
  pubkey: string;
  id: string;
  sig: string;
}

/** A Nostr filter as defined by NIP-01 */
export type Filter = {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  search?: string;
  [key: `#${string}`]: string[] | undefined;
  [key: `&${string}`]: string[] | undefined;
};

/**
 * Validates the structural integrity of a Nostr event (NIP-01 field checks).
 * Mirrors the nostr-tools implementation without importing it.
 */
export function validateEvent(event: NostrEvent): boolean {
  if (typeof event !== "object" || event === null) return false;
  if (typeof event.kind !== "number") return false;
  if (typeof event.content !== "string") return false;
  if (typeof event.created_at !== "number") return false;
  if (typeof event.pubkey !== "string") return false;
  if (!/^[a-f0-9]{64}$/.test(event.pubkey)) return false;
  if (!Array.isArray(event.tags)) return false;
  for (const tag of event.tags) {
    if (!Array.isArray(tag)) return false;
    for (const item of tag) {
      if (typeof item !== "string") return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Kind classification predicates (NIP-01)
// These replace the nostr-tools/kinds imports throughout the codebase.
// ---------------------------------------------------------------------------

/**
 * Returns true for NIP-01 replaceable event kinds:
 * kind 0, kind 3, and the range 10000–19999.
 */
export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
}

/**
 * Returns true for NIP-01 addressable (parameterized replaceable) event kinds:
 * the range 30000–39999.
 */
export function isAddressableKind(kind: number): boolean {
  return kind >= 30000 && kind < 40000;
}

/**
 * Returns true for NIP-01 ephemeral event kinds: the range 20000–29999.
 * Ephemeral events are not persisted to the database.
 */
export function isEphemeralKind(kind: number): boolean {
  return kind >= 20000 && kind < 30000;
}

/**
 * Symbol used to cache the indexable tag set on an event object.
 * Matches the symbol used by applesauce-core so the cache is shared when both
 * libraries process the same event.
 */
export const IndexableTagsSymbol = Symbol.for("indexable-tags");

/**
 * Returns a cached Set of "tagName:value" strings for every single-char tag on
 * the event. Built once per event and stored via a Symbol key so it doesn't
 * appear in enumerable properties.
 * Ported from applesauce-core/src/helpers/filter.ts
 */
export function getIndexableTags(event: NostrEvent): Set<string> {
  let cached = Reflect.get(event, IndexableTagsSymbol) as
    | Set<string>
    | undefined;
  if (!cached) {
    cached = new Set<string>();
    for (const tag of event.tags) {
      if (tag.length >= 2 && tag[0].length === 1) {
        cached.add(tag[0] + ":" + tag[1]);
      }
    }
    Reflect.set(event, IndexableTagsSymbol, cached);
  }
  return cached;
}

/**
 * Matches an event against a single filter, with full NIP-91 AND-tag support.
 * Ported from applesauce-core/src/helpers/filter.ts and adapted to the local
 * Filter type (which uses `&t` for AND and `#t` for OR tag filters).
 */
export function matchFilter(filter: Filter, event: NostrEvent): boolean {
  if (filter.ids && filter.ids.indexOf(event.id) === -1) return false;
  if (filter.kinds && filter.kinds.indexOf(event.kind) === -1) return false;
  if (filter.authors && filter.authors.indexOf(event.pubkey) === -1)
    return false;
  if (filter.since && event.created_at < filter.since) return false;
  if (filter.until && event.created_at > filter.until) return false;

  const tags = getIndexableTags(event);

  // AND tag filters (`&t`) — ALL listed values must be present (NIP-91)
  for (const f in filter) {
    if (f[0] === "&") {
      const tagName = f.slice(1);
      const values = filter[f as `&${string}`];
      if (values && values.length > 0) {
        for (const value of values) {
          if (!tags.has(tagName + ":" + value)) return false;
        }
      }
    }
  }

  // OR tag filters (`#t`) — AT LEAST ONE value must be present
  // Values that also appear in a corresponding `&t` filter are excluded (NIP-91)
  for (const f in filter) {
    if (f[0] === "#") {
      const tagName = f.slice(1);
      const values = filter[f as `#${string}`];
      if (values) {
        const andValues = filter[`&${tagName}` as `&${string}`];
        const filtered = andValues
          ? values.filter((v) => !andValues.includes(v))
          : values;
        if (filtered.length === 0) continue;
        if (!filtered.some((v) => tags.has(tagName + ":" + v))) return false;
      }
    }
  }

  return true;
}

/** Matches an event against a list of filters (OR semantics across filters) */
export function matchFilters(filters: Filter[], event: NostrEvent): boolean {
  for (let i = 0; i < filters.length; i++) {
    if (matchFilter(filters[i], event)) return true;
  }
  return false;
}
