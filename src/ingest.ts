import { IDBPTransaction } from "idb";
import { Event, validateEvent } from "nostr-tools";

import type { NostrIDB, Schema } from "./schema.js";
import { GENERIC_TAGS } from "./common.js";

export function createWriteTransaction(db: NostrIDB) {
  return db.transaction("events", "readwrite");
}

export function getEventTags(event: Event) {
  return event.tags
    .filter(
      (t) => t.length >= 2 && t[0].length === 1 && GENERIC_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}

export async function addEvent(
  db: NostrIDB,
  event: Event,
  transaction?: IDBPTransaction<Schema, ["events"], "readwrite">,
) {
  if (!validateEvent(event)) throw new Error("Invalid Event");
  const trans = transaction || createWriteTransaction(db);
  trans.objectStore("events").put({
    event,
    tags: getEventTags(event),
  });

  if (!transaction) await trans.commit();
}

export async function addEvents(db: NostrIDB, events: Event[]) {
  const trans = db.transaction("events", "readwrite");

  for (const event of events) {
    await addEvent(db, event, trans);
  }

  await trans.commit();
}

export async function updateUsed(db: NostrIDB, ids: string[]) {
  const trans = db.transaction("used", "readwrite");
  const nowUnix = Math.floor(new Date().valueOf() / 1000);

  for (const id of ids) {
    trans.objectStore("used").put({
      id,
      date: nowUnix,
    });
  }

  await trans.commit();
}
