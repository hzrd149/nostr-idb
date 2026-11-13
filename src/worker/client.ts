import type { QueryPage, QueryPageOptions } from "../database/pagination.js";
import type { Filter, StoredEvent } from "../lib/nostr.js";
import type { INostrIDB, SubscribeOptions } from "../nostrdb/interface.js";
import type { EventMetadataOptions } from "../nostrdb/metadata.js";
import {
  RPC_TAG,
  deserializeError,
  eventsIn,
  isMessage,
  type CallMethod,
  type ClientBody,
  type ClientMessage,
  type MetadataList,
  type RPCEndpoint,
  type ServerMessage,
  type StreamMethod,
} from "./protocol.js";

export type NostrIDBClientOptions<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> = {
  /**
   * Metadata hooks, applied on the client side. `read` extracts metadata
   * from events passed to `add()`; `attach` restores it onto events received
   * from the server (which must use `serverMetadata`).
   */
  metadata?: EventMetadataOptions<TEvent, TMetadata>;
};

type Pending = {
  method: CallMethod | StreamMethod;
  resolve: (msg: ServerMessage) => void;
  reject: (error: Error) => void;
};

/** Buffered state for a pushed subscription stream */
type PushStream = {
  queue: unknown[];
  done: boolean;
  error?: Error;
  wake?: () => void;
};

/**
 * An {@link INostrIDB} that forwards every call to a database served with
 * `serveNostrIDB()`, usually in a worker so IndexedDB reads, index building
 * and filtering stay off the main thread.
 *
 * ```ts
 * const worker = new Worker(new URL("./db-worker.ts", import.meta.url), {
 *   type: "module",
 * });
 * const db = new NostrIDBClient(worker);
 * const notes = await db.query({ kinds: [1], limit: 20 });
 * ```
 *
 * Calls made before the server is listening wait for it. Events are
 * structured clones, so symbol properties (including the cached UID) are not
 * preserved; use the `metadata` option for app-defined sidecars.
 */
export class NostrIDBClient<
  TEvent extends StoredEvent = StoredEvent,
  TMetadata = unknown,
> implements INostrIDB<TEvent, TMetadata> {
  /** Resolves once the server has answered */
  readonly ready: Promise<void>;

  private nextId = 1;
  private pending = new Map<number, Pending>();
  private pushStreams = new Map<number, PushStream>();
  private closed?: Error;
  private markReady!: () => void;

  constructor(
    private endpoint: RPCEndpoint,
    private options: NostrIDBClientOptions<TEvent, TMetadata> = {},
  ) {
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    endpoint.addEventListener("message", this.listener);
    endpoint.start?.();
    this.post({ type: "ping" });
  }

  /**
   * Stop listening and reject outstanding calls and streams. Does not stop
   * the server or close the database; terminate the worker for that.
   */
  close(reason = new Error("NostrIDBClient closed")) {
    if (this.closed) return;
    this.closed = reason;
    this.endpoint.removeEventListener("message", this.listener);
    this.markReady();
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    for (const s of this.pushStreams.values()) {
      s.error = reason;
      s.wake?.();
    }
    this.pushStreams.clear();
  }

  private post(message: ClientBody) {
    this.endpoint.postMessage({ ...message, tag: RPC_TAG });
  }

  private listener = (event: MessageEvent) => {
    const msg = event.data;
    if (!isMessage<ServerMessage>(msg)) return;
    if (msg.type === "ready") return this.markReady();

    const push = this.pushStreams.get(msg.id);
    if (push) {
      if (msg.type === "next")
        push.queue.push(this.restore("subscribe", msg.value, msg.meta));
      else if (msg.type === "done") push.done = true;
      else if (msg.type === "error") push.error = deserializeError(msg.error);
      if (msg.type !== "next") this.pushStreams.delete(msg.id);
      push.wake?.();
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.type === "error") pending.reject(deserializeError(msg.error));
    else pending.resolve(msg);
  };

  /** Attach metadata sidecars to the events in a received value */
  private restore<T>(
    method: CallMethod | StreamMethod,
    value: T,
    meta?: MetadataList,
  ): T {
    const attach = this.options.metadata?.attach;
    if (attach && meta) {
      const events = eventsIn(method, value) as TEvent[];
      for (const [i, m] of meta) attach(events[i], m as TMetadata);
    }
    return value;
  }

  /** Send a request and wait for the matching response */
  private async request(
    message:
      | { type: "call"; method: CallMethod; args: unknown[] }
      | { type: "pull"; id: number; method: StreamMethod },
  ): Promise<ServerMessage> {
    await this.ready;
    if (this.closed) throw this.closed;
    const id = message.type === "pull" ? message.id : this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method: message.method, resolve, reject });
      if (message.type === "pull") this.post({ type: "pull", id });
      else this.post({ ...message, id });
    });
  }

  private async call<T>(method: CallMethod, ...args: unknown[]): Promise<T> {
    const msg = await this.request({ type: "call", method, args });
    if (msg.type !== "result") throw new Error(`Unexpected ${msg.type}`);
    return this.restore(method, msg.value as T, msg.meta);
  }

  // ── INostrIDB ──────────────────────────────────────────

  add(event: TEvent, ...rest: [metadata?: TMetadata]): Promise<boolean> {
    // explicit metadata (even undefined) replaces; otherwise extract it here,
    // since the server cannot see properties structured clone drops
    if (rest.length > 0) return this.call("add", event, rest[0]);
    const extracted = this.options.metadata?.read?.(event);
    return extracted === undefined
      ? this.call("add", event)
      : this.call("add", event, extracted);
  }

  setMetadata(eventId: string, metadata: TMetadata): Promise<boolean> {
    return this.call("setMetadata", eventId, metadata);
  }

  clearMetadata(eventId: string): Promise<boolean> {
    return this.call("clearMetadata", eventId);
  }

  event(id: string): Promise<TEvent | undefined> {
    return this.call("event", id);
  }

  replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<TEvent | undefined> {
    return this.call("replaceable", kind, author, identifier);
  }

  count(filters: Filter | Filter[]): Promise<number> {
    return this.call("count", filters);
  }

  supports(): Promise<string[]> {
    return this.call("supports");
  }

  query(filters: Filter | Filter[]): Promise<TEvent[]> {
    return this.call("query", filters);
  }

  queryPage(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ): Promise<QueryPage<TEvent>> {
    const { signal, ...rest } = options;
    signal?.throwIfAborted();
    return this.call("queryPage", filters, rest);
  }

  async *pages(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ): AsyncGenerator<QueryPage<TEvent>, void, undefined> {
    const { signal, ...rest } = options;
    signal?.throwIfAborted();
    await this.ready;
    if (this.closed) throw this.closed;

    const id = this.nextId++;
    this.post({ type: "stream", id, method: "pages", args: [filters, rest] });
    // true until the server ends the stream, so early exits cancel it
    let open = true;
    try {
      for (;;) {
        signal?.throwIfAborted();
        let msg: ServerMessage;
        try {
          msg = await this.request({ type: "pull", id, method: "pages" });
        } catch (error) {
          open = false;
          throw error;
        }
        if (msg.type === "done") {
          open = false;
          return;
        }
        if (msg.type !== "next") throw new Error(`Unexpected ${msg.type}`);
        yield this.restore("pages", msg.value as QueryPage<TEvent>, msg.meta);
      }
    } finally {
      if (open && !this.closed) this.post({ type: "cancel", id });
    }
  }

  async *iterate(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ): AsyncGenerator<TEvent, void, undefined> {
    for await (const page of this.pages(filters, options)) {
      for (const event of page.events) {
        options.signal?.throwIfAborted();
        yield event;
      }
    }
  }

  async *subscribe(
    filters: Filter | Filter[],
    options: SubscribeOptions = {},
  ): AsyncGenerator<TEvent, void, undefined> {
    const { signal } = options;
    if (signal?.aborted) return;
    await this.ready;
    if (this.closed) throw this.closed;

    const id = this.nextId++;
    const stream: PushStream = { queue: [], done: false };
    this.pushStreams.set(id, stream);
    const onAbort = () => stream.wake?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    this.post({ type: "stream", id, method: "subscribe", args: [filters] });

    try {
      while (!signal?.aborted) {
        if (stream.queue.length > 0) {
          yield stream.queue.shift() as TEvent;
          continue;
        }
        if (stream.error) throw stream.error;
        if (stream.done) return;
        await new Promise<void>((resolve) => (stream.wake = resolve));
        stream.wake = undefined;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (this.pushStreams.delete(id) && !this.closed)
        this.post({ type: "cancel", id });
    }
  }

  deleteEvent(eventId: string): Promise<boolean> {
    return this.call("deleteEvent", eventId);
  }

  deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    return this.call("deleteReplaceable", pubkey, kind, identifier);
  }

  deleteByFilters(filters: Filter | Filter[]): Promise<number> {
    return this.call("deleteByFilters", filters);
  }

  deleteAllEvents(): Promise<void> {
    return this.call("deleteAllEvents");
  }
}
