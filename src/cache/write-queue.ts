import type { NostrEvent } from "nostr-tools/pure";
import { matchFilters, type Filter } from "nostr-tools/filter";
import { addEvents, updateUsed, getEventUID } from "../database/index.js";
import { NostrIDBDatabase } from "../database/schema.js";
import { logger } from "../debug.js";

const log = logger.extend("WriteQueue");

/** A queue of events to be written to the database */
export class WriteQueue {
  db: NostrIDBDatabase;
  private queuedIds = new Set<string>();
  private eventQueue: NostrEvent[] = [];
  private lastUsedQueue = new Set<string>();

  /** Called for each chunk of events before they are written to the database */
  processEvents:
    | ((events: NostrEvent[]) => Promise<NostrEvent[] | void>)
    | null = null;

  constructor(db: NostrIDBDatabase) {
    this.db = db;
  }

  addEvent(event: NostrEvent) {
    if (this.queuedIds.has(event.id)) return;
    this.eventQueue.push(event);
    this.queuedIds.add(event.id);
    this.touch(event);
  }
  addEvents(events: NostrEvent[]) {
    const arr = events.filter((e) => !this.queuedIds.has(e.id));
    if (arr.length === 0) return;
    this.eventQueue.push(...arr);
    this.touch(arr);
  }

  touch(event: NostrEvent | NostrEvent[]) {
    if (Array.isArray(event)) {
      for (const e of event) this.lastUsedQueue.add(getEventUID(e));
    } else {
      this.lastUsedQueue.add(getEventUID(event));
    }
  }

  matchPending(filters: Filter[]) {
    return this.eventQueue.filter((e) => matchFilters(filters, e));
  }

  /** Write all events in the queue to the database */
  async flush(count = 1000) {
    if (this.eventQueue.length > 0) {
      let events: NostrEvent[] = [];
      for (let i = 0; i < count; i++) {
        const event = this.eventQueue.shift();
        if (!event) break;
        events.push(event);
        this.queuedIds.delete(event.id);
      }

      if (this.processEvents) {
        events = (await this.processEvents(events)) || events;
      }

      await addEvents(this.db, events);
      log(`Wrote ${events.length} to database`);
      if (this.eventQueue.length > 0) log(`${this.eventQueue.length} left`);
    }

    if (this.lastUsedQueue.size > 0) {
      await updateUsed(this.db, this.lastUsedQueue);
      this.lastUsedQueue.clear();
    }
  }

  /** Clear the queue */
  clear() {
    this.eventQueue = [];
  }
}
