import type { StoredEvent } from "../lib/nostr.js";
import type { Filter } from "../lib/nostr.js";
import type { QueryPage, QueryPageOptions } from "../database/pagination.js";

/**
 * Standard feature flag strings for supports() checks.
 * "search" — NIP-50 full-text search.
 */
export type Features = "search";

/** Options for {@link INostrIDB.subscribe} */
export type SubscribeOptions = {
  /** Ends the subscription when aborted, even while waiting for new events */
  signal?: AbortSignal;
};

/**
 * Main interface for the nostr event store.
 *
 * This is a superset of the NIP-DB `IWindowNostrDB` interface. The `add`,
 * `event`, `replaceable`, `count`, `supports`, `query`, and `subscribe`
 * methods are compatible with that spec. The `deleteEvent`, `deleteReplaceable`,
 * `deleteByFilters`, and `deleteAllEvents` methods are local extensions.
 */
export interface INostrIDB<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> {
  /** Add an event to the database */
  add(event: TEvent, metadata?: TMetadata): Promise<boolean>;

  /** Replace metadata for an exact stored or pending event ID. */
  setMetadata(eventId: string, metadata: TMetadata): Promise<boolean>;

  /** Remove metadata for an exact stored or pending event ID. */
  clearMetadata(eventId: string): Promise<boolean>;

  /** Get a single event by ID */
  event(id: string): Promise<TEvent | undefined>;

  /** Get the latest version of a replaceable event */
  replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<TEvent | undefined>;

  /** Count the number of events matching filters */
  count(filters: Filter | Filter[]): Promise<number>;

  /** Check if the database backend supports features */
  supports(): Promise<string[]>;

  /** Get events by filters */
  query(filters: Filter | Filter[]): Promise<TEvent[]>;

  /** Read a bounded page of committed events, newest first by default. */
  queryPage(
    filters?: Filter | Filter[],
    options?: QueryPageOptions,
  ): Promise<QueryPage<TEvent>>;

  /** Traverse committed events as bounded pages with short-lived transactions. */
  pages(
    filters?: Filter | Filter[],
    options?: QueryPageOptions,
  ): AsyncGenerator<QueryPage<TEvent>, void, undefined>;

  /** Traverse committed events with at most one page buffered. */
  iterate(
    filters?: Filter | Filter[],
    options?: QueryPageOptions,
  ): AsyncGenerator<TEvent, void, undefined>;

  /**
   * Subscribe to events in the database based on filters. Aborting
   * `options.signal` ends the subscription without throwing.
   */
  subscribe(
    filters: Filter | Filter[],
    options?: SubscribeOptions,
  ): AsyncGenerator<TEvent, void, undefined>;

  /** Delete a single event by its ID or UID */
  deleteEvent(eventId: string): Promise<boolean>;

  /** Delete a replaceable event by pubkey, kind, and optional identifier */
  deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean>;

  /** Delete events matching the given filters */
  deleteByFilters(filters: Filter | Filter[]): Promise<number>;

  /** Delete all events from the database */
  deleteAllEvents(): Promise<void>;
}
