import { Event, Filter, matchFilters } from "nostr-tools";
import { NostrIDB } from "./schema";
import { WriteQueue } from "./write-queue";
import { countEventsForFilters, getEventsForFilters } from "./query-filter";

export interface SimpleRelay {
  url: string;
  publish(event: Event): Promise<string>;
  connected: boolean;
  connect(): Promise<void>;
  close(): void;
  count(filters: Filter[], params?: { id?: string | null }): Promise<number>;
  subscribe(
    filters: Filter[],
    options: SimpleSubscriptionOptions,
  ): SimpleSubscription;
}

export type SimpleSubscriptionOptions = {
  onevent?: (event: Event) => void;
  oneose?: () => void;
  onclose?: (reason: string) => void;
};
export type SimpleSubscription = {
  id: string;
  close(message?: string): void;
};

export class CacheRelay implements SimpleRelay {
  public get url(): string {
    return "[Internal]";
  }
  public get connected() {
    return !!this.interval;
  }

  private interval?: number;
  private db: NostrIDB;
  private writeQueue: WriteQueue;

  private nextId = 0;
  private subscriptions: Set<
    SimpleSubscriptionOptions & {
      filters: Filter[];
    }
  > = new Set();

  constructor(db: NostrIDB) {
    this.db = db;
    this.writeQueue = new WriteQueue(db);
  }

  public async connect(): Promise<void> {
    this.interval = window.setInterval(
      this.writeQueue.flush.bind(this.writeQueue),
      1000,
    );
  }
  public async close() {
    if (this.interval) {
      window.clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  public async publish(event: Event): Promise<string> {
    this.writeQueue.addEvent(event);

    let subs = 0;
    for (const { onevent, filters } of this.subscriptions) {
      if (onevent && matchFilters(filters, event)) {
        onevent(event);
        subs++;
      }
    }

    return `Sent to ${subs} subscriptions`;
  }

  public async count(
    filters: Filter[],
    params?: { id?: string | null },
  ): Promise<number> {
    return await countEventsForFilters(this.db, filters);
  }

  public subscribe(
    filters: Filter[],
    options: Partial<SimpleSubscriptionOptions>,
  ): SimpleSubscription {
    const id = this.nextId++;

    const sub = {
      id,
      onclose: options.onclose,
      onevent: options.onevent,
      oneose: options.oneose,
      filters,
    };

    this.subscriptions.add(sub);

    // get events
    getEventsForFilters(this.db, filters).then((events) => {
      for (const event of events) {
        if (sub.onevent) sub.onevent(event);
      }
      if (sub.oneose) sub.oneose();
    });

    return { id: String(id), close: () => this.subscriptions.delete(sub) };
  }
}
