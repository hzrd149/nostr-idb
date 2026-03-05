import type { NostrEvent } from "nostr-tools/pure";
import { matchFilters } from "nostr-tools/filter";
import { addEvents, updateUsed, getEventUID } from "../database/index.js";
import { INDEXABLE_TAGS } from "../database/common.js";
import { NostrIDBDatabase } from "../database/schema.js";
import { logger } from "../debug.js";
import type { Filter } from "../types.js";

const log = logger.extend("WriteQueue");

/** Match a single event against filters with NIP-91 support */
function matchFiltersWithNIP91(filters: Filter[], event: NostrEvent): boolean {
  // First try standard matchFilters (for backward compatibility)
  // If it returns true, we still need to check NIP-91 &t filters
  const standardMatch = matchFilters(filters, event);
  
  // Check if any filter has &t keys (NIP-91)
  const hasNIP91Filters = filters.some((filter) => {
    for (const t of INDEXABLE_TAGS) {
      const andKey = `&${t}` as `&${string}`;
      if (filter[andKey]) return true;
    }
    return false;
  });
  
  if (!hasNIP91Filters) {
    // No NIP-91 filters, use standard matching
    return standardMatch;
  }
  
  // We have NIP-91 filters, need custom matching
  // Check each filter individually
  for (const filter of filters) {
    if (matchFilterWithNIP91(filter, event)) {
      return true;
    }
  }
  
  return false;
}

/** Match a single event against a single filter with NIP-91 support */
function matchFilterWithNIP91(filter: Filter, event: NostrEvent): boolean {
  // Create a modified filter for standard matching:
  // - Remove &t keys (they'll be checked separately)
  // - Filter #t values to exclude those in &t
  const modifiedFilter: Filter = { ...filter };
  
  // Remove &t keys and prepare filtered #t values
  for (const t of INDEXABLE_TAGS) {
    const andKey = `&${t}` as `&${string}`;
    const andValues = filter[andKey];
    
    if (andValues?.length) {
      // Remove &t key from modified filter
      delete modifiedFilter[andKey];
      
      // Filter #t values to exclude those in &t
      const orKey = `#${t}` as `#${string}`;
      const orValues = filter[orKey];
      if (orValues?.length) {
        const filteredOrValues = orValues.filter((v: string) => !andValues.includes(v));
        if (filteredOrValues.length > 0) {
          modifiedFilter[orKey] = filteredOrValues;
        } else {
          delete modifiedFilter[orKey];
        }
      }
    }
  }
  
  // Check standard filters (without &t, with filtered #t)
  if (!matchFilters([modifiedFilter], event)) {
    return false;
  }
  
  // Now check NIP-91 &t filters (AND logic)
  for (const t of INDEXABLE_TAGS) {
    const andKey = `&${t}` as `&${string}`;
    const andValues = filter[andKey];
    
    if (andValues?.length) {
      // Get all tag values for this tag from the event
      const eventTagValues = event.tags
        .filter((tag) => tag.length >= 2 && tag[0] === t)
        .map((tag) => tag[1]);
      
      // Check if event has ALL required values (AND logic)
      for (const requiredValue of andValues) {
        if (!eventTagValues.includes(requiredValue)) {
          return false;
        }
      }
    }
  }
  
  return true;
}

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
    return this.eventQueue.filter((e) => matchFiltersWithNIP91(filters, e));
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
