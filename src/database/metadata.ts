import type { StoredEvent } from "../lib/nostr.js";
import type { NostrIDBDatabase, Schema } from "./schema.js";

/** Converts a stored row to an event, optionally restoring its sidecar. */
export type EventReader<TEvent extends StoredEvent = StoredEvent> = (
  row: Schema["events"]["value"],
) => TEvent;

/** Replace or clear metadata for an exact event ID; never creates an event. */
export async function setEventMetadata(
  db: NostrIDBDatabase,
  eventId: string,
  metadata: unknown,
): Promise<boolean> {
  const snapshot = structuredClone(metadata);
  const tx = db.transaction("events", "readwrite");
  const cursor = await tx.store.index("id").openCursor(eventId);
  if (cursor) {
    const row = cursor.value;
    if (snapshot === undefined) delete row.metadata;
    else row.metadata = snapshot;
    await cursor.update(row);
  }
  await tx.done;
  return !!cursor;
}
