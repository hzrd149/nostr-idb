import type { StoredEvent } from "../lib/nostr.js";

/**
 * Anything that can exchange structured-clone messages: a `Worker`, a
 * `MessagePort`, or the global scope inside a dedicated worker (`self`).
 */
export interface RPCEndpoint {
  postMessage(message: any): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent) => void,
  ): void;
  /** Called when present; required for `MessagePort` with addEventListener */
  start?: () => void;
}

/** Tag on every protocol message so other messages on the endpoint are ignored */
export const RPC_TAG = "nostr-idb/rpc@1";

/** Methods answered with a single result */
export const CALL_METHODS = [
  "add",
  "setMetadata",
  "clearMetadata",
  "event",
  "replaceable",
  "count",
  "supports",
  "query",
  "queryPage",
  "deleteEvent",
  "deleteReplaceable",
  "deleteByFilters",
  "deleteAllEvents",
] as const;
export type CallMethod = (typeof CALL_METHODS)[number];

/**
 * Methods answered with a stream. `pages` is pulled one page at a time so at
 * most one page is buffered; `subscribe` pushes events as they arrive.
 */
export const STREAM_METHODS = ["pages", "subscribe"] as const;
export type StreamMethod = (typeof STREAM_METHODS)[number];

/**
 * Sparse metadata sidecars for the events in a message, as
 * `[index, metadata]` pairs. Structured clone drops symbol properties, so
 * metadata attached to events travels separately.
 */
export type MetadataList = [number, unknown][];

export type SerializedError = { name: string; message: string; stack?: string };

export type ClientBody =
  | { type: "ping" }
  | { type: "call"; id: number; method: CallMethod; args: unknown[] }
  | { type: "stream"; id: number; method: StreamMethod; args: unknown[] }
  | { type: "pull"; id: number }
  | { type: "cancel"; id: number };
export type ClientMessage = ClientBody & { tag: typeof RPC_TAG };

export type ServerBody =
  | { type: "ready" }
  | { type: "result"; id: number; value: unknown; meta?: MetadataList }
  | { type: "error"; id: number; error: SerializedError }
  /** a stream item: the response to a pull, or a pushed subscription event */
  | { type: "next"; id: number; value: unknown; meta?: MetadataList }
  | { type: "done"; id: number };
export type ServerMessage = ServerBody & { tag: typeof RPC_TAG };

export function isMessage<T extends ClientMessage | ServerMessage>(
  data: unknown,
): data is T {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { tag?: unknown }).tag === RPC_TAG
  );
}

/** Returns the events contained in a method's result or stream item */
export function eventsIn(
  method: CallMethod | StreamMethod,
  value: unknown,
): StoredEvent[] {
  if (value === undefined || value === null) return [];
  switch (method) {
    case "event":
    case "replaceable":
    case "subscribe":
      return [value as StoredEvent];
    case "query":
      return value as StoredEvent[];
    case "queryPage":
    case "pages":
      return (value as { events: StoredEvent[] }).events;
    default:
      return [];
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };
  return { name: "Error", message: String(error) };
}

export function deserializeError(error: SerializedError): Error {
  const err = new Error(error.message);
  err.name = error.name;
  if (error.stack) err.stack = error.stack;
  return err;
}
