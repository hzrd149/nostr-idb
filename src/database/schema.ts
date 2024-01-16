import type { DBSchema, IDBPDatabase } from "idb";
import type { Event } from "nostr-tools";

export type NostrIDB = IDBPDatabase<Schema>;

export interface Schema extends DBSchema {
  events: {
    key: string;
    value: {
      event: Event;
      tags: string[];
    };
    indexes: {
      id: string;
      pubkey: string;
      kind: number;
      created_at: number;
      tags: string;
    };
  };
  used: {
    key: string;
    value: {
      uid: string;
      date: number;
    };
    indexes: {
      uid: string;
      date: number;
    };
  };
}
