import { type Event } from "nostr-tools";

import { isAddressableKind, isReplaceableKind } from "nostr-tools/kinds";
import { GENERIC_TAGS } from "./common.js";
import type { NostrIDB } from "./schema.js";

export const EventUIDSymbol = Symbol.for("event-uid");

/** Returns an events tags as an array of string for indexing */
export function getEventTags(event: Event) {
  return event.tags
    .filter(
      (t) => t.length >= 2 && t[0].length === 1 && GENERIC_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}

/** Returns the events Unique ID */
export function getEventUID(event: Event) {
  if (event[EventUIDSymbol]) return event[EventUIDSymbol];

  if (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) {
    const d = event.tags.find((t) => t[0] === "d")?.[1];
    return (event[EventUIDSymbol] =
      "" + event.kind + ":" + event.pubkey + ":" + (d ?? ""));
  } else return (event[EventUIDSymbol] = event.id);
}

/** Inserts an array of events into the database */
export async function addEvents(db: NostrIDB, events: Event[]) {
  const replaceableEvents = events.filter(
    (e) => isReplaceableKind(e.kind) || isAddressableKind(e.kind),
  );
  const existingEvents: Record<string, number> = {};
  if (replaceableEvents.length > 0) {
    const readTransaction = db.transaction("events", "readonly");
    const promises = replaceableEvents.map((e) => {
      const uid = getEventUID(e);
      readTransaction.store
        .get(uid)
        .then((r) => r && (existingEvents[uid] = r.event.created_at));
    });
    readTransaction.commit();
    await Promise.all(promises);
  }

  const writeTransaction = db.transaction("events", "readwrite");
  for (const event of events) {
    const uid = getEventUID(event);

    // if the event is replaceable, only write it if its newer
    if (!existingEvents[uid] || event.created_at > existingEvents[uid]) {
      writeTransaction.objectStore("events").put(
        {
          event,
          tags: getEventTags(event),
        },
        uid,
      );
    }
  }

  await writeTransaction.commit();
}

/** Sets the last used date on a list of events */
export async function updateUsed(db: NostrIDB, uids: Iterable<string>) {
  const trans = db.transaction("used", "readwrite");
  const nowUnix = Math.floor(new Date().valueOf() / 1000);

  for (const uid of uids) {
    trans.objectStore("used").put({
      uid,
      date: nowUnix,
    });
  }

  await trans.commit();
}
