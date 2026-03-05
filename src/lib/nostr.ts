import type { NostrEvent } from "nostr-tools/pure";
import type { Filter } from "../types.js";

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
