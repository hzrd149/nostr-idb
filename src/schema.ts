import type { DBSchema, IDBPDatabase } from "idb";
import type { Event } from "nostr-tools";

export type NostrIDB = IDBPDatabase<Schema>;

export interface Schema extends DBSchema {
  events: {
    key: "id";
    value: {
      event: Event;
      tags: string[];
      replaceableId?: string;
    };
    indexes: {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      tags: string;
      replaceableId: string;
    };
  };
  seen: {
    key: "id";
    value: {
      id: string;
      date: number;
      relays: string[];
    };
    indexes: {
      id: string;
      date: string;
      relay: string;
    };
  };
  used: {
    key: "id";
    value: {
      id: string;
      date: number;
    };
    indexes: {
      id: string;
      date: string;
    };
  };
}
