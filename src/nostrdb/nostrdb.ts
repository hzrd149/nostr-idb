import type { StoredEvent } from "../lib/nostr.js";
import {
  isEphemeralKind,
  isReplaceableKind,
  isAddressableKind,
} from "../lib/nostr.js";
import { matchFilters } from "../lib/nostr.js";
import type { Filter } from "../lib/nostr.js";

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
import type { NostrIDBDatabase } from "../database/schema.js";
import type { EventReader } from "../database/metadata.js";
import { setEventMetadata } from "../database/metadata.js";
import type { EventMetadataOptions } from "./metadata.js";
import { logger, startTimer } from "../debug.js";
import { nanoid } from "../lib/nanoid.js";
import { selectEventsForFilters } from "../utils.js";
import { type INostrIDB } from "./interface.js";
import { openDB } from "../database/database.js";
import {
  getEventsPage,
  iterateEventPages,
  iterateEvents,
  type QueryPageOptions,
} from "../database/pagination.js";

/** Internal subscription handlers */
type InternalHandlers = {
  event?: (event: StoredEvent) => void;
  complete?: () => void;
};

type InternalHandlersFor<TEvent extends StoredEvent> = {
  event?: (event: TEvent) => void;
  complete?: () => void;
};

/** Type for internal subscriptions */
export type InternalSubscription = InternalHandlers & {
  id: string;
  filters: Filter[];
  closed: boolean;
  close: () => void;
  eose?: () => void;
};

export type InternalSubscriptionFor<TEvent extends StoredEvent> =
  InternalHandlersFor<TEvent> & {
    id: string;
    filters: Filter[];
    closed: boolean;
    close: () => void;
    eose?: () => void;
  };

export type NostrDBOptions<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> = {
  /** Extract and restore app-defined event sidecars. */
  metadata?: EventMetadataOptions<TEvent, TMetadata>;
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
  /** Maximum event bodies retained in memory. Defaults to maxEvents. */
  maxMemoryEvents?: number;
};

const defaultOptions: Required<Omit<NostrDBOptions, "metadata">> = {
  batchWrite: 1000,
  writeInterval: 100,
  cacheIndexes: 1000,
  pruneInterval: 1000 * 60,
  maxEvents: 10000,
  maxMemoryEvents: 10000,
};

const log = logger.extend("nostridb");

/** Main class that implements the nostrdb logic */
export class NostrIDB<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> implements INostrIDB<TEvent, TMetadata> {
  options: Required<NostrDBOptions<TEvent, TMetadata>>;
  running = false;
  private writeInterval?: ReturnType<typeof setTimeout>;
  private pruneInterval?: ReturnType<typeof setInterval>;
  private pruning = false;

  /** In-memory map of events */
  eventMap = new Map<string, TEvent>();

  /** Queue of events to be written to the database */
  writeQueue: WriteQueue<TEvent> | null = null;

  /** Cache of indexes */
  indexCache: IndexCache;

  /** Database instance */
  db: NostrIDBDatabase | null = null;

  /** Base EOSE timeout */
  public baseEoseTimeout: number = 4400;

  /** Map of active subscriptions */
  subscriptions: Map<string, InternalSubscriptionFor<TEvent>> = new Map();

  constructor(
    db?: NostrIDBDatabase,
    opts: NostrDBOptions<TEvent, TMetadata> = {},
  ) {
    this.options = {
      ...defaultOptions,
      ...opts,
      metadata: opts.metadata ?? {},
      maxMemoryEvents:
        opts.maxMemoryEvents ??
        opts.maxEvents ??
        defaultOptions.maxMemoryEvents,
    };
    if (
      !Number.isInteger(this.options.maxMemoryEvents) ||
      this.options.maxMemoryEvents < 0
    )
      throw new Error("maxMemoryEvents must be a non-negative integer");

    if (db) {
      this.db = db;
      this.writeQueue = new WriteQueue<TEvent>(db);
    }
    this.indexCache = new IndexCache();
    this.indexCache.max = this.options.cacheIndexes;

    this.start();
  }

  private async getDb() {
    if (this.db) return this.db;
    this.db = await openDB();
    return this.db;
  }
  private async getWriteQueue() {
    if (this.writeQueue) return this.writeQueue;
    const db = await this.getDb();
    this.writeQueue = new WriteQueue<TEvent>(db);
    return this.writeQueue;
  }

  /** Write events to the database */
  private async flush() {
    const queue = await this.getWriteQueue();
    await queue.flush();

    // start next flush cycle
    this.writeInterval = setTimeout(
      this.flush.bind(this),
      this.options.writeInterval,
    );
  }

  /** Start the database */
  public async start(): Promise<void> {
    if (this.running) return;

    log("Starting");
    this.running = true;
    const db = await this.getDb();
    await this.flush();
    this.pruneInterval = setInterval(() => {
      if (this.pruning) return;
      this.pruning = true;
      pruneLastUsed(db, this.options.maxEvents)
        .then((uids) => {
          if (uids.length === 0) return;
          for (const uid of uids) this.eventMap.delete(uid);
          this.indexCache.clear();
        })
        .catch((error) => log("pruning failed", error))
        .finally(() => {
          this.pruning = false;
        });
    }, this.options.pruneInterval);
  }

  /** Stop the database */
  public async stop() {
    if (!this.running) return;
    if (this.writeInterval) {
      clearTimeout(this.writeInterval);
      this.writeInterval = undefined;
    }
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = undefined;
    }
    this.running = false;
    log("Stopped");
  }

  /** Add an event to the database */
  async add(event: TEvent, metadata?: TMetadata): Promise<boolean> {
    // Snapshot before the first await so callers can safely reuse mutable metadata.
    const snapshot = structuredClone(
      arguments.length > 1 ? metadata : this.options.metadata.read?.(event),
    );
    const queue = await this.getWriteQueue();
    return queue.runExclusive(async () => {
      const uid = getEventUID(event);
      let sidecar: unknown = snapshot;
      if (!isEphemeralKind(event.kind)) {
        const pending = queue.getPending(uid);
        // Ordinary adds without restoration hooks retain the batched-write path.
        // Only read here when resolving existing metadata or replacement ordering.
        const needsStoredEvent =
          isReplaceableKind(event.kind) ||
          isAddressableKind(event.kind) ||
          (this.options.metadata.attach &&
            snapshot === undefined &&
            !(pending?.id === event.id && queue.hasMetadata(event.id)));
        const row = needsStoredEvent
          ? await (await this.getDb()).get("events", uid)
          : undefined;
        if (
          [pending, row?.event].some(
            (current) =>
              current &&
              current.id !== event.id &&
              current.created_at >= event.created_at,
          )
        )
          return true;
        if (sidecar === undefined) {
          sidecar =
            pending?.id === event.id && queue.hasMetadata(event.id)
              ? queue.getMetadata(event.id)
              : row?.event.id === event.id
                ? row.metadata
                : undefined;
        }
        this.attachMetadata(event, sidecar);
        if (snapshot === undefined) queue.addEvent(event);
        else queue.addEvent(event, snapshot);
        this.indexCache.addEventToIndexes(event);
      } else {
        this.attachMetadata(event, sidecar);
      }

      const cached = this.eventMap.get(uid);
      if (cached?.id === event.id) this.attachMetadata(cached, sidecar);
      if (!isEphemeralKind(event.kind)) this.addToEventMaps([event]);
      if (cached?.id !== event.id) {
        for (const sub of this.subscriptions.values()) {
          if (sub.event && matchFilters(sub.filters, event)) sub.event(event);
        }
      }
      return true;
    });
  }

  private attachMetadata(event: TEvent, metadata: unknown) {
    this.options.metadata.attach?.(
      event,
      structuredClone(metadata) as TMetadata | undefined,
    );
  }

  private readEvent: EventReader<TEvent> = (row) => {
    const event = row.event as TEvent;
    this.attachMetadata(event, row.metadata);
    return event;
  };

  /** Replace metadata for an exact event ID without re-adding the event. */
  async setMetadata(eventId: string, metadata: TMetadata): Promise<boolean> {
    return this.updateMetadata(eventId, metadata);
  }

  /** Clear metadata for an exact event ID, including cached and pending copies. */
  async clearMetadata(eventId: string): Promise<boolean> {
    return this.updateMetadata(eventId, undefined);
  }

  private async updateMetadata(
    eventId: string,
    metadata: TMetadata | undefined,
  ): Promise<boolean> {
    const snapshot = structuredClone(metadata);
    const queue = await this.getWriteQueue();
    return queue.runExclusive(async () => {
      const stored = await setEventMetadata(
        await this.getDb(),
        eventId,
        snapshot,
      );
      const pending = queue.setMetadata(eventId, snapshot);
      if (!stored && !pending) return false;
      if (pending) this.attachMetadata(pending, snapshot);
      for (const event of this.eventMap.values()) {
        if (event.id === eventId) this.attachMetadata(event, snapshot);
      }
      return true;
    });
  }

  /** Get a single event by its ID */
  async event(id: string): Promise<TEvent | undefined> {
    const db = await this.getDb();
    const end = startTimer("NostrIDB.event", db.name);
    try {
      const result =
        (await db.get("events", id)) ??
        (await db.getFromIndex("events", "id", id));
      return result ? this.readEvent(result) : undefined;
    } finally {
      end();
    }
  }

  /** Get the latest replaceable event for a given kind, author, and optional identifier */
  async replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<TEvent | undefined> {
    // Events are stored using a unique identifier that is compatible with replaceable kinds
    return this.event([kind, author, identifier ?? ""].join(":"));
  }

  /** Count events matching the given filters */
  async count(filters: Filter | Filter[]): Promise<number> {
    const f = Array.isArray(filters) ? filters : [filters];
    const db = await this.getDb();
    return await countEventsForFilters(db, f);
  }

  /** Get events matching the given filters */
  async query(filters: Filter | Filter[]): Promise<TEvent[]> {
    const end = startTimer("NostrIDB.query", this.db?.name);
    try {
      const f = Array.isArray(filters) ? filters : [filters];
      this.warnUnboundedQuery(f);
      const db = await this.getDb();
      const queue = await this.getWriteQueue();

      // Get events from queue that match filters
      const eventsFromQueue = queue.matchPending(f);

      // Get events from database
      const filterEvents = await getEventsForFilters(
        db,
        eventsFromQueue.length ? f.map(({ limit, ...filter }) => filter) : f,
        this.indexCache,
        this.eventMap,
        this.readEvent,
      );

      // Add events to event map
      this.addToEventMaps(filterEvents);

      // Combine and deduplicate events
      const idsFromQueue = new Set(eventsFromQueue.map((e) => getEventUID(e)));
      const events =
        eventsFromQueue.length > 0
          ? [
              ...filterEvents.filter((e) => !idsFromQueue.has(getEventUID(e))),
              ...eventsFromQueue,
            ]
          : filterEvents;

      return selectEventsForFilters(events, f);
    } finally {
      end();
    }
  }

  /** Read a bounded page of committed events without warming caches. */
  async queryPage(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ) {
    return getEventsPage<TEvent>(
      await this.getDb(),
      filters,
      options,
      this.readEvent,
    );
  }

  /** Traverse committed events as pages; no transaction survives a yield. */
  async *pages(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ) {
    yield* iterateEventPages<TEvent>(
      await this.getDb(),
      filters,
      options,
      this.readEvent,
    );
  }

  /** Traverse committed events with at most one page buffered. */
  async *iterate(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ) {
    yield* iterateEvents<TEvent>(
      await this.getDb(),
      filters,
      options,
      this.readEvent,
    );
  }

  /** Subscribe to events in the database based on filters */
  async *subscribe(
    filters: Filter | Filter[],
  ): AsyncGenerator<TEvent, void, undefined> {
    const f = Array.isArray(filters) ? filters : [filters];
    this.warnUnboundedQuery(f);

    const queue: TEvent[] = [];
    // seenUids deduplicates events that arrive both as historical (IDB) and live (add())
    const seenUids = new Set<string>();
    let notify: (() => void) | null = null;
    let done = false;

    const sub = this.subscribeInternal(f, {
      event: (event) => {
        const uid = getEventUID(event);
        if (seenUids.has(uid)) return;
        seenUids.add(uid);
        queue.push(event);
        if (notify) {
          const fn = notify;
          notify = null;
          fn();
        }
      },
      complete: () => {
        done = true;
        if (notify) {
          const fn = notify;
          notify = null;
          fn();
        }
      },
    });

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (done) break;
        // Wait for the next event or completion signal
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      sub.close();
    }
  }

  private warnUnboundedQuery(filters: Filter[]) {
    if (
      filters.some((filter) =>
        Object.entries(filter).every(
          ([key, value]) => value === undefined || (key === "search" && !value),
        ),
      )
    ) {
      console.warn(
        "nostr-idb: An empty filter without a limit loads the entire database into memory. Use a limit to bound results.",
      );
    }
  }

  /** Check if the database backend supports features */
  async supports(): Promise<string[]> {
    // "search" — NIP-50 full-text search (when underlying IDB store supports it)
    return [];
  }

  /** Delete a single event by its ID or UID */
  async deleteEvent(eventId: string): Promise<boolean> {
    const db = await this.getDb();
    const deleted = await deleteEvent(db, eventId, this.indexCache);

    // Remove from in-memory event map
    this.eventMap.delete(eventId);

    return deleted;
  }

  /** Delete a replaceable event by pubkey, kind, and optional identifier */
  async deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    const db = await this.getDb();
    const deleted = await deleteReplaceable(
      db,
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
  async deleteByFilters(filters: Filter | Filter[]): Promise<number> {
    const f = Array.isArray(filters) ? filters : [filters];
    const db = await this.getDb();
    // Get event IDs before deletion to clean up eventMap
    const eventIds = await this.getEventIdsForFilters(f);

    const deletedCount = await deleteByFilters(db, f, this.indexCache);

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
    const db = await this.getDb();
    await deleteAllEvents(db, this.indexCache);

    // Clear in-memory event map
    this.eventMap.clear();
  }

  /** Helper method to get event IDs for filters (used internally) */
  private async getEventIdsForFilters(filters: Filter[]): Promise<string[]> {
    const db = await this.getDb();
    const { getIdsForFilters } = await import("../database/query-filter.js");
    const eventIds = await getIdsForFilters(db, filters, this.indexCache);
    return Array.from(eventIds);
  }

  /** Add events to the event map */
  protected addToEventMaps(events: Iterable<TEvent>) {
    const map = this.eventMap;
    const max = this.options.maxMemoryEvents;
    if (max === 0) {
      map.clear();
      return;
    }

    // Only the last `max` distinct UIDs survive an oversized batch. Collect
    // them backwards, retaining the last object for each UID, then restore
    // insertion order. Keep the public Map instance intact.
    if (Array.isArray(events) && events.length > max) {
      const retained = new Map<string, TEvent>();
      for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        const uid = getEventUID(event);
        if (!retained.has(uid)) retained.set(uid, event);
        if (retained.size === max) {
          map.clear();
          const entries = Array.from(retained);
          for (let j = entries.length - 1; j >= 0; j--) {
            const [key, value] = entries[j];
            map.set(key, value);
          }
          return;
        }
      }
    }

    // Reuse a live iterator so successive evictions do not restart scans
    // over deleted Map entries (especially costly for large Firefox caches).
    let oldest: MapIterator<string> | undefined;
    for (const event of events) {
      const uid = getEventUID(event);
      map.delete(uid);
      map.set(uid, event);
      while (map.size > max) {
        oldest ??= map.keys();
        map.delete(oldest.next().value!);
      }
    }
  }

  protected subscribeInternal(
    filters: Filter[],
    options: Partial<Omit<InternalSubscriptionFor<TEvent>, "id">>,
  ): InternalSubscriptionFor<TEvent> {
    const id = nanoid();

    const sub: InternalSubscriptionFor<TEvent> = {
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
  protected async executeSubscription(sub: InternalSubscriptionFor<TEvent>) {
    log(`Running ${sub.id}`, sub.filters);

    // load any events from the write queue
    const queue = await this.getWriteQueue();
    const eventsFromQueue = queue.matchPending(sub.filters);

    return new Promise<void>(async (res) => {
      const db = await this.getDb();
      const timeout = setTimeout(() => {
        if (sub.eose && !sub.closed) sub.eose();
        res();
      }, this.baseEoseTimeout);

      // get events
      const endLoad = startTimer("subscription.load", db.name);
      getEventsForFilters(
        db,
        eventsFromQueue.length
          ? sub.filters.map(({ limit, ...filter }) => filter)
          : sub.filters,
        this.indexCache,
        this.eventMap,
        this.readEvent,
      )
        .finally(endLoad)
        .then((filterEvents) => {
          clearTimeout(timeout);
          this.addToEventMaps(filterEvents);

          if (sub.event && !sub.closed) {
            const idsFromQueue = new Set(
              eventsFromQueue.map((e) => getEventUID(e)),
            );

            const events =
              eventsFromQueue.length > 0
                ? [
                    ...filterEvents.filter(
                      (e) => !idsFromQueue.has(getEventUID(e)),
                    ),
                    ...eventsFromQueue,
                  ]
                : filterEvents;

            for (const event of selectEventsForFilters(events, sub.filters)) {
              try {
                sub.event(event);
              } catch (error) {
                log(`event handler failed with error`, error);
              }
            }

            log(`Finished ${sub.id} and got ${events.length} events`);
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
