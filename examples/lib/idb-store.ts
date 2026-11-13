import type { IAsyncEventStoreRead, SyncPair } from "applesauce-core";
import type { NostrEvent as ApplesauceEvent } from "applesauce-core/helpers";
import type { Filter as ApplesauceFilter } from "applesauce-core/helpers";
import type { Filter, NostrIDB, StoredEvent } from "../../src/index.ts";

type Event = ApplesauceEvent;

/**
 * Read-only applesauce store backed by NostrIDB, used as the local side of a
 * NIP-77 negentropy sync. It has no `add()` so relay sync() leaves writing
 * received events to the caller, which batches them into IndexedDB.
 *
 * Events loaded while building the inventory are kept in memory so the
 * per-event `getByFilters({ ids })` lookups made while uploading are free.
 */
export class IdbSyncStore implements IAsyncEventStoreRead<Event> {
  private byId = new Map<string, StoredEvent>();
  private inventories = new Map<string, Promise<SyncPair[]>>();
  /** Called once per distinct filter with how long the inventory read took */
  onInventory?: (filter: Filter, pairs: number, ms: number) => void;

  constructor(private nostr: NostrIDB) {}

  private remember(events: StoredEvent[]) {
    for (const e of events) this.byId.set(e.id, e);
    return events as unknown as Event[];
  }

  /** Local inventory for a filter, read once and shared by every relay */
  getSyncPairs(filters: ApplesauceFilter | ApplesauceFilter[]) {
    const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
    const key = JSON.stringify(list);
    let pending = this.inventories.get(key);
    if (!pending) {
      const t0 = performance.now();
      pending = this.nostr.query(list).then((events) => {
        this.remember(events);
        this.onInventory?.(list[0], events.length, performance.now() - t0);
        return events.map((e) => ({ id: e.id, created_at: e.created_at }));
      });
      this.inventories.set(key, pending);
    }
    return pending;
  }

  async getByFilters(filters: ApplesauceFilter | ApplesauceFilter[]) {
    const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
    // fast path for sync uploads: a single filter of ids we already loaded
    if (list.length === 1 && list[0].ids && Object.keys(list[0]).length === 1) {
      const found = list[0].ids
        .map((id) => this.byId.get(id))
        .filter((e): e is StoredEvent => !!e);
      if (found.length === list[0].ids.length)
        return found as unknown as Event[];
    }
    return this.remember(await this.nostr.query(list));
  }

  /** Whether an event id is in the inventories loaded so far */
  has(id: string) {
    return this.byId.has(id);
  }

  getTimeline(filters: ApplesauceFilter | ApplesauceFilter[]) {
    return this.getByFilters(filters);
  }

  async getEvent(id: string) {
    const cached = this.byId.get(id);
    if (cached) return cached as unknown as Event;
    return (await this.nostr.event(id)) as unknown as Event | undefined;
  }

  async hasEvent(id: string) {
    return !!(await this.getEvent(id));
  }

  async getReplaceable(kind: number, pubkey: string, identifier?: string) {
    return (await this.nostr.replaceable(
      kind,
      pubkey,
      identifier,
    )) as unknown as Event | undefined;
  }

  async hasReplaceable(kind: number, pubkey: string, identifier?: string) {
    return !!(await this.getReplaceable(kind, pubkey, identifier));
  }

  async getReplaceableHistory(
    kind: number,
    pubkey: string,
    identifier?: string,
  ) {
    const e = await this.getReplaceable(kind, pubkey, identifier);
    return e ? [e] : undefined;
  }
}
