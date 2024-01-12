import { Event, Filter, matchFilters } from "nostr-tools";
import { NostrIDB } from "./schema";
import { WriteQueue } from "./write-queue";
import { countEventsForFilters, getEventsForFilters } from "./query-filter";
import { sortByDate } from "./utils";

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
export type SimpleSubscription = SimpleSubscriptionOptions & {
  id: string;
  filters: Filter[];
  close(message?: string): void;
};

export type CacheRelayOptions = {
  /** Defaults to 1000 */
  batchWrite?: number;
  /** Defaults to 1000 */
  writeInterval?: number;
};

const defaultOptions: CacheRelayOptions = {
  batchWrite: 1000,
  writeInterval: 1000,
};

export class CacheRelay implements SimpleRelay {
  public get url(): string {
    return "[Internal]";
  }
  public get connected() {
    return !!this.interval;
  }

  private options: CacheRelayOptions;
  private interval?: number;
  private db: NostrIDB;
  private writeQueue: WriteQueue;

  private nextId = 0;
  private subscriptions: Set<
    SimpleSubscriptionOptions & {
      filters: Filter[];
    }
  > = new Set();

  constructor(db: NostrIDB, opts: CacheRelayOptions = {}) {
    this.db = db;
    this.writeQueue = new WriteQueue(db);
    this.options = { ...defaultOptions, ...opts };
  }

  public async connect(): Promise<void> {
    this.interval = window.setInterval(() => {
      this.writeQueue.flush(this.options.batchWrite);
    }, this.options.writeInterval);
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

  private async executeSubscription(sub: SimpleSubscription) {
    // load any events from the write queue
    const eventsFromQueue = this.writeQueue.queue.filter((e) =>
      matchFilters(sub.filters, e),
    );

    // get events
    await getEventsForFilters(this.db, sub.filters).then((filterEvents) => {
      if (sub.onevent) {
        const idsFromQueue = new Set(eventsFromQueue.map((e) => e.id));

        const events =
          eventsFromQueue.length > 0
            ? [
                ...filterEvents.filter((e) => !idsFromQueue.has(e.id)),
                ...eventsFromQueue,
              ].sort(sortByDate)
            : filterEvents;

        for (const event of events) {
          sub.onevent(event);
        }
      }
      if (sub.oneose) sub.oneose();
    });
  }

  public subscribe(
    filters: Filter[],
    options: Partial<SimpleSubscriptionOptions>,
  ): SimpleSubscription {
    const id = this.nextId++;

    const sub = {
      id: String(id),
      filters,
      close: () => this.subscriptions.delete(sub),
      fire: () => this.executeSubscription(sub),
      ...options,
    };

    this.subscriptions.add(sub);

    this.executeSubscription(sub);

    return sub;
  }
}
