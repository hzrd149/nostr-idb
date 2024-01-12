import { Event } from "nostr-tools";

export function sortByDate(a: Event, b: Event) {
  return b.created_at - a.created_at;
}
