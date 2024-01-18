import { matchFilters, type Filter, type NostrEvent } from "nostr-tools";
import { addEvents, getEventUID, updateUsed } from "../database/ingest.js";
import { NostrIDB } from "../database/schema.js";
import { logger } from "../debug.js";

const log = logger.extend("cache:write");

export class WriteQueue {
  db: NostrIDB;
  private eventQueue: NostrEvent[] = [];
  private lastUsedQueue = new Set<string>();

  constructor(db: NostrIDB) {
    this.db = db;
  }

  addEvent(event: NostrEvent) {
    this.eventQueue.push(event);
    this.useEvent(event);
  }
  addEvents(events: NostrEvent[]) {
    this.eventQueue.push(...events);
    this.useEvents(events);
  }

  useEvent(event: NostrEvent) {
    this.lastUsedQueue.add(getEventUID(event));
  }
  useEvents(events: NostrEvent[]) {
    for (const event of events) this.lastUsedQueue.add(getEventUID(event));
  }

  matchPending(filters: Filter[]) {
    return this.eventQueue.filter((e) => matchFilters(filters, e));
  }

  async flush(count = 1000) {
    if (this.eventQueue.length > 0) {
      const events: NostrEvent[] = [];
      for (let i = 0; i < count; i++) {
        const event = this.eventQueue.shift();
        if (!event) break;
        events.push(event);
      }
      await addEvents(this.db, events);
      log(
        `Wrote ${events.length} to database, ${this.eventQueue.length} events left`,
      );
    }

    if (this.lastUsedQueue.size > 0) {
      await updateUsed(this.db, this.lastUsedQueue);
      this.lastUsedQueue.clear();
    }
  }

  clear() {
    this.eventQueue = [];
  }
}
