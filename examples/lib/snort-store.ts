/// <reference types="vite/client" />
/**
 * Adapts `@snort/worker-relay` (SQLite-WASM on OPFS, running in a worker) to
 * the `INostrIDB` interface, so the playground can run the same tools against
 * it for comparison.
 *
 * Caveats of the worker relay:
 * - it has no live subscriptions, so `subscribe()` only sees events added
 *   through this store after the initial query
 * - it uses the origin's single OPFS SAH pool, so only one database can be
 *   open at a time (DBManager closes the previous one)
 * - `wipe()` deletes every file in the pool, so it is never called here
 * - `event()` replies right away and writes in 50ms batches
 */
import {
  WorkerRelayInterface,
  type NostrEvent,
  type ReqFilter,
} from "@snort/worker-relay";
import SnortWorker from "@snort/worker-relay/src/worker?worker";
import type {
  Filter,
  INostrIDB,
  QueryPage,
  QueryPageOptions,
  StoredEvent,
  SubscribeOptions,
} from "../../src/index.ts";
import { matchFilters } from "../../src/lib/nostr.ts";

let nextId = 0;
const reqId = () => `idb-${++nextId}`;

function toList(filters: Filter | Filter[]): ReqFilter[] {
  return (Array.isArray(filters) ? filters : [filters]) as ReqFilter[];
}

type Listener = { filters: Filter[]; push: (event: StoredEvent) => void };

export class SnortStore implements INostrIDB {
  readonly worker: Worker;
  readonly relay: WorkerRelayInterface;
  private listeners = new Set<Listener>();

  constructor(readonly name: string) {
    this.worker = new SnortWorker({ name: `worker-relay: ${name}` });
    this.relay = new WorkerRelayInterface(this.worker);
    // large imports and deletes can take longer than the default 30s
    this.relay.timeout = 5 * 60_000;
  }

  /** OPFS file the database is stored in */
  get path() {
    return `${this.name}.db`;
  }

  /** Load sqlite and open (or create) the database */
  async init() {
    await this.relay.init({ databasePath: this.path });
    return this;
  }

  /** Write pending events and terminate the worker */
  async close() {
    this.listeners.clear();
    try {
      // relay.close() never resolves (its reply has no args, which crashes
      // the interface's reply handler). A kvSet flushes the pending event
      // batch, and every write is its own transaction, so terminating after
      // it is safe; the OPFS handles and the db lock are released with it.
      await this.relay.syncState.set("nostr-idb:closed", { at: Date.now() });
    } finally {
      this.worker.terminate();
    }
  }

  /** Event counts per kind */
  summary() {
    return this.relay.summary();
  }

  async add(event: StoredEvent) {
    const res = await this.relay.event(event as NostrEvent);
    if (res.ok)
      for (const l of this.listeners)
        if (matchFilters(l.filters, event)) l.push(event);
    return res.ok;
  }

  async setMetadata() {
    return false;
  }
  async clearMetadata() {
    return false;
  }

  async query(filters: Filter | Filter[]) {
    const list = toList(filters);
    if (list.length === 0) return [];
    const res = await this.relay.query(["REQ", reqId(), ...list]);
    return res.filter((e): e is NostrEvent => typeof e === "object");
  }

  async event(id: string) {
    return (await this.query({ ids: [id] }))[0];
  }

  async replaceable(kind: number, author: string, identifier?: string) {
    const filter: Filter = { kinds: [kind], authors: [author], limit: 1 };
    if (identifier !== undefined) filter["#d"] = [identifier];
    return (await this.query(filter))[0];
  }

  async count(filters: Filter | Filter[]) {
    const list = toList(filters);
    if (list.length === 0) return 0;
    // the worker sums each filter's count, so overlapping filters double count
    if (list.length > 1) return (await this.query(list as Filter[])).length;
    return this.relay.count(["REQ", reqId(), ...list]);
  }

  async supports() {
    return ["search"];
  }

  async queryPage(
    filters: Filter | Filter[] = {},
    options: QueryPageOptions = {},
  ): Promise<QueryPage> {
    const { pageSize = 100, cursor } = options;
    // cursor is "<created_at>:<id>" of the last event returned
    const [time, lastId] = cursor ? cursor.split(":") : [];
    const until = time ? Number(time) : undefined;
    const list = toList(filters).map((f) => ({
      ...f,
      ...(until !== undefined && {
        until: f.until !== undefined ? Math.min(f.until, until) : until,
      }),
      limit: pageSize + 1,
    }));
    let events = await this.query(list as Filter[]);
    events.sort(
      (a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1),
    );
    // skip events already returned at the cursor's timestamp
    if (until !== undefined)
      events = events.filter(
        (e) =>
          e.created_at < until || (e.created_at === until && e.id > lastId),
      );
    const done = events.length <= pageSize;
    events = events.slice(0, pageSize);
    const last = events.at(-1);
    return {
      events,
      done,
      scanned: events.length,
      nextCursor: !done && last ? `${last.created_at}:${last.id}` : undefined,
    };
  }

  async *pages(filters?: Filter | Filter[], options: QueryPageOptions = {}) {
    let cursor = options.cursor;
    while (!options.signal?.aborted) {
      const page = await this.queryPage(filters, { ...options, cursor });
      yield page;
      if (page.done || !page.nextCursor) return;
      cursor = page.nextCursor;
    }
  }

  async *iterate(filters?: Filter | Filter[], options?: QueryPageOptions) {
    for await (const page of this.pages(filters, options)) yield* page.events;
  }

  async *subscribe(
    filters: Filter | Filter[],
    options: SubscribeOptions = {},
  ): AsyncGenerator<StoredEvent, void, undefined> {
    const { signal } = options;
    if (signal?.aborted) return;
    const list = Array.isArray(filters) ? filters : [filters];
    const seen = new Set<string>();
    const queue: StoredEvent[] = [];
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };
    // listen before querying so events added during the query are not lost
    const listener: Listener = {
      filters: list,
      push: (event) => {
        queue.push(event);
        notify();
      },
    };
    this.listeners.add(listener);
    signal?.addEventListener("abort", notify, { once: true });
    try {
      for (const event of await this.query(list)) {
        if (signal?.aborted) return;
        seen.add(event.id);
        yield event;
      }
      while (!signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => (wake = r));
          continue;
        }
        const event = queue.shift()!;
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        yield event;
      }
    } finally {
      this.listeners.delete(listener);
      signal?.removeEventListener("abort", notify);
    }
  }

  async deleteEvent(eventId: string) {
    return (
      (await this.relay.delete(["REQ", reqId(), { ids: [eventId] }])).length > 0
    );
  }

  async deleteReplaceable(pubkey: string, kind: number, identifier?: string) {
    const filter: ReqFilter = { kinds: [kind], authors: [pubkey] };
    if (identifier !== undefined) filter["#d"] = [identifier];
    return (await this.relay.delete(["REQ", reqId(), filter])).length > 0;
  }

  async deleteByFilters(filters: Filter | Filter[]) {
    const list = toList(filters);
    if (list.length === 0) return 0;
    return (await this.relay.delete(["REQ", reqId(), ...list])).length;
  }

  async deleteAllEvents() {
    // not wipe(): that deletes every database in the OPFS pool
    await this.relay.delete(["REQ", reqId(), {}]);
  }
}
