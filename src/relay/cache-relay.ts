import { Event, Filter } from "nostr-tools";
import { NostrIDB } from "../database/schema.js";
import {
  RelayCore,
  RelayCoreOptions,
  Subscription,
  SubscriptionOptions,
} from "./relay-core.js";

export interface SimpleRelay {
  url: string;
  publish(event: Event): Promise<string>;
  connected: boolean;
  connect(): Promise<void>;
  close(): void;
  count(filters: Filter[], params?: { id?: string | null }): Promise<number>;
  subscribe(filters: Filter[], options: SubscriptionOptions): Subscription;
}

export type CacheRelayOptions = RelayCoreOptions;

export class CacheRelay implements SimpleRelay {
  public get url(): string {
    return "nostr-idb://cache-relay";
  }
  public get connected() {
    return !!this.core.running;
  }

  db: NostrIDB;
  core: RelayCore;

  constructor(db: NostrIDB, opts: CacheRelayOptions = {}) {
    this.db = db;
    this.core = new RelayCore(db, opts);
  }

  public async connect(): Promise<void> {
    this.core.start();
  }
  public async close() {
    this.core.stop();
  }

  public async publish(event: Event): Promise<string> {
    return this.core.publish(event);
  }

  public async count(
    filters: Filter[],
    params?: { id?: string | null },
  ): Promise<number> {
    return this.core.count(filters);
  }

  public subscribe(
    filters: Filter[],
    options: Partial<SubscriptionOptions>,
  ): Subscription {
    return this.core.subscribe(filters, options);
  }
}
