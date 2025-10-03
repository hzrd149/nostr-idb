import { type NostrEvent } from "nostr-tools/pure";
import { isAddressableKind, isReplaceableKind } from "nostr-tools/kinds";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** An array of common indexable tags */
export const INDEXABLE_TAGS = (LETTERS + LETTERS.toUpperCase()).split("");

/** Cashing symbol for event UID */
export const EventUIDSymbol = Symbol.for("event-uid");

/** Returns an events tags as an array of string for indexing */
export function getEventTags(event: NostrEvent) {
  return event.tags
    .filter(
      (t) =>
        t.length >= 2 && t[0].length === 1 && INDEXABLE_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}

/** Returns the events Unique ID */
export function getEventUID(event: NostrEvent) {
  if (Reflect.has(event, EventUIDSymbol))
    return Reflect.get(event, EventUIDSymbol);

  if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1];
    return Reflect.set(
      event,
      EventUIDSymbol,
      "" + event.kind + ":" + event.pubkey + ":" + (d ?? ""),
    );
  } else return Reflect.set(event, EventUIDSymbol, event.id);
}
