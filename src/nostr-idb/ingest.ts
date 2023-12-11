import { IDBPDatabase, IDBPTransaction } from "idb";
import { Schema } from "./schema";
import { Event, validateEvent } from "nostr-tools";
import { getEventTags } from "./common";

export function createWriteTransaction(db: IDBPDatabase<Schema>) {
  return db.transaction("events", "readwrite");
}

export async function addEvent(
  db: IDBPDatabase<Schema>,
  event: Event,
  transaction?: IDBPTransaction<Schema, ["events"], "readwrite">,
) {
  if (!validateEvent(event)) throw new Error("Invalid Event");
  const nowUnix = Math.floor(new Date().valueOf() / 1000);

  const trans = transaction || createWriteTransaction(db);
  trans.objectStore("events").put({
    event,
    tags: getEventTags(event),
    firstSeen: nowUnix,
    lastUsed: null,
  });

  if (!transaction) await trans.commit();
}
