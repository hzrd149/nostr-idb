import { countEvents } from "./query-misc";
import { NostrIDB } from "./schema";

export async function pruneDatabaseToSize(
  db: NostrIDB,
  limit: number,
  // skip?: (event: NostrEvent) => boolean,
) {
  const count = await countEvents(db);
  if (count <= limit) return;
  let diff = count - limit;

  const used = await db.getAll("used");
  const eventsTransaction = db.transaction("events", "readwrite");
  const usedTransaction = db.transaction("used", "readwrite");
  const sorted = used.sort((a, b) => b.date - a.date);

  const promises: Promise<void>[] = [];
  while (diff > 0) {
    const entry = sorted.shift();
    if (!entry) break;
    const uid = entry.uid;
    // if(skip){
    // 	const row = await db.get('events', uid)
    // 	if(row && skip(row.event)) continue
    // }
    promises.push(eventsTransaction.store.delete(uid));
    promises.push(usedTransaction.store.delete(uid));
    diff--;
  }

  eventsTransaction.commit();
  usedTransaction.commit();
  await Promise.all(promises);
}
