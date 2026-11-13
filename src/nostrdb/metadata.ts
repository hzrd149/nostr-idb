import type { StoredEvent } from "../lib/nostr.js";

/** Synchronous adapters between event properties/symbols and a cloneable sidecar. */
export type EventMetadataOptions<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> = {
  /** Extract on add; undefined means preserve metadata for this exact event. */
  read?: (event: TEvent) => TMetadata | undefined;
  /** Restore on reads and updates; undefined must remove previously attached data. */
  attach?: (event: TEvent, metadata: TMetadata | undefined) => void;
};
