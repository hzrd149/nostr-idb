import type { NostrEvent } from "./lib/nostr.js";

/** Sort nostr events by created_at */
export function sortByDate(a: NostrEvent, b: NostrEvent) {
  return b.created_at - a.created_at;
}
