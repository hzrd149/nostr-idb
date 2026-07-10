import type { StoredEvent } from "./lib/nostr.js";

/** Sort nostr events by created_at */
export function sortByDate(a: StoredEvent, b: StoredEvent) {
  return b.created_at - a.created_at;
}
