import type { NostrEvent } from "../lib/nostr.js";
import type { Filter } from "../lib/nostr.js";

/** Standard feature flag strings for supports() checks */
export type Features = "search" | "subscribe";

/** Main interface for the nostr event store */
export interface INostrIDB {
  /** Add an event to the database */
  add(event: NostrEvent): Promise<boolean>;

  /** Get a single event by ID */
  event(id: string): Promise<NostrEvent | undefined>;

  /** Get the latest version of a replaceable event */
  replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined>;

  /** Count the number of events matching filters */
  count(filters: Filter | Filter[]): Promise<number>;

  /** Check if the database backend supports features */
  supports(): Promise<string[]>;

  /** Get events by filters */
  query(filters: Filter | Filter[]): Promise<NostrEvent[]>;

  /** Subscribe to events in the database based on filters */
  subscribe(filters: Filter | Filter[]): AsyncGenerator<NostrEvent>;

  /** Delete a single event by its ID or UID */
  deleteEvent(eventId: string): Promise<boolean>;

  /** Delete a replaceable event by pubkey, kind, and optional identifier */
  deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean>;

  /** Delete events matching the given filters */
  deleteByFilters(filters: Filter[]): Promise<number>;

  /** Delete all events from the database */
  deleteAllEvents(): Promise<void>;
}
