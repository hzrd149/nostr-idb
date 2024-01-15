import { IDBPTransaction } from "idb";
import { Event, kinds, validateEvent } from "nostr-tools";

import type { NostrIDB, Schema } from "./schema.js";
import { GENERIC_TAGS } from "./common.js";

/** Returns an events tags as an array of string for indexing */
export function getEventTags(event: Event) {
  return event.tags
    .filter(
      (t) => t.length >= 2 && t[0].length === 1 && GENERIC_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}

/** returns the events Unique ID */
export function getEventUID(event: Event) {
  if (
    kinds.isReplaceableKind(event.kind) ||
    kinds.isParameterizedReplaceableKind(event.kind)
  ) {
    const d = event.tags.find((t) => t[0] === "d")?.[1];
    return d
      ? `${event.kind}:${event.pubkey}:${d}`
      : `${event.kind}:${event.pubkey}`;
  }
  return event.id;
}

export async function addEvent(
  db: NostrIDB,
  event: Event,
  transaction?: IDBPTransaction<Schema, ["events"], "readwrite">,
) {
  if (!validateEvent(event)) throw new Error("Invalid Event");
  const trans = transaction || db.transaction("events", "readwrite");
  trans.objectStore("events").put(
    {
      event,
      tags: getEventTags(event),
    },
    getEventUID(event),
  );

  if (!transaction) await trans.commit();
}

export async function addEvents(db: NostrIDB, events: Event[]) {
  const trans = db.transaction("events", "readwrite");

  for (const event of events) {
    await addEvent(db, event, trans);
  }

  await trans.commit();
}

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
