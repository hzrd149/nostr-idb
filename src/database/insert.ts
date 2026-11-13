import { unwrap } from "idb";
import {
  type StoredEvent,
  validateEvent,
  isAddressableKind,
  isReplaceableKind,
} from "../lib/nostr.js";
import { getEventTags, getEventUID } from "./common.js";
import type { NostrIDBDatabase } from "./schema.js";

/** Add events, optionally replacing sidecars by exact event ID (undefined clears). */
export async function addEvents<TEvent extends StoredEvent>(
  db: NostrIDBDatabase,
  events: TEvent[],
  metadata: ReadonlyMap<string, unknown> = new Map(),
) {
  // filter out invalid events
  events = events.filter((event) => validateEvent(event));

  const snapshots = new Map(
    Array.from(metadata, ([id, value]) => [id, structuredClone(value)]),
  );
  const groups = new Map<string, TEvent[]>();
  for (const event of events) {
    const uid = getEventUID(event);
    const group = groups.get(uid);
    if (group) group.push(event);
    else groups.set(uid, [event]);
  }
  const writeTransaction = db.transaction("events", "readwrite");
  // Native requests avoid allocating an unused Promise for every write.
  // Request errors abort the transaction and reject its done Promise.
  const store = unwrap(writeTransaction.objectStore("events"));
  const writes = Array.from(groups, async ([uid, group]) => {
    let row = await writeTransaction.store.get(uid);
    let changed = false;
    for (const event of group) {
      const sameEvent = row?.event.id === event.id;
      if (
        row &&
        !sameEvent &&
        (isReplaceableKind(event.kind) || isAddressableKind(event.kind)) &&
        event.created_at <= row.event.created_at
      )
        continue;
      const sidecar = snapshots.has(event.id)
        ? snapshots.get(event.id)
        : sameEvent
          ? row?.metadata
          : undefined;
      row = { event, tags: getEventTags(event) };
      if (sidecar !== undefined) row.metadata = sidecar;
      changed = true;
    }
    if (changed) store.put(row!, uid);
  });
  const queued = Promise.all(writes).then(() => writeTransaction.commit());
  await Promise.all([queued, writeTransaction.done]);
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
