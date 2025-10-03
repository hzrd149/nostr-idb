import type { NostrEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";

/** Generic type for a subscription */
export type Subscription = {
  close: () => void;
};

export type StreamHandlers = {
  event?: (event: NostrEvent) => void;
  error?: (error: Error) => void;
  complete?: () => void;
};

/** Standard enums for feature checks */
export enum Features {
  Search = "search",
  Subscribe = "subscribe",
}

/** Main interface for the nostr event store */
export interface INostrIDB {
  /** Add an event to the database */
  add(event: NostrEvent): Promise<boolean>;

  /** Get a single event */
  event(id: string): Promise<NostrEvent | undefined>;

  /** Get the latest version of a replaceable event */
  replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined>;

  /** Count the number of events matching a filter */
  count(filters: Filter[]): Promise<number>;

  /** Check if the database backend supports a feature */
  supports(): Promise<Features[]>;

  /** Get events by filters */
  filters(filters: Filter[], handlers: StreamHandlers): Subscription;

  /** Subscribe to events in the database based on filters */
  subscribe(filters: Filter[], handlers: StreamHandlers): Subscription;

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
