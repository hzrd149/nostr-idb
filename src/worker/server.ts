import type { INostrIDB } from "../nostrdb/interface.js";
import type { Filter, StoredEvent } from "../lib/nostr.js";
import type { EventMetadataOptions } from "../nostrdb/metadata.js";
import type { NostrIDB } from "../nostrdb/nostrdb.js";
import {
  CALL_METHODS,
  RPC_TAG,
  STREAM_METHODS,
  eventsIn,
  isMessage,
  serializeError,
  type CallMethod,
  type ClientMessage,
  type MetadataList,
  type RPCEndpoint,
  type ServerBody,
  type ServerMessage,
  type StreamMethod,
} from "./protocol.js";

/** Symbol the server reads to carry event metadata to clients */
const MetadataSymbol = Symbol.for("nostr-idb.rpc-metadata");

/**
 * Metadata hooks for a {@link NostrIDB} served over RPC. Pass them as the
 * server-side `metadata` option so sidecar metadata reaches clients; the
 * client's own `read`/`attach` hooks then apply on the main thread. Without
 * them, clients can still write metadata but reads return events without it.
 */
export const serverMetadata: EventMetadataOptions<StoredEvent, unknown> = {
  attach(event, metadata) {
    if (metadata === undefined) Reflect.deleteProperty(event, MetadataSymbol);
    else Reflect.set(event, MetadataSymbol, metadata);
  },
};

type Stream = {
  controller: AbortController;
  method?: StreamMethod;
  iterator?: AsyncIterator<unknown>;
};

/**
 * Serve a database to {@link NostrIDBClient}s over a message endpoint. Call
 * this inside a worker with `self`, or with one end of a `MessageChannel`.
 *
 * To carry sidecar metadata, create the served {@link NostrIDB} with
 * `metadata: serverMetadata` and configure your `read`/`attach` hooks on the
 * client.
 *
 * Returns a function that stops serving and cancels open streams. It does not
 * stop or close the database.
 */
export function serveNostrIDB(
  endpoint: RPCEndpoint,
  nostr: INostrIDB<any, any>,
): () => void {
  const streams = new Map<number, Stream>();
  const post = (message: ServerBody) =>
    endpoint.postMessage({ ...message, tag: RPC_TAG });

  const metadataFor = (
    method: CallMethod | StreamMethod,
    value: unknown,
  ): MetadataList | undefined => {
    const meta: MetadataList = [];
    eventsIn(method, value).forEach((event, i) => {
      if (Reflect.has(event, MetadataSymbol))
        meta.push([i, Reflect.get(event, MetadataSymbol)]);
    });
    return meta.length ? meta : undefined;
  };

  async function call(id: number, method: CallMethod, args: unknown[]) {
    const controller =
      method === "queryPage" ? new AbortController() : undefined;
    if (controller) {
      streams.set(id, { controller });
      args = [args[0], { ...(args[1] as object), signal: controller.signal }];
    }
    try {
      const fn = nostr[method] as (...args: unknown[]) => Promise<unknown>;
      // keep the argument count: add(event, undefined) differs from add(event)
      const value = await fn.apply(nostr, args);
      post({ type: "result", id, value, meta: metadataFor(method, value) });
    } catch (error) {
      post({ type: "error", id, error: serializeError(error) });
    } finally {
      if (controller) streams.delete(id);
    }
  }

  async function* queryChunks(
    filters: Filter | Filter[],
    chunkSize: number,
    signal: AbortSignal,
  ) {
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
      throw new Error("queryChunkSize must be a positive safe integer");
    // Query once to preserve ordering, limits, pending events, and deduplication.
    // Only transport is chunked; the database still materializes the result.
    const events = await nostr.query(filters);
    for (let offset = 0; offset < events.length; offset += chunkSize) {
      if (signal.aborted) return;
      yield events.slice(offset, offset + chunkSize);
    }
  }

  function open(id: number, method: StreamMethod, args: unknown[]) {
    const controller = new AbortController();
    const [filters, options] = args as [unknown, object | undefined];
    const iterator = (
      method === "query"
        ? queryChunks(
            filters as Filter | Filter[],
            (options as { chunkSize?: number } | undefined)?.chunkSize ?? 100,
            controller.signal,
          )
        : method === "pages"
          ? nostr.pages(filters as any, {
              ...options,
              signal: controller.signal,
            })
          : nostr.subscribe(filters as any, { signal: controller.signal })
    )[Symbol.asyncIterator]();
    streams.set(id, { controller, iterator, method });

    // subscriptions push every event until done or cancelled
    if (method === "subscribe") {
      (async () => {
        try {
          for (;;) {
            const r = await iterator.next();
            if (controller.signal.aborted) return;
            if (r.done) break;
            post({
              type: "next",
              id,
              value: r.value,
              meta: metadataFor(method, r.value),
            });
          }
          post({ type: "done", id });
        } catch (error) {
          if (!controller.signal.aborted)
            post({ type: "error", id, error: serializeError(error) });
        } finally {
          streams.delete(id);
        }
      })();
    }
  }

  async function pull(id: number) {
    const stream = streams.get(id);
    if (!stream?.iterator)
      return post({
        type: "error",
        id,
        error: { name: "Error", message: "Unknown stream" },
      });
    try {
      const r = await stream.iterator.next();
      if (stream.controller.signal.aborted) return;
      if (r.done) {
        streams.delete(id);
        post({ type: "done", id });
      } else
        post({
          type: "next",
          id,
          value: r.value,
          meta: metadataFor(stream.method!, r.value),
        });
    } catch (error) {
      const aborted = stream.controller.signal.aborted;
      cancel(id);
      if (!aborted) post({ type: "error", id, error: serializeError(error) });
    }
  }

  function cancel(id: number) {
    const stream = streams.get(id);
    if (!stream) return;
    streams.delete(id);
    stream.controller.abort();
    stream.iterator?.return?.().catch(() => {});
  }

  const listener = (event: MessageEvent) => {
    const msg = event.data;
    if (!isMessage<ClientMessage>(msg)) return;
    switch (msg.type) {
      case "ping":
        return post({ type: "ready" });
      case "call":
        if (!CALL_METHODS.includes(msg.method))
          return post({
            type: "error",
            id: msg.id,
            error: { name: "Error", message: `Unknown method ${msg.method}` },
          });
        return void call(msg.id, msg.method, msg.args);
      case "stream":
        if (!STREAM_METHODS.includes(msg.method))
          return post({
            type: "error",
            id: msg.id,
            error: { name: "Error", message: `Unknown stream ${msg.method}` },
          });
        try {
          open(msg.id, msg.method, msg.args);
        } catch (error) {
          post({ type: "error", id: msg.id, error: serializeError(error) });
        }
        return;
      case "pull":
        return void pull(msg.id);
      case "cancel":
        return cancel(msg.id);
    }
  };

  endpoint.addEventListener("message", listener);
  endpoint.start?.();
  // announce in case the client connected before the server was listening
  post({ type: "ready" });

  return () => {
    endpoint.removeEventListener("message", listener);
    for (const id of [...streams.keys()]) cancel(id);
  };
}
