import type { Filter, NostrEvent } from "../lib/nostr.js";
import { isEphemeralKind, matchFilters } from "../lib/nostr.js";
import { getEventUID } from "../database/common.js";
import {
  addEncryptedEvents,
  addPrivateEvents,
  countEncryptedEventsForFilters,
  countPrivateEventsForFilters,
  deleteAllEncryptedEvents,
  deleteEncryptedByFilters,
  deleteEncryptedEvent,
  deletePrivateByFilters,
  deletePrivateEvent,
  getEncryptedEvent,
  getEncryptedEventsForFilters,
  getPrivateEvent,
  getPrivateEventsForFilters,
  pruneEncryptedLastUsed,
  updateEncryptedUsed,
} from "../database/encrypted.js";
import { hmacIndexToken } from "../database/encryption.js";
import type {
  EncryptedNostrIDBDatabase,
  PrivateNostrIDBDatabase,
} from "../database/schema.js";
import { logger } from "../debug.js";
import { nanoid } from "../lib/nanoid.js";
import { sortByDate } from "../utils.js";
import type { INostrIDB } from "./interface.js";
import type { InternalSubscription, NostrDBOptions } from "./nostrdb.js";

type ExperimentalMode = "encrypted" | "private";

type ExperimentalDatabase = EncryptedNostrIDBDatabase | PrivateNostrIDBDatabase;

const defaultOptions: Required<NostrDBOptions> = {
  batchWrite: 1000,
  writeInterval: 100,
  cacheIndexes: 1000,
  pruneInterval: 1000 * 60,
  maxEvents: 10000,
};

const log = logger.extend("nostridb:encrypted");

abstract class ExperimentalNostrIDB implements INostrIDB {
  options: Required<NostrDBOptions>;
  running = false;
  protected writeInterval?: ReturnType<typeof setTimeout>;
  protected pruneInterval?: ReturnType<typeof setInterval>;
  protected eventMap = new Map<string, NostrEvent>();
  protected eventQueue: NostrEvent[] = [];
  protected queuedIds = new Set<string>();
  protected lastUsedQueue = new Set<string>();
  protected subscriptions: Map<string, InternalSubscription> = new Map();
  public baseEoseTimeout = 4400;

  protected constructor(
    protected db: ExperimentalDatabase,
    protected encryptionKey: CryptoKey,
    protected mode: ExperimentalMode,
    opts: NostrDBOptions = {},
  ) {
    this.options = { ...defaultOptions, ...opts };
    this.start();
  }

  /** Start the encrypted database timers. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.flush();
    this.pruneInterval = setInterval(() => {
      pruneEncryptedLastUsed(this.db, this.options.maxEvents);
    }, this.options.pruneInterval);
  }

  /** Stop the encrypted database timers. */
  async stop(): Promise<void> {
    if (!this.running) return;
    if (this.writeInterval) clearTimeout(this.writeInterval);
    if (this.pruneInterval) clearInterval(this.pruneInterval);
    this.writeInterval = undefined;
    this.pruneInterval = undefined;
    this.running = false;
  }

  /** Add an event to the encrypted database. */
  async add(event: NostrEvent): Promise<boolean> {
    if (!isEphemeralKind(event.kind) && !this.queuedIds.has(event.id)) {
      this.eventQueue.push(event);
      this.queuedIds.add(event.id);
      this.lastUsedQueue.add(await this.getStorageKey(event));
      this.eventMap.set(await this.getStorageKey(event), event);
    }

    for (const [_id, sub] of this.subscriptions) {
      if (sub.event && matchFilters(sub.filters, event)) sub.event(event);
    }

    return true;
  }

  /** Get a single event by ID or UID. */
  async event(id: string): Promise<NostrEvent | undefined> {
    return await this.getStoredEvent(id);
  }

  /** Get the latest replaceable event for a given kind, author, and optional identifier. */
  async replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined> {
    return await this.event([kind, author, identifier ?? ""].join(":"));
  }

  /** Count events matching the given filters. */
  async count(filters: Filter | Filter[]): Promise<number> {
    const f = Array.isArray(filters) ? filters : [filters];
    return await this.countStoredEvents(f);
  }

  /** Check if the database backend supports features. */
  async supports(): Promise<string[]> {
    return this.mode === "private"
      ? ["encrypted", "private-indexes"]
      : ["encrypted"];
  }

  /** Get events matching the given filters. */
  async query(filters: Filter | Filter[]): Promise<NostrEvent[]> {
    const f = Array.isArray(filters) ? filters : [filters];
    const eventsFromQueue = this.eventQueue.filter((event) =>
      matchFilters(f, event),
    );
    const filterEvents = await this.getStoredEvents(f);
    for (const event of filterEvents) {
      this.eventMap.set(await this.getStorageKey(event), event);
    }

    const idsFromQueue = new Set(eventsFromQueue.map((e) => e.id));
    return eventsFromQueue.length > 0
      ? [
          ...filterEvents.filter((e) => !idsFromQueue.has(e.id)),
          ...eventsFromQueue,
        ].sort(sortByDate)
      : filterEvents;
  }

  /** Subscribe to events in the encrypted database based on filters. */
  async *subscribe(
    filters: Filter | Filter[],
  ): AsyncGenerator<NostrEvent, void, undefined> {
    const f = Array.isArray(filters) ? filters : [filters];
    const queue: NostrEvent[] = [];
    const seenIds = new Set<string>();
    let notify: (() => void) | null = null;
    let done = false;

    const sub = this.subscribeInternal(f, {
      event: (event) => {
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);
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
        while (queue.length > 0) yield queue.shift()!;
        if (done) break;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      sub.close();
    }
  }

  /** Delete a single event by ID or UID. */
  async deleteEvent(eventId: string): Promise<boolean> {
    const deleted = await this.deleteStoredEvent(eventId);
    if (deleted) {
      this.eventMap.delete(eventId);
      this.eventMap.clear();
    }
    return deleted;
  }

  /** Delete a replaceable event by pubkey, kind, and optional identifier. */
  async deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    return await this.deleteEvent(`${kind}:${pubkey}:${identifier ?? ""}`);
  }

  /** Delete events matching the given filters. */
  async deleteByFilters(filters: Filter | Filter[]): Promise<number> {
    const f = Array.isArray(filters) ? filters : [filters];
    const deleted = await this.deleteStoredByFilters(f);
    if (deleted > 0) this.eventMap.clear();
    return deleted;
  }

  /** Delete all events from the encrypted database. */
  async deleteAllEvents(): Promise<void> {
    await deleteAllEncryptedEvents(this.db);
    this.eventMap.clear();
    this.eventQueue = [];
    this.queuedIds.clear();
  }

  protected async flush() {
    if (this.eventQueue.length > 0) {
      const events: NostrEvent[] = [];
      for (let i = 0; i < this.options.batchWrite; i++) {
        const event = this.eventQueue.shift();
        if (!event) break;
        events.push(event);
        this.queuedIds.delete(event.id);
      }

      await this.addStoredEvents(events);
      log(`Wrote ${events.length} ${this.mode} events to database`);
    }

    if (this.lastUsedQueue.size > 0) {
      await updateEncryptedUsed(this.db, this.lastUsedQueue);
      this.lastUsedQueue.clear();
    }

    this.writeInterval = setTimeout(
      this.flush.bind(this),
      this.options.writeInterval,
    );
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

  protected async executeSubscription(sub: InternalSubscription) {
    const eventsFromQueue = this.eventQueue.filter((event) =>
      matchFilters(sub.filters, event),
    );

    return new Promise<void>((res) => {
      const timeout = setTimeout(() => {
        if (sub.eose && !sub.closed) sub.eose();
        res();
      }, this.baseEoseTimeout);

      this.getStoredEvents(sub.filters).then((filterEvents) => {
        clearTimeout(timeout);
        if (sub.event && !sub.closed) {
          const idsFromQueue = new Set(eventsFromQueue.map((e) => e.id));
          const events =
            eventsFromQueue.length > 0
              ? [
                  ...filterEvents.filter((e) => !idsFromQueue.has(e.id)),
                  ...eventsFromQueue,
                ].sort(sortByDate)
              : filterEvents;

          for (const event of events) sub.event(event);
        }

        if (sub.eose && !sub.closed) sub.eose();
        res();
      });
    });
  }

  protected unsubscribe(id: string) {
    const subscription = this.subscriptions.get(id);
    if (subscription) {
      subscription.closed = true;
      subscription.complete?.();
      this.subscriptions.delete(id);
    }
  }

  protected abstract addStoredEvents(events: NostrEvent[]): Promise<void>;
  protected abstract getStoredEvent(
    id: string,
  ): Promise<NostrEvent | undefined>;
  protected abstract getStoredEvents(filters: Filter[]): Promise<NostrEvent[]>;
  protected abstract countStoredEvents(filters: Filter[]): Promise<number>;
  protected abstract deleteStoredEvent(id: string): Promise<boolean>;
  protected abstract deleteStoredByFilters(filters: Filter[]): Promise<number>;
  protected abstract getStorageKey(event: NostrEvent): Promise<string>;
}

/** Experimental encrypted event database with clear query metadata. */
export class EncryptedNostrIDB extends ExperimentalNostrIDB {
  constructor(
    db: EncryptedNostrIDBDatabase,
    encryptionKey: CryptoKey,
    opts: NostrDBOptions = {},
  ) {
    super(db, encryptionKey, "encrypted", opts);
  }

  protected async addStoredEvents(events: NostrEvent[]) {
    await addEncryptedEvents(
      this.db as EncryptedNostrIDBDatabase,
      events,
      this.encryptionKey,
    );
  }

  protected async getStoredEvent(id: string) {
    return await getEncryptedEvent(
      this.db as EncryptedNostrIDBDatabase,
      id,
      this.encryptionKey,
    );
  }

  protected async getStoredEvents(filters: Filter[]) {
    return await getEncryptedEventsForFilters(
      this.db as EncryptedNostrIDBDatabase,
      filters,
      this.encryptionKey,
      this.eventMap,
    );
  }

  protected async countStoredEvents(filters: Filter[]) {
    return await countEncryptedEventsForFilters(
      this.db as EncryptedNostrIDBDatabase,
      filters,
    );
  }

  protected async deleteStoredEvent(id: string) {
    return await deleteEncryptedEvent(this.db as EncryptedNostrIDBDatabase, id);
  }

  protected async deleteStoredByFilters(filters: Filter[]) {
    return await deleteEncryptedByFilters(
      this.db as EncryptedNostrIDBDatabase,
      filters,
    );
  }

  protected async getStorageKey(event: NostrEvent) {
    return getEventUID(event);
  }
}

/** Experimental encrypted event database with HMAC-tokenized query indexes. */
export class PrivateNostrIDB extends ExperimentalNostrIDB {
  constructor(
    db: PrivateNostrIDBDatabase,
    encryptionKey: CryptoKey,
    private indexKey: CryptoKey,
    opts: NostrDBOptions = {},
  ) {
    super(db, encryptionKey, "private", opts);
  }

  protected async addStoredEvents(events: NostrEvent[]) {
    await addPrivateEvents(
      this.db as PrivateNostrIDBDatabase,
      events,
      this.encryptionKey,
      this.indexKey,
    );
  }

  protected async getStoredEvent(id: string) {
    return await getPrivateEvent(
      this.db as PrivateNostrIDBDatabase,
      id,
      this.encryptionKey,
      this.indexKey,
    );
  }

  protected async getStoredEvents(filters: Filter[]) {
    return await getPrivateEventsForFilters(
      this.db as PrivateNostrIDBDatabase,
      filters,
      this.encryptionKey,
      this.indexKey,
      this.eventMap,
    );
  }

  protected async countStoredEvents(filters: Filter[]) {
    return await countPrivateEventsForFilters(
      this.db as PrivateNostrIDBDatabase,
      filters,
      this.indexKey,
    );
  }

  protected async deleteStoredEvent(id: string) {
    return await deletePrivateEvent(
      this.db as PrivateNostrIDBDatabase,
      id,
      this.indexKey,
    );
  }

  protected async deleteStoredByFilters(filters: Filter[]) {
    return await deletePrivateByFilters(
      this.db as PrivateNostrIDBDatabase,
      filters,
      this.indexKey,
    );
  }

  protected async getStorageKey(event: NostrEvent) {
    return await hmacIndexToken(this.indexKey, "uid", getEventUID(event));
  }
}
