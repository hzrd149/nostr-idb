import { unwrap } from "idb";
import {
  type StoredEvent,
  validateEvent,
  isAddressableKind,
  isReplaceableKind,
} from "../lib/nostr.js";
import { getEventTags, getEventUID } from "./common.js";
import type { NostrIDBDatabase } from "./schema.js";

/** Add events to the database */
export async function addEvents<TEvent extends StoredEvent>(
  db: NostrIDBDatabase,
  events: TEvent[],
) {
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
      return readTransaction.store
        .get(uid)
        .then((r) => r && (existingEvents[uid] = r.event.created_at));
    });
    readTransaction.commit();
    await Promise.all(promises);
  }

  const writeTransaction = db.transaction("events", "readwrite");
  // Native requests avoid allocating an unused Promise for every write.
  // Request errors abort the transaction and reject its done Promise.
  const store = unwrap(writeTransaction.objectStore("events"));
  for (const event of events) {
    const uid = getEventUID(event);

    // if the event is replaceable, only write it if its newer
    if (!existingEvents[uid] || event.created_at > existingEvents[uid]) {
      store.put(
        {
          event,
          tags: getEventTags(event),
        },
        uid,
      );
    }
  }

  writeTransaction.commit();
  await writeTransaction.done;
}

/** Update the last used timestamp of the given uids */
export async function updateUsed(db: NostrIDBDatabase, uids: Iterable<string>) {
  const trans = db.transaction("used", "readwrite");
  const store = unwrap(trans.objectStore("used"));
  const nowUnix = Math.floor(new Date().valueOf() / 1000);

  for (const uid of uids) {
    store.put({
      uid,
      date: nowUnix,
    });
  }

  trans.commit();
  await trans.done;
}
