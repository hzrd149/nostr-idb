import type { StoredEvent } from "../lib/nostr.js";
import { addEvents, updateUsed, getEventUID } from "../database/index.js";
import { NostrIDBDatabase } from "../database/schema.js";
import { logger } from "../debug.js";
import type { Filter } from "../lib/nostr.js";
import { matchFilters } from "../lib/nostr.js";

const log = logger.extend("WriteQueue");

/** A queue of events to be written to the database */
export class WriteQueue<TEvent extends StoredEvent = StoredEvent> {
  db: NostrIDBDatabase;
  private queuedIds = new Set<string>();
  private eventQueue: TEvent[] = [];
  private eventQueueHead = 0;
  private lastUsedQueue = new Set<string>();

  /** Called for each chunk of events before they are written to the database */
  processEvents: ((events: TEvent[]) => Promise<TEvent[] | void>) | null = null;

  constructor(db: NostrIDBDatabase) {
    this.db = db;
  }

  addEvent(event: TEvent) {
    const uid = getEventUID(event);
    if (this.queuedIds.has(uid)) return;
    this.eventQueue.push(event);
    this.queuedIds.add(uid);
    this.touch(event);
  }
  addEvents(events: TEvent[]) {
    const start = this.eventQueue.length;
    for (const event of events) {
      const uid = getEventUID(event);
      if (this.queuedIds.has(uid)) continue;
      this.eventQueue.push(event);
      this.lastUsedQueue.add(uid);
    }
    // Publish IDs after filtering to preserve duplicates within a single call.
    for (let i = start; i < this.eventQueue.length; i++) {
      this.queuedIds.add(getEventUID(this.eventQueue[i]));
    }
  }

  touch(event: TEvent | TEvent[]) {
    if (Array.isArray(event)) {
      for (const e of event) this.lastUsedQueue.add(getEventUID(e));
    } else {
      this.lastUsedQueue.add(getEventUID(event));
    }
  }

  matchPending(filters: Filter[]) {
    const matches: TEvent[] = [];
    for (let i = this.eventQueueHead; i < this.eventQueue.length; i++) {
      const event = this.eventQueue[i];
      if (matchFilters(filters, event)) matches.push(event);
    }
    return matches;
  }

  /** Write all events in the queue to the database */
  async flush(count = 1000) {
    if (this.eventQueueHead < this.eventQueue.length) {
      let events: TEvent[] = [];
      for (
        let i = 0;
        i < count && this.eventQueueHead < this.eventQueue.length;
        i++
      ) {
        const event = this.eventQueue[this.eventQueueHead++];
        events.push(event);
        this.queuedIds.delete(getEventUID(event));
      }
      // Each compaction copies at most as many entries as were consumed.
      // Reset before awaiting the hook so newly queued events stay pending.
      if (this.eventQueueHead === this.eventQueue.length) {
        this.eventQueue = [];
        this.eventQueueHead = 0;
      } else if (this.eventQueueHead >= this.eventQueue.length / 2) {
        this.eventQueue = this.eventQueue.slice(this.eventQueueHead);
        this.eventQueueHead = 0;
      }

      if (this.processEvents) {
        events = (await this.processEvents(events)) || events;
      }

      await addEvents(this.db, events);
      log(`Wrote ${events.length} to database`);
      const remaining = this.eventQueue.length - this.eventQueueHead;
      if (remaining > 0) log(`${remaining} left`);
    }

    if (this.lastUsedQueue.size > 0) {
      await updateUsed(this.db, this.lastUsedQueue);
      this.lastUsedQueue.clear();
    }
  }

  /** Clear the queue */
  clear() {
    this.eventQueue = [];
    this.eventQueueHead = 0;
  }
}
