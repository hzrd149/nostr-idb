import { Event, Filter, NostrEvent, kinds, matchFilters } from "nostr-tools";

import { WriteQueue } from "../cache/write-queue.js";
import { IndexCache } from "../cache/index-cache.js";
import { NostrIDB } from "../database/schema.js";
import {
  getEventsForFilters,
  countEventsForFilters,
} from "../database/query-filter.js";
import { sortByDate } from "../utils.js";
import { nanoid } from "../lib/nanoid.js";
import { logger } from "../debug.js";
import { getEventUID } from "../database/ingest.js";
import { pruneLastUsed } from "../database/prune.js";

export type SubscriptionOptions = {
  id?: string;
  onevent?: (event: Event) => void;
  oneose?: () => void;
  onclose?: (reason: string) => void;
};
export type Subscription = SubscriptionOptions & {
  id: string;
  filters: Filter[];
  close(message?: string): void;
};

export type RelayCoreOptions = {
  /** Defaults to 1000 */
  batchWrite?: number;
  /** Defaults to 100 */
  writeInterval?: number;
  /** number of indexes to cache in memory. defaults to 1000 */
  cacheIndexes?: number;
  /** how often to prune the database */
  pruneInterval?: number;
  /** Maximum number of events to store in the database */
  maxEvents?: number;
};

const defaultOptions: Required<RelayCoreOptions> = {
  batchWrite: 1000,
  writeInterval: 100,
  cacheIndexes: 1000,
  pruneInterval: 1000 * 60,
  maxEvents: 10000,
};

const log = logger.extend("relay");

/** Main class that implements the relay logic */
export class RelayCore {
  private options: Required<RelayCoreOptions>;
  private writeInterval?: number;
  private pruneInterval?: number;
  get running() {
    return !!this.writeInterval;
  }

  private eventMap = new Map<string, NostrEvent>();
  private writeQueue: WriteQueue;
  private indexCache: IndexCache;
  db: NostrIDB;

  private subscriptions: Map<
    string,
    SubscriptionOptions & {
      filters: Filter[];
    }
  > = new Map();

  constructor(db: NostrIDB, opts: RelayCoreOptions = {}) {
    this.db = db;
    this.options = { ...defaultOptions, ...opts };

    this.writeQueue = new WriteQueue(db);
    this.indexCache = new IndexCache();
    this.indexCache.max = this.options.cacheIndexes;
  }

  public async start(): Promise<void> {
    log("Starting");
    this.writeInterval = self.setInterval(() => {
      this.writeQueue.flush(this.options.batchWrite);
    }, this.options.writeInterval);

    this.pruneInterval = self.setInterval(() => {
      pruneLastUsed(this.db, this.options.maxEvents);
    }, this.options.pruneInterval);
  }
  public async stop() {
    if (this.writeInterval) {
      self.clearInterval(this.writeInterval);
      this.writeInterval = undefined;
    }
    if (this.pruneInterval) {
      self.clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
    log("Stopped");
  }

  public async publish(event: Event): Promise<string> {
    if (!kinds.isEphemeralKind(event.kind)) {
      this.writeQueue.addEvent(event);
      this.indexCache.addEventToIndexes(event);
    }

    const uid = getEventUID(event);
    let subs = 0;
    if (!this.eventMap.has(uid)) {
      if (!kinds.isEphemeralKind(event.kind)) this.eventMap.set(uid, event);

      for (const [id, sub] of this.subscriptions) {
        if (sub.onevent && matchFilters(sub.filters, event)) {
          sub.onevent(event);
          subs++;
        }
      }
    }

    return `Sent to ${subs} subscriptions`;
  }

  public async count(filters: Filter[]): Promise<number> {
    return await countEventsForFilters(this.db, filters);
  }

  private addToEventMaps(events: Iterable<NostrEvent>) {
    for (const event of events) this.eventMap.set(getEventUID(event), event);
  }

  private async executeSubscription(sub: Subscription) {
    const start = new Date().valueOf();
    log(`Running ${sub.id}`, sub.filters);

    // load any events from the write queue
    const eventsFromQueue = this.writeQueue.matchPending(sub.filters);

    // get events
    await getEventsForFilters(
      this.db,
      sub.filters,
      this.indexCache,
      this.eventMap,
    ).then((filterEvents) => {
      this.addToEventMaps(filterEvents);
      if (sub.onevent) {
        const idsFromQueue = new Set(eventsFromQueue.map((e) => e.id));

        const events =
          eventsFromQueue.length > 0
            ? [
                ...filterEvents.filter((e) => !idsFromQueue.has(e.id)),
                ...eventsFromQueue,
              ].sort(sortByDate)
            : filterEvents;

        for (const event of events) {
          sub.onevent(event);
          this.writeQueue.useEvent(event);
        }

        const delta = new Date().valueOf() - start;
        log(
          `Finished ${sub.id} took ${delta}ms and got ${events.length} events`,
        );
      }
      if (sub.oneose) sub.oneose();
    });
  }

  subscribe(
    filters: Filter[],
    options: Partial<SubscriptionOptions>,
  ): Subscription {
    // remove any duplicate subscriptions
    if (options.id && this.subscriptions.has(options.id)) {
      this.subscriptions.delete(options.id);
    }

    const id = options.id || nanoid();

    const sub = {
      id,
      filters,
      close: () => this.subscriptions.delete(id),
      fire: () => this.executeSubscription(sub),
      ...options,
    };

    this.subscriptions.set(id, sub);

    this.executeSubscription(sub);

    return sub;
  }

  unsubscribe(id: string) {
    const sub = this.subscriptions.get(id);
    if (sub) {
      log(`Closing ${id}`);
      sub.onclose?.("unsubscribe");
      this.subscriptions.delete(id);
    }
  }
}
