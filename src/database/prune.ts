import { logger } from "../debug.js";
import { countEvents } from "./query-misc.js";
import { NostrIDB } from "./schema.js";

const log = logger.extend("prune");

/**
 * Prunes the database down based on when the event was last used
 * @param db the database
 * @param maxEvents the max number of events to leave in the db
 */
export async function pruneLastUsed(
  db: NostrIDB,
  maxEvents: number,
  // skip?: (event: NostrEvent) => boolean,
) {
  const count = await countEvents(db);
  if (count <= maxEvents) return;
  const diff = count - maxEvents;

  if (diff <= 0) return;

  log(`Pruning database to ${maxEvents}`);

  const used = await db.getAll("used");
  const eventsTransaction = db.transaction("events", "readwrite");
  const usedTransaction = db.transaction("used", "readwrite");
  const sorted = used.sort((a, b) => b.date - a.date);

  const promises: Promise<void>[] = [];
  let i = diff;
  while (i > 0) {
    const entry = sorted.shift();
    if (!entry) break;
    const uid = entry.uid;
    // if(skip){
    // 	const row = await db.get('events', uid)
    // 	if(row && skip(row.event)) continue
    // }
    promises.push(eventsTransaction.store.delete(uid));
    promises.push(usedTransaction.store.delete(uid));
    i--;
  }

  eventsTransaction.commit();
  usedTransaction.commit();
  await Promise.all(promises);
  log(`Removed ${diff} old events`);
}
