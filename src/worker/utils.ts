import type { NostrEvent } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import {
  Features,
  StreamHandlers,
  Subscription,
} from "../nostrdb/interface.js";
import { NostrIDB } from "../nostrdb/nostrdb.js";

export interface RPCResponse {
  id: number;
  result?: RPCResult;
  error?: string;
}

export interface RPCSubscriptionResponse {
  type: "subscription_event" | "subscription_complete" | "subscription_error";
  subscriptionId: string;
  event?: NostrEvent;
  error?: string;
}

// Strict RPC Parameter Types
export type RPCMethod =
  | { method: "add"; params: [NostrEvent] }
  | { method: "event"; params: [string] }
  | { method: "replaceable"; params: [number, string, string?] }
  | { method: "count"; params: [Filter[]] }
  | { method: "supports"; params: [] }
  | { method: "deleteEvent"; params: [string] }
  | { method: "deleteReplaceable"; params: [string, number, string?] }
  | { method: "deleteByFilters"; params: [Filter[]] }
  | { method: "deleteAllEvents"; params: [] }
  | { method: "filters"; params: [Filter[]] }
  | { method: "subscribe"; params: [Filter[], string] }
  | { method: "close"; params: [string] };

// RPC Message Types
export type RPCRequest = RPCMethod & {
  id: number;
};

// Strict RPC Result Types
export type RPCResult =
  | boolean
  | NostrEvent
  | NostrEvent[]
  | undefined
  | number
  | Features[]
  | void;

// RPC Handler for Worker Context
export class WorkerRPCClient {
  private messageId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: RPCResult) => void; reject: (error: Error) => void }
  >();
  private subscriptions = new Map<
    string,
    { close: () => void; handlers: StreamHandlers }
  >();

  constructor(
    private core: NostrIDB,
    private send: (message: RPCRequest) => void,
  ) {}

  handleMessage(data: RPCResponse | RPCSubscriptionResponse) {
    // Handle subscription messages
    if ("type" in data && data.type.startsWith("subscription_")) {
      const subscription = this.subscriptions.get(data.subscriptionId);
      if (subscription?.handlers) {
        switch (data.type) {
          case "subscription_event":
            if (data.event) subscription.handlers.event?.(data.event);
            break;
          case "subscription_complete":
            subscription.handlers.complete?.();
            break;
          case "subscription_error":
            if (data.error)
              subscription.handlers.error?.(new Error(data.error));
            break;
        }
      }
      return;
    }

    // Handle RPC responses
    if ("id" in data && ("result" in data || "error" in data)) {
      const request = this.pendingRequests.get(data.id);
      if (request) {
        this.pendingRequests.delete(data.id);
        if ("error" in data && data.error) {
          request.reject(new Error(data.error));
        } else if ("result" in data) {
          request.resolve(data.result);
        }
      }
    }
  }

  private sendMessage(request: RPCMethod): Promise<RPCResult> {
    return new Promise((resolve, reject) => {
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });

      const message: RPCRequest = { id, ...request };
      this.send(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  async add(event: NostrEvent): Promise<boolean> {
    return this.sendMessage({
      method: "add",
      params: [event],
    }) as Promise<boolean>;
  }

  async event(id: string): Promise<NostrEvent | undefined> {
    return this.sendMessage({ method: "event", params: [id] }) as Promise<
      NostrEvent | undefined
    >;
  }

  async replaceable(
    kind: number,
    author: string,
    identifier?: string,
  ): Promise<NostrEvent | undefined> {
    return this.sendMessage({
      method: "replaceable",
      params: [kind, author, identifier],
    }) as Promise<NostrEvent | undefined>;
  }

  async count(filters: Filter[]): Promise<number> {
    return this.sendMessage({
      method: "count",
      params: [filters],
    }) as Promise<number>;
  }

  async supports(): Promise<Features[]> {
    return this.sendMessage({ method: "supports", params: [] }) as Promise<
      Features[]
    >;
  }

  async filters(filters: Filter[]): Promise<NostrEvent[]> {
    return this.sendMessage({
      method: "filters",
      params: [filters],
    }) as Promise<NostrEvent[]>;
  }

  subscribe(filters: Filter[], handlers: StreamHandlers): Subscription {
    const subId = this.createSubscription(filters, handlers, "subscribe");
    return { close: () => this.closeSubscription(subId) };
  }

  private createSubscription(
    filters: Filter[],
    handlers: StreamHandlers,
    method: "subscribe",
  ): string {
    const subId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.subscriptions.set(subId, {
      close: () => this.closeSubscription(subId),
      handlers,
    });

    this.sendMessage({ method, params: [filters, subId] }).catch((error) => {
      handlers.error?.(error);
    });

    return subId;
  }

  private closeSubscription(subId: string): void {
    const subscription = this.subscriptions.get(subId);
    if (subscription) {
      this.subscriptions.delete(subId);
      this.sendMessage({ method: "close", params: [subId] }).catch(() => {
        // Ignore errors when closing
      });
    }
  }

  async deleteEvent(eventId: string): Promise<boolean> {
    return this.sendMessage({
      method: "deleteEvent",
      params: [eventId],
    }) as Promise<boolean>;
  }

  async deleteReplaceable(
    pubkey: string,
    kind: number,
    identifier?: string,
  ): Promise<boolean> {
    return this.sendMessage({
      method: "deleteReplaceable",
      params: [pubkey, kind, identifier],
    }) as Promise<boolean>;
  }

  async deleteByFilters(filters: Filter[]): Promise<number> {
    return this.sendMessage({
      method: "deleteByFilters",
      params: [filters],
    }) as Promise<number>;
  }

  async deleteAllEvents(): Promise<void> {
    return this.sendMessage({
      method: "deleteAllEvents",
      params: [],
    }) as Promise<void>;
  }
}

// RPC Server for Worker Context
export class WorkerRPCServer {
  constructor(
    private core: NostrIDB,
    private send?: (message: RPCSubscriptionResponse) => void,
  ) {}

  async handleRequest(request: RPCRequest): Promise<RPCResponse> {
    const { method, params, id } = request;

    try {
      let result: RPCResult;

      switch (method) {
        case "add":
          result = await this.core.add(params[0]);
          break;
        case "event":
          result = await this.core.event(params[0]);
          break;
        case "replaceable":
          result = await this.core.replaceable(params[0], params[1], params[2]);
          break;
        case "count":
          result = await this.core.count(params[0]);
          break;
        case "supports":
          result = await this.core.supports();
          break;
        case "deleteEvent":
          result = await this.core.deleteEvent(params[0]);
          break;
        case "deleteReplaceable":
          result = await this.core.deleteReplaceable(
            params[0],
            params[1],
            params[2],
          );
          break;
        case "deleteByFilters":
          result = await this.core.deleteByFilters(params[0]);
          break;
        case "deleteAllEvents":
          await this.core.deleteAllEvents();
          result = undefined;
          break;
        case "filters":
          result = await this.core.filters(params[0]);
          break;
        case "subscribe":
          this.core.subscribe(params[0], {
            event: (event) => {
              this.sendSubscriptionResponse({
                type: "subscription_event",
                subscriptionId: params[1],
                event,
              });
            },
            complete: () => {
              this.sendSubscriptionResponse({
                type: "subscription_complete",
                subscriptionId: params[1],
              });
            },
            error: (error) => {
              this.sendSubscriptionResponse({
                type: "subscription_error",
                subscriptionId: params[1],
                error: error.message,
              });
            },
          });
          result = true;
          break;
        case "close":
          // The subscription will be closed by the relay's internal cleanup
          result = true;
          break;
        default:
          throw new Error(`Unknown method: ${method}`);
      }

      return { id, result };
    } catch (error) {
      return {
        id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private sendSubscriptionResponse(message: RPCSubscriptionResponse): void {
    if (this.send) {
      this.send(message);
    } else if (typeof postMessage !== "undefined") {
      postMessage(message);
    }
  }
}
