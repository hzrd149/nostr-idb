import type { NostrEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import {
  Features,
  INostrIDB,
  StreamHandlers,
  Subscription,
} from "../nostrdb/interface.js";
import {
  RPCResponse,
  RPCSubscriptionResponse,
  WorkerRPCClient,
} from "./utils.js";

export class NostrIDBWorker extends Worker {
  constructor() {
    super(new URL("./worker.js", import.meta.url), {
      name: "nostr-idb-worker",
      type: "module",
    });
  }
}

export class NostrIDBSharedWorker extends SharedWorker {
  constructor() {
    super(new URL("./shared.js", import.meta.url), {
      name: "nostr-idb-shared-worker",
      type: "module",
    });
  }
}

/** An interface for to interact with a worker running nostr-idb */
export class NostrIDBWorkerInterface implements INostrIDB {
  private rpc: WorkerRPCClient;

  constructor(worker: Worker | SharedWorker) {
    const send = (message: RPCResponse | RPCSubscriptionResponse) => {
      if (worker instanceof Worker) {
        worker.postMessage(message);
      } else {
        worker.port.postMessage(message);
      }
    };

    this.rpc = new WorkerRPCClient(null as any, send);

    // Set up message handling
    if (worker instanceof Worker) {
      worker.onmessage = (event) =>
        this.rpc.handleMessage(
          event.data as RPCResponse | RPCSubscriptionResponse,
        );
    } else {
      worker.port.onmessage = (event) =>
        this.rpc.handleMessage(
          event.data as RPCResponse | RPCSubscriptionResponse,
        );
    }
  }

  async add(event: NostrEvent): Promise<boolean> {
    return this.rpc.add(event);
  }

  async event(id: string): Promise<NostrEvent | undefined> {
    return this.rpc.event(id);
  }

  async replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined> {
    return this.rpc.replaceable(kind, author, identifier);
  }

  async count(filters: Filter[]): Promise<number> {
    return this.rpc.count(filters);
  }

  async supports(): Promise<Features[]> {
    return this.rpc.supports();
  }

  filters(filters: Filter[], handlers: StreamHandlers): Subscription {
    return this.rpc.filters(filters, handlers);
  }

  subscribe(filters: Filter[], handlers: StreamHandlers): Subscription {
    return this.rpc.subscribe(filters, handlers);
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    return this.rpc.deleteEvent(eventId);
  }

  async deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    return this.rpc.deleteReplaceable(pubkey, kind, identifier);
  }

  async deleteByFilters(filters: Filter[]): Promise<number> {
    return this.rpc.deleteByFilters(filters);
  }

  async deleteAllEvents(): Promise<void> {
    return this.rpc.deleteAllEvents();
  }
}
