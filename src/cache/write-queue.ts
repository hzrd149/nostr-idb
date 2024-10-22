import { matchFilters, type Filter, type NostrEvent } from "nostr-tools";
import { addEvents, getEventUID, updateUsed } from "../database/ingest.js";
import { NostrIDB } from "../database/schema.js";
import { logger } from "../debug.js";

const log = logger.extend("writeQueue");

export class WriteQueue {
  db: NostrIDB;
  private queuedIds = new Set<string>();
  private eventQueue: NostrEvent[] = [];
  private lastUsedQueue = new Set<string>();

  /** Called for each chunk of events before they are written to the database */
  processEvents:
    | ((events: NostrEvent[]) => Promise<NostrEvent[] | void>)
    | null = null;

  constructor(db: NostrIDB) {
    this.db = db;
  }

  addEvent(event: NostrEvent) {
    if (this.queuedIds.has(event.id)) return;
    this.eventQueue.push(event);
    this.queuedIds.add(event.id);
    this.useEvent(event);
  }
  addEvents(events: NostrEvent[]) {
    const arr = events.filter((e) => !this.queuedIds.has(e.id));
    if (arr.length === 0) return;
    this.eventQueue.push(...arr);
    this.useEvents(arr);
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

  clear() {
    this.eventQueue = [];
  }
}
