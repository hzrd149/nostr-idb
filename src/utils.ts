import { type Filter, matchFilter } from "./lib/nostr.js";
import type { StoredEvent } from "./lib/nostr.js";

/** Sort nostr events by created_at */
export function sortByDate(a: StoredEvent, b: StoredEvent) {
  return b.created_at - a.created_at;
}

/** Apply each filter's limit before combining matching events in date order. */
export function selectEventsForFilters<TEvent extends StoredEvent>(
  events: TEvent[],
  filters: Filter[],
): TEvent[] {
  const sorted = [...events].sort(sortByDate);
  const selected = new Map<string, TEvent>();
  for (const filter of filters) {
    if (filter.search) continue;
    let count = 0;
    for (const event of sorted) {
      if (filter.limit !== undefined && count >= filter.limit) break;
      if (!matchFilter(filter, event)) continue;
      selected.set(event.id, event);
      count++;
    }
  }
  return [...selected.values()].sort(sortByDate);
}
