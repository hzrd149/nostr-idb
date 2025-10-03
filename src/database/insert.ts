import { type NostrEvent, validateEvent } from "nostr-tools/pure";
import { isAddressableKind, isReplaceableKind } from "nostr-tools/kinds";
import { getEventTags, getEventUID } from "./common.js";
import type { NostrIDBDatabase } from "./schema.js";

/** Add events to the database */
export async function addEvents(db: NostrIDBDatabase, events: NostrEvent[]) {
  // filter out invalid events
  events = events.filter((event) => validateEvent(event));

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

/** Update the last used timestamp of the given uids */
export async function updateUsed(db: NostrIDBDatabase, uids: Iterable<string>) {
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
