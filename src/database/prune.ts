import { NostrEvent } from "nostr-tools/pure";
import { logger } from "../debug.js";
import { countEvents } from "./query-misc.js";
import { NostrIDBDatabase } from "./schema.js";

const log = logger.extend("prune");

/**
 * Remove a number of events from the database based on when they were last used
 * @param db the database
 * @param maxEvents the max number of events to leave in the db
 */
export async function pruneLastUsed(
  db: NostrIDBDatabase,
  maxEvents: number,
  skip?: (event: NostrEvent) => boolean,
) {
  const count = await countEvents(db);
  if (count <= maxEvents) return;
  const diff = count - maxEvents;

  if (diff <= 0) return;

  log(`Pruning database to ${maxEvents}`);

  const used = (await db.getAll("used")).sort((a, b) => a.date - b.date);

  // Resolve which UIDs to delete before opening write transactions.
  // Opening write transactions and then awaiting unrelated reads inside the
  // loop causes IDB to auto-commit the write transactions prematurely.
  const uidsToDelete: string[] = [];
  let i = diff;
  for (const entry of used) {
    if (i <= 0) break;
    const uid = entry.uid;
    if (skip) {
      const row = await db.get("events", uid);
      if (row && skip(row.event)) continue;
    }
    uidsToDelete.push(uid);
    i--;
  }

  if (uidsToDelete.length === 0) return;

  const eventsTransaction = db.transaction("events", "readwrite");
  const usedTransaction = db.transaction("used", "readwrite");

  const promises: Promise<void>[] = [];
  for (const uid of uidsToDelete) {
    promises.push(eventsTransaction.store.delete(uid));
    promises.push(usedTransaction.store.delete(uid));
  }

  eventsTransaction.commit();
  usedTransaction.commit();
  await Promise.all(promises);
  log(`Removed ${uidsToDelete.length} old events`);
}
