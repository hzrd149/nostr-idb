import type { NostrEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { isAddressableKind, isReplaceableKind } from "nostr-tools/kinds";
import { IndexCache } from "../cache/index-cache.js";
import { getIdsForFilter, getIdsForFilters } from "./query-filter.js";
import type { NostrIDBDatabase } from "./schema.js";

/**
 * Delete a single event by its ID or UID
 * @param db - The database instance
 * @param eventId - The event ID or UID to delete
 * @param indexCache - Optional index cache to update
 * @returns Promise<boolean> - True if event was deleted, false if not found
 */
export async function deleteEvent(
  db: NostrIDBDatabase,
  eventId: string,
  indexCache?: IndexCache,
): Promise<boolean> {
  const transaction = db.transaction("events", "readwrite");
  const objectStore = transaction.objectStore("events");

  // First check if the event exists
  const existingEvent = await objectStore.get(eventId);
  if (!existingEvent) {
    await transaction.commit();
    return false;
  }

  // Delete the event
  await objectStore.delete(eventId);
  await transaction.commit();

  // Update index cache if provided
  if (indexCache) {
    const event = existingEvent.event;
    indexCache.removeEvent(event);
  }

  return true;
}

/**
 * Delete a replaceable event by pubkey and kind
 * @param db - The database instance
 * @param pubkey - The pubkey of the event author
 * @param kind - The kind of the replaceable event
 * @param identifier - Optional identifier for parameterized replaceable events
 * @param indexCache - Optional index cache to update
 * @returns Promise<boolean> - True if event was deleted, false if not found
 */
export async function deleteReplaceable(
  db: NostrIDBDatabase,
  pubkey: string,
  kind: number,
  identifier?: string,
  indexCache?: IndexCache,
): Promise<boolean> {
  if (!isReplaceableKind(kind) && !isAddressableKind(kind)) {
    throw new Error(`Kind ${kind} is not replaceable`);
  }

  const uid = `${kind}:${pubkey}:${identifier ?? ""}`;
  return await deleteEvent(db, uid, indexCache);
}

/**
 * Delete all replaceable events for a given pubkey and kind
 * @param db - The database instance
 * @param pubkey - The pubkey of the event author
 * @param kind - The kind of the replaceable events
 * @param indexCache - Optional index cache to update
 * @returns Promise<number> - Number of events deleted
 */
export async function deleteAllReplaceable(
  db: NostrIDBDatabase,
  pubkey: string,
  kind: number,
  indexCache?: IndexCache,
): Promise<number> {
  if (!isReplaceableKind(kind) && !isAddressableKind(kind)) {
    throw new Error(`Kind ${kind} is not replaceable`);
  }

  const transaction = db.transaction("events", "readwrite");
  const objectStore = transaction.objectStore("events");

  // Get all events for this pubkey and kind
  const pubkeyIndex = objectStore.index("pubkey");
  const kindIndex = objectStore.index("kind");

  const pubkeyEvents = await pubkeyIndex.getAllKeys(pubkey);
  const kindEvents = await kindIndex.getAllKeys(kind);

  // Find intersection of pubkey and kind events
  const matchingEvents = pubkeyEvents.filter((id) => kindEvents.includes(id));

  let deletedCount = 0;
  const eventsToDelete: { event: NostrEvent; uid: string }[] = [];

  // Collect events to delete and their data for cache update
  for (const uid of matchingEvents) {
    const eventData = await objectStore.get(uid);
    if (eventData) {
      eventsToDelete.push({ event: eventData.event, uid });
      await objectStore.delete(uid);
      deletedCount++;
    }
  }

  await transaction.commit();

  // Update index cache if provided
  if (indexCache && eventsToDelete.length > 0) {
    for (const { event } of eventsToDelete) {
      indexCache.removeEvent(event);
    }
  }

  return deletedCount;
}

/**
 * Delete events matching the given filter
 * @param db - The database instance
 * @param filter - The filter to match events for deletion
 * @param indexCache - Optional index cache to update
 * @returns Promise<number> - Number of events deleted
 */
export async function deleteByFilter(
  db: NostrIDBDatabase,
  filter: Filter,
  indexCache?: IndexCache,
): Promise<number> {
  const eventIds = await getIdsForFilter(db, filter, indexCache);
  return await deleteEventsByIds(db, Array.from(eventIds), indexCache);
}

/**
 * Delete events matching the given filters
 * @param db - The database instance
 * @param filters - Array of filters to match events for deletion
 * @param indexCache - Optional index cache to update
 * @returns Promise<number> - Number of events deleted
 */
export async function deleteByFilters(
  db: NostrIDBDatabase,
  filters: Filter[],
  indexCache?: IndexCache,
): Promise<number> {
  const eventIds = await getIdsForFilters(db, filters, indexCache);
  return await deleteEventsByIds(db, Array.from(eventIds), indexCache);
}

/**
 * Delete events by their IDs
 * @param db - The database instance
 * @param eventIds - Array of event IDs to delete
 * @param indexCache - Optional index cache to update
 * @returns Promise<number> - Number of events deleted
 */
export async function deleteEventsByIds(
  db: NostrIDBDatabase,
  eventIds: string[],
  indexCache?: IndexCache,
): Promise<number> {
  if (eventIds.length === 0) return 0;

  const transaction = db.transaction("events", "readwrite");
  const objectStore = transaction.objectStore("events");

  let deletedCount = 0;
  const eventsToDelete: NostrEvent[] = [];

  // Collect events to delete and their data for cache update
  for (const eventId of eventIds) {
    const eventData = await objectStore.get(eventId);
    if (eventData) {
      eventsToDelete.push(eventData.event);
      await objectStore.delete(eventId);
      deletedCount++;
    }
  }

  await transaction.commit();

  // Update index cache if provided
  if (indexCache && eventsToDelete.length > 0) {
    for (const event of eventsToDelete) {
      indexCache.removeEvent(event);
    }
  }

  return deletedCount;
}

/**
 * Delete all events from the database
 * @param db - The database instance
 * @param indexCache - Optional index cache to clear
 * @returns Promise<void>
 */
export async function deleteAllEvents(
  db: NostrIDBDatabase,
  indexCache?: IndexCache,
): Promise<void> {
  const transaction = db.transaction("events", "readwrite");
  await transaction.objectStore("events").clear();
  await transaction.commit();

  // Clear index cache if provided
  if (indexCache) {
    indexCache.clear();
  }
}
