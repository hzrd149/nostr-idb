import type { Event } from "nostr-tools";

export const GENERIC_TAGS = "abcdefghijklmnopqrstuvwxyz".split("");

export function getEventTags(event: Event) {
  return event.tags
    .filter(
      (t) => t.length >= 2 && t[0].length === 1 && GENERIC_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}
