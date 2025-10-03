import type { NostrEvent } from "nostr-tools/pure";

/** Sort nostr events by created_at */
export function sortByDate(a: NostrEvent, b: NostrEvent) {
  return b.created_at - a.created_at;
}
