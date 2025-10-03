import type { NostrEvent } from "nostr-tools/pure";
import { matchFilters, type Filter } from "nostr-tools/filter";
import { isEphemeralKind } from "nostr-tools/kinds";

import { IndexCache } from "../cache/index-cache.js";
import { WriteQueue } from "../cache/write-queue.js";
import { getEventUID } from "../database/common.js";
import {
  deleteAllEvents,
  deleteByFilters,
  deleteEvent,
  deleteReplaceable,
} from "../database/delete.js";
import { pruneLastUsed } from "../database/prune.js";
import {
  countEventsForFilters,
  getEventsForFilters,
} from "../database/query-filter.js";
import { NostrIDBDatabase } from "../database/schema.js";
import { logger } from "../debug.js";
import { nanoid } from "../lib/nanoid.js";
import { sortByDate } from "../utils.js";
import {
  Features,
  type INostrIDB,
  type StreamHandlers,
  type Subscription,
} from "./interface.js";

/** Type for internal subscriptions */
export type InternalSubscription = StreamHandlers &
  Subscription & {
    id: string;
    filters: Filter[];
    closed: boolean;
    eose?: () => void;
  };

export type NostrDBOptions = {
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

const defaultOptions: Required<NostrDBOptions> = {
  batchWrite: 1000,
  writeInterval: 100,
  cacheIndexes: 1000,
  pruneInterval: 1000 * 60,
  maxEvents: 10000,
};

const log = logger.extend("relay");

/** Main class that implements the relay logic */
export class NostrIDB implements INostrIDB {
  options: Required<NostrDBOptions>;
  running = false;
  private writeInterval?: number;
  private pruneInterval?: number;

  /** In-memory map of events */
  eventMap = new Map<string, NostrEvent>();

  /** Queue of events to be written to the database */
  writeQueue: WriteQueue;

  /** Cache of indexes */
  indexCache: IndexCache;

  /** Database instance */
  db: NostrIDBDatabase;

  /** Base EOSE timeout */
  public baseEoseTimeout: number = 4400;

  /** Map of active subscriptions */
  subscriptions: Map<string, InternalSubscription> = new Map();

  constructor(db: NostrIDBDatabase, opts: NostrDBOptions = {}) {
    this.db = db;
    this.options = { ...defaultOptions, ...opts };

    this.writeQueue = new WriteQueue(db);
    this.indexCache = new IndexCache();
    this.indexCache.max = this.options.cacheIndexes;

    this.start();
  }

  /** Write events to the database */
  private async flush() {
    await this.writeQueue.flush();

    // start next flush cycle
    this.writeInterval = self.setTimeout(
      this.flush.bind(this),
      this.options.writeInterval,
    );
  }

  /** Start the database */
  public async start(): Promise<void> {
    if (this.running) return;

    log("Starting");
    this.running = true;
    await this.flush();
    this.pruneInterval = self.setInterval(() => {
      pruneLastUsed(this.db, this.options.maxEvents);
    }, this.options.pruneInterval);
  }

  /** Stop the database */
  public async stop() {
    if (!this.running) return;
    if (this.writeInterval) {
      self.clearTimeout(this.writeInterval);
      this.writeInterval = undefined;
    }
    if (this.pruneInterval) {
      self.clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
    this.running = false;
    log("Stopped");
  }

  /** Add an event to the database */
  async add(event: NostrEvent): Promise<boolean> {
    // if the event is not ephemeral, add it to the write queue and index cache
    if (!isEphemeralKind(event.kind)) {
      this.writeQueue.addEvent(event);
      this.indexCache.addEventToIndexes(event);
    }

    const uid = getEventUID(event);
    if (!this.eventMap.has(uid)) {
      // add the event to the in-memory event map
      if (!isEphemeralKind(event.kind)) this.eventMap.set(uid, event);

      // Pass event to active subscriptions
      for (const [_id, sub] of this.subscriptions) {
        if (sub.event && matchFilters(sub.filters, event)) sub.event(event);
      }
    }

    return true;
  }

  /** Get a single event by its ID */
  async event(id: string): Promise<NostrEvent | undefined> {
    const result = await this.db.get("events", id);
    return result?.event;
  }

  /** Get the latest replaceable event for a given kind, author, and optional identifier */
  async replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined> {
    // Events are stored using a unique identifier that is compatible with replaceable kinds
    return this.event([kind, author, identifier ?? ""].join(":"));
  }

  /** Count events matching the given filters */
  async count(filters: Filter[]): Promise<number> {
    return await countEventsForFilters(this.db, filters);
  }

  /** Get events matching the given filters */
  filters(filters: Filter[], handlers: StreamHandlers): Subscription {
    const sub = this.subscribeInternal(filters, {
      ...handlers,
      eose: () => this.unsubscribe(sub.id),
    });

    return {
      close: () => this.unsubscribe(sub.id),
    };
  }

  /** Subscribe to events in the database based on filters */
  subscribe(filters: Filter[], handlers: StreamHandlers): Subscription {
    const sub = this.subscribeInternal(filters, handlers);
    return {
      close: () => this.unsubscribe(sub.id),
    };
  }

  /** Check if the database backend supports features */
  async supports(): Promise<Features[]> {
    return [Features.Subscribe];
  }

  /** Delete a single event by its ID or UID */
  async deleteEvent(eventId: string): Promise<boolean> {
    const deleted = await deleteEvent(this.db, eventId, this.indexCache);

    if (deleted) {
      // Remove from in-memory event map
      this.eventMap.delete(eventId);
    }

    return deleted;
  }

  /** Delete a replaceable event by pubkey, kind, and optional identifier */
  async deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    const deleted = await deleteReplaceable(
      this.db,
      pubkey,
      kind,
      identifier,
      this.indexCache,
    );

    if (deleted) {
      // Remove from in-memory event map
      const uid = `${kind}:${pubkey}:${identifier ?? ""}`;
      this.eventMap.delete(uid);
    }

    return deleted;
  }

  /** Delete events matching the given filters */
  async deleteByFilters(filters: Filter[]): Promise<number> {
    // Get event IDs before deletion to clean up eventMap
    const eventIds = await this.getEventIdsForFilters(filters);

    const deletedCount = await deleteByFilters(
      this.db,
      filters,
      this.indexCache,
    );

    if (deletedCount > 0) {
      // Remove deleted events from in-memory event map
      for (const eventId of eventIds) {
        this.eventMap.delete(eventId);
      }
    }

    return deletedCount;
  }

  /** Delete all events from the database */
  async deleteAllEvents(): Promise<void> {
    await deleteAllEvents(this.db, this.indexCache);

    // Clear in-memory event map
    this.eventMap.clear();
  }

  /** Helper method to get event IDs for filters (used internally) */
  private async getEventIdsForFilters(filters: Filter[]): Promise<string[]> {
    const { getIdsForFilters } = await import("../database/query-filter.js");
    const eventIds = await getIdsForFilters(this.db, filters, this.indexCache);
    return Array.from(eventIds);
  }

  /** Add events to the event map */
  protected addToEventMaps(events: Iterable<NostrEvent>) {
    for (const event of events) this.eventMap.set(getEventUID(event), event);
  }

  protected subscribeInternal(
    filters: Filter[],
    options: Partial<Omit<InternalSubscription, "id">>,
  ): InternalSubscription {
    const id = nanoid();

    const sub: InternalSubscription = {
      id,
      filters,
      closed: false,
      close: () => this.unsubscribe(id),
      ...options,
    };

    this.subscriptions.set(id, sub);
    this.executeSubscription(sub);

    return sub;
  }

  /** Execute a subscription */
  protected async executeSubscription(sub: InternalSubscription) {
    const start = new Date().valueOf();
    log(`Running ${sub.id}`, sub.filters);

    // load any events from the write queue
    const eventsFromQueue = this.writeQueue.matchPending(sub.filters);

    return new Promise<void>((res, rej) => {
      const timeout = setTimeout(() => {
        if (sub.eose && !sub.closed) sub.eose();
        res();
      }, this.baseEoseTimeout);

      // get events
      getEventsForFilters(
        this.db,
        sub.filters,
        this.indexCache,
        this.eventMap,
      ).then((filterEvents) => {
        clearTimeout(timeout);
        this.addToEventMaps(filterEvents);

        if (sub.event && !sub.closed) {
          const idsFromQueue = new Set(eventsFromQueue.map((e) => e.id));

          const events =
            eventsFromQueue.length > 0
              ? [
                  ...filterEvents.filter((e) => !idsFromQueue.has(e.id)),
                  ...eventsFromQueue,
                ].sort(sortByDate)
              : filterEvents;

          for (const event of events) {
            try {
              sub.event(event);
              this.writeQueue.touch(event);
            } catch (error) {
              log(`onevent failed with error`, error);
            }
          }

          const delta = new Date().valueOf() - start;
          log(
            `Finished ${sub.id} took ${delta}ms and got ${events.length} events`,
          );
        }

        if (sub.eose && !sub.closed) sub.eose();
        res();
      });
    });
  }

  /** Close a subscription */
  protected unsubscribe(id: string) {
    const subscription = this.subscriptions.get(id);
    if (subscription) {
      log(`Closing ${id}`);
      subscription.closed = true;
      subscription.complete?.();
      this.subscriptions.delete(id);
    }
  }
}
