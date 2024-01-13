import { IDBPTransaction } from "idb";
import { Event, validateEvent } from "nostr-tools";

import type { NostrIDB, Schema } from "./schema.js";
import { GENERIC_TAGS } from "./common.js";

/**
 * Returns an events tags as an array of string for indexing
 */
export function getEventTags(event: Event) {
  return event.tags
    .filter(
      (t) => t.length >= 2 && t[0].length === 1 && GENERIC_TAGS.includes(t[0]),
    )
    .map((t) => t[0] + t[1]);
}

// based on replaceable kinds from https://github.com/nostr-protocol/nips/blob/master/01.md#kinds
export function isReplaceable(kind: number) {
  return (
    (kind >= 30000 && kind < 40000) ||
    (kind >= 10000 && kind < 20000) ||
    kind === 0 ||
    kind === 3 ||
    kind === 41
  );
}

export function getReplaceableId(event: Event) {
  if (!isReplaceable(event.kind)) return undefined;

  const d = event.tags.find((t) => t[0] === "d")?.[1];
  return `${event.kind}:${event.pubkey}:${d ?? ""}`;
}

export type ReplaceableEventAddress = {
  kind: number;
  pubkey: string;
  // identifier is optional because k10000 events and k0, k3
  identifier?: string;
};

export async function addEvent(
  db: NostrIDB,
  event: Event,
  transaction?: IDBPTransaction<Schema, ["events"], "readwrite">,
) {
  if (!validateEvent(event)) throw new Error("Invalid Event");
  const trans = transaction || db.transaction("events", "readwrite");
  trans.objectStore("events").put({
    event,
    tags: getEventTags(event),
    replaceableId: getReplaceableId(event),
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
